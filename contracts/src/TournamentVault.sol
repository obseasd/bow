// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ITournamentVault} from "./ITournamentVault.sol";

/// @title Bow TournamentVault — 3-asset version of the Turing tournament
/// @notice
///   Every AI rebalance opens a 24h round. Humans vote their own
///   (usdc, usyc, eurc) allocation. On settle, the contract computes who
///   produced the better return given the price moves of the three assets,
///   records the outcome on-chain, and emits the event for indexers.
///
///   This vault is the read-side of Bow's "AI vs human, identical data,
///   settled on-chain" claim. Stake gating, sqrt-rep voting, bounty pool,
///   and badges live in their own contracts in a future iteration; this MVP
///   focuses on the lifecycle (open / vote / settle / outcome) for clarity.
contract TournamentVault is ITournamentVault {
    error OnlyAgent();
    error OnlySettler();
    error RoundNotFound();
    error RoundNotReady();
    error RoundAlreadySettled();
    error InvalidAllocation();
    error AlreadyVoted();

    enum Outcome { PENDING, AI_WINS, HUMAN_WINS, TIE }

    event RoundOpened(
        uint256 indexed id,
        uint8 aiUsdcPct,
        uint8 aiUsycPct,
        uint8 aiEurcPct,
        uint256 startUsdcPrice,
        uint256 startUsycPrice,
        uint256 startEurcPrice,
        uint64 startTime,
        uint64 settlementTime
    );
    event HumanVote(
        uint256 indexed id,
        address indexed human,
        uint8 usdcPct,
        uint8 usycPct,
        uint8 eurcPct
    );
    event RoundSettled(
        uint256 indexed id,
        int256 aiReturnBps,
        int256 humanReturnBps,
        uint8 humanUsdcPct,
        uint8 humanUsycPct,
        uint8 humanEurcPct,
        Outcome outcome,
        uint256 settleUsdcPrice,
        uint256 settleUsycPrice,
        uint256 settleEurcPrice
    );

    struct Round {
        uint256 id;
        uint64 startTime;
        uint64 settlementTime;
        // Snapshot prices at open (USD value of each asset, 8 decimals)
        uint256 startUsdcPrice;
        uint256 startUsycPrice;
        uint256 startEurcPrice;
        // Settle prices
        uint256 settleUsdcPrice;
        uint256 settleUsycPrice;
        uint256 settleEurcPrice;
        // AI allocation
        uint8 aiUsdcPct;
        uint8 aiUsycPct;
        uint8 aiEurcPct;
        // Aggregated human allocation at settle
        uint8 humanUsdcPct;
        uint8 humanUsycPct;
        uint8 humanEurcPct;
        // Returns
        int256 aiReturnBps;
        int256 humanReturnBps;
        Outcome outcome;
        bool settled;
    }

    struct Vote {
        uint8 usdcPct;
        uint8 usycPct;
        uint8 eurcPct;
        uint64 timestamp;
    }

    address public owner;
    address public agent;
    address public settler;
    uint256 public roundDuration = 24 hours;

    uint256 public totalRounds;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(address => Vote)) public votes;
    mapping(uint256 => address[]) public roundVoters;

    uint256 public aiWins;
    uint256 public humanWins;

    modifier onlyAgent() { if (msg.sender != agent) revert OnlyAgent(); _; }
    modifier onlySettler() { if (msg.sender != settler && msg.sender != agent) revert OnlySettler(); _; }

    constructor(address _agent, address _settler) {
        owner = msg.sender;
        agent = _agent;
        settler = _settler == address(0) ? _agent : _settler;
    }

    function setSettler(address _settler) external {
        if (msg.sender != owner) revert();
        settler = _settler;
    }

    function setRoundDuration(uint256 _seconds) external {
        if (msg.sender != owner) revert();
        roundDuration = _seconds;
    }

    /// @notice Called by HybridVault.executeAllocation to open a new round
    ///         atomically with the AI's rebalance.
    function openRound(uint8 usdcPct, uint8 usycPct, uint8 eurcPct)
        external
        override
        onlyAgent
        returns (uint256 id)
    {
        if (uint16(usdcPct) + usycPct + eurcPct != 100) revert InvalidAllocation();
        id = ++totalRounds;
        uint64 nowTs = uint64(block.timestamp);
        rounds[id] = Round({
            id: id,
            startTime: nowTs,
            settlementTime: nowTs + uint64(roundDuration),
            // V1 simplification: all three assets priced at 1 USD at round open.
            // V2 will read a price oracle. Returns are then 0 unless we feed
            // real prices to settleRound, which the off-chain settler does.
            startUsdcPrice: 1e8,
            startUsycPrice: 1e8,
            startEurcPrice: 1e8,
            settleUsdcPrice: 0,
            settleUsycPrice: 0,
            settleEurcPrice: 0,
            aiUsdcPct: usdcPct,
            aiUsycPct: usycPct,
            aiEurcPct: eurcPct,
            humanUsdcPct: 0,
            humanUsycPct: 0,
            humanEurcPct: 0,
            aiReturnBps: 0,
            humanReturnBps: 0,
            outcome: Outcome.PENDING,
            settled: false
        });
        emit RoundOpened(id, usdcPct, usycPct, eurcPct, 1e8, 1e8, 1e8, nowTs, nowTs + uint64(roundDuration));
    }

    /// @notice Cast a human vote on a round. Single vote per address per
    ///         round. No stake gate in this MVP, kept simple for the
    ///         hackathon judging path.
    function voteHuman(uint256 roundId, uint8 usdcPct, uint8 usycPct, uint8 eurcPct) external {
        Round storage r = rounds[roundId];
        if (r.id == 0) revert RoundNotFound();
        if (r.settled) revert RoundAlreadySettled();
        if (uint16(usdcPct) + usycPct + eurcPct != 100) revert InvalidAllocation();
        if (votes[roundId][msg.sender].timestamp != 0) revert AlreadyVoted();

        votes[roundId][msg.sender] = Vote({
            usdcPct: usdcPct,
            usycPct: usycPct,
            eurcPct: eurcPct,
            timestamp: uint64(block.timestamp)
        });
        roundVoters[roundId].push(msg.sender);
        emit HumanVote(roundId, msg.sender, usdcPct, usycPct, eurcPct);
    }

    /// @notice Off-chain settler computes price-driven returns and a human
    ///         aggregate, then calls this. Outcomes recorded irreversibly.
    function settleRound(
        uint256 roundId,
        uint256 settleUsdcPrice,
        uint256 settleUsycPrice,
        uint256 settleEurcPrice,
        uint8 humanUsdcPct,
        uint8 humanUsycPct,
        uint8 humanEurcPct
    ) external onlySettler {
        Round storage r = rounds[roundId];
        if (r.id == 0) revert RoundNotFound();
        if (r.settled) revert RoundAlreadySettled();
        if (block.timestamp < r.settlementTime) revert RoundNotReady();
        if (uint16(humanUsdcPct) + humanUsycPct + humanEurcPct != 100) revert InvalidAllocation();

        r.settleUsdcPrice = settleUsdcPrice;
        r.settleUsycPrice = settleUsycPrice;
        r.settleEurcPrice = settleEurcPrice;
        r.humanUsdcPct = humanUsdcPct;
        r.humanUsycPct = humanUsycPct;
        r.humanEurcPct = humanEurcPct;

        // Returns: weighted return of each allocation across the three
        // assets. Bps to keep integer math, scaled at 10000.
        int256 usdcRetBps = _retBps(r.startUsdcPrice, settleUsdcPrice);
        int256 usycRetBps = _retBps(r.startUsycPrice, settleUsycPrice);
        int256 eurcRetBps = _retBps(r.startEurcPrice, settleEurcPrice);

        r.aiReturnBps = (int8(r.aiUsdcPct) * usdcRetBps
            + int8(r.aiUsycPct) * usycRetBps
            + int8(r.aiEurcPct) * eurcRetBps) / 100;
        r.humanReturnBps = (int8(humanUsdcPct) * usdcRetBps
            + int8(humanUsycPct) * usycRetBps
            + int8(humanEurcPct) * eurcRetBps) / 100;

        if (r.aiReturnBps > r.humanReturnBps) {
            r.outcome = Outcome.AI_WINS;
            aiWins++;
        } else if (r.aiReturnBps < r.humanReturnBps) {
            r.outcome = Outcome.HUMAN_WINS;
            humanWins++;
        } else {
            r.outcome = Outcome.TIE;
        }

        r.settled = true;
        emit RoundSettled(
            roundId,
            r.aiReturnBps,
            r.humanReturnBps,
            humanUsdcPct,
            humanUsycPct,
            humanEurcPct,
            r.outcome,
            settleUsdcPrice,
            settleUsycPrice,
            settleEurcPrice
        );
    }

    // Views ----

    function aiWinRateBps() external view returns (uint256) {
        uint256 settled = aiWins + humanWins;
        if (settled == 0) return 0;
        return (aiWins * 10000) / settled;
    }

    function getVotersCount(uint256 roundId) external view returns (uint256) {
        return roundVoters[roundId].length;
    }

    function _retBps(uint256 start, uint256 end) internal pure returns (int256) {
        if (start == 0) return 0;
        return int256(((int256(end) - int256(start)) * 10000) / int256(start));
    }
}
