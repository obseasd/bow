// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IDecisionLog} from "./IDecisionLog.sol";
import {ITournamentVault} from "./ITournamentVault.sol";

/// @title Bow HybridVault — 3-asset AI-managed treasury on Arc
/// @notice
///   Bow is a "hybrid staking" DeFi primitive: it mixes a pure stable
///   (USDC), a tokenized T-bill (USYC), and a multi-currency stable (EURC)
///   into a single treasury rebalanced by an off-chain AI operator.
///
///   Three design choices distinguish Bow from a standard ERC-4626 vault:
///   1. Multi-asset accounting — users deposit any of the three accepted
///      assets, get shares in proportion to USD value at deposit time, and
///      can exit in the mix that the vault currently holds.
///   2. Cooldown withdraw — requestWithdraw burns shares into a pending
///      request linked to the current tournament round. The request becomes
///      claimable only after that round settles, which prevents
///      flash-deposit / sandwich attacks against the AI's rebalance call.
///   3. Cost-aware rebalance — executeAllocation rejects targets that do
///      not clear the on-chain minRebalanceBps threshold and respects a
///      minimum time between rebalances. The off-chain agent prompt is
///      tuned to skip rebalances whose expected alpha does not exceed gas
///      plus slippage, sourced from real Arc DEX data.
contract HybridVault {
    using SafeERC20 for IERC20;

    // ============= Errors =============
    error OnlyOwner();
    error OnlyAI();
    error InvalidAsset();
    error InvalidAllocation();
    error AllocChangeTooSmall();
    error AmountZero();
    error InsufficientShares();
    error NothingPending();
    error CooldownNotElapsed();
    error AlreadyClaimed();
    error RebalanceCooldown();

    // ============= Events =============
    event Deposit(address indexed user, address indexed asset, uint256 amount, uint256 sharesMinted);
    event WithdrawRequested(address indexed user, uint256 shares, uint256 requestedRoundId);
    event WithdrawClaimed(
        address indexed user,
        uint256 shares,
        uint256 usdcOut,
        uint256 usycOut,
        uint256 eurcOut
    );
    event AllocationExecuted(
        uint256 indexed decisionId,
        uint8 newUsdcPct,
        uint8 newUsycPct,
        uint8 newEurcPct,
        uint256 roundId
    );
    event AssetUpdated(address indexed asset, bool accepted);
    event RiskCapsUpdated(uint256 minRebalanceBps, uint256 minTimeBetweenRebalances);

    // ============= Storage =============

    // Three managed assets (immutable after deploy)
    IERC20 public immutable USDC;
    IERC20 public immutable USYC;
    IERC20 public immutable EURC;

    address public owner;
    address public ai;

    IDecisionLog public decisionLog;
    ITournamentVault public tournament;

    // Allocation targets in percentage points (sum == 100). Defaults to
    // 50% USDC / 30% USYC / 20% EURC, modest stable-leaning bootstrap mix.
    uint8 public targetUsdcPct = 50;
    uint8 public targetUsycPct = 30;
    uint8 public targetEurcPct = 20;

    // Risk caps
    uint256 public minRebalanceBps = 200;            // 2pp minimum alloc change
    uint256 public minTimeBetweenRebalances = 6 hours;
    uint256 public lastRebalanceAt;

    // Share accounting (ERC-4626 inspired but multi-asset)
    uint256 public totalShares;
    mapping(address => uint256) public shareBalance;

    // Pending withdraws keyed by user (one slot per user, simplest UX)
    struct PendingWithdraw {
        uint256 shares;
        uint256 requestedRoundId;
        uint64 requestedAt;
        bool claimed;
    }
    mapping(address => PendingWithdraw) public pendingWithdraws;

    // ============= Modifiers =============
    modifier onlyOwner() { if (msg.sender != owner) revert OnlyOwner(); _; }
    modifier onlyAI() { if (msg.sender != ai) revert OnlyAI(); _; }

    // ============= Constructor =============
    constructor(address _usdc, address _usyc, address _eurc, address _ai) {
        USDC = IERC20(_usdc);
        USYC = IERC20(_usyc);
        EURC = IERC20(_eurc);
        owner = msg.sender;
        ai = _ai;
    }

    // ============= Admin wiring =============

    function setAI(address _ai) external onlyOwner { ai = _ai; }

    function setDecisionLog(address _log) external onlyOwner {
        decisionLog = IDecisionLog(_log);
    }

    function setTournament(address _tournament) external onlyOwner {
        tournament = ITournamentVault(_tournament);
    }

    function setRiskCaps(uint256 _minRebalanceBps, uint256 _minTime) external onlyOwner {
        minRebalanceBps = _minRebalanceBps;
        minTimeBetweenRebalances = _minTime;
        emit RiskCapsUpdated(_minRebalanceBps, _minTime);
    }

    // ============= Deposit =============

    /// @notice Deposit one of the three accepted assets. Shares minted are
    ///         proportional to the asset's nominal value at deposit time.
    ///         A "nominal value" model is used in this MVP: 1 USDC = 1 USD,
    ///         1 USYC = 1 USD (we read the current price from a price oracle
    ///         in V2; today we treat 1:1 as a conservative anchor), 1 EURC =
    ///         the spot EUR/USD rate (in V2; conservative 1:1 anchor here).
    ///         This keeps the MVP simple; the share model upgrades to
    ///         price-oracle-driven valuation in the next iteration.
    function deposit(address asset, uint256 amount) external returns (uint256 sharesMinted) {
        if (amount == 0) revert AmountZero();

        IERC20 token;
        if (asset == address(USDC)) token = USDC;
        else if (asset == address(USYC)) token = USYC;
        else if (asset == address(EURC)) token = EURC;
        else revert InvalidAsset();

        token.safeTransferFrom(msg.sender, address(this), amount);

        // Shares: if first deposit, 1:1 with amount. Otherwise proportional
        // to the post-deposit nominal value of the vault. Nominal value =
        // sum of all asset balances at 1:1 in USD (V1 simplification).
        uint256 nominalBefore = _nominalUsdValue() - amount; // before this deposit
        if (totalShares == 0 || nominalBefore == 0) {
            sharesMinted = amount;
        } else {
            sharesMinted = (amount * totalShares) / nominalBefore;
        }

        totalShares += sharesMinted;
        shareBalance[msg.sender] += sharesMinted;

        emit Deposit(msg.sender, asset, amount, sharesMinted);
    }

    // ============= Withdraw (with cooldown) =============

    /// @notice Request a withdraw. Burns shares into a pending request
    ///         linked to the current round. Claimable only after that round
    ///         settles, which prevents users from sandwiching the AI's
    ///         rebalance.
    function requestWithdraw(uint256 shares) external {
        if (shares == 0) revert AmountZero();
        if (shareBalance[msg.sender] < shares) revert InsufficientShares();

        // Burn shares now (locked from voting + earning further yield).
        shareBalance[msg.sender] -= shares;

        uint256 currentRound = address(tournament) != address(0)
            ? tournament.totalRounds()
            : 0;

        pendingWithdraws[msg.sender] = PendingWithdraw({
            shares: shares,
            requestedRoundId: currentRound,
            requestedAt: uint64(block.timestamp),
            claimed: false
        });

        emit WithdrawRequested(msg.sender, shares, currentRound);
    }

    /// @notice Claim a previously-requested withdraw. Requires that the
    ///         current round id strictly exceeds the requested round id.
    ///         The user receives a proportional share of every asset the
    ///         vault holds at claim time.
    function claimWithdraw() external {
        PendingWithdraw storage w = pendingWithdraws[msg.sender];
        if (w.shares == 0) revert NothingPending();
        if (w.claimed) revert AlreadyClaimed();

        uint256 currentRound = address(tournament) != address(0)
            ? tournament.totalRounds()
            : type(uint256).max;
        if (currentRound <= w.requestedRoundId) revert CooldownNotElapsed();

        w.claimed = true;

        uint256 shares = w.shares;
        // Compute proportional payout in each asset. Shares were already
        // burned in requestWithdraw, so totalShares + shares is the supply
        // they were entitled to at request time.
        uint256 supplyAtRequest = totalShares + shares;

        uint256 usdcBal = USDC.balanceOf(address(this));
        uint256 usycBal = USYC.balanceOf(address(this));
        uint256 eurcBal = EURC.balanceOf(address(this));

        uint256 usdcOut = (usdcBal * shares) / supplyAtRequest;
        uint256 usycOut = (usycBal * shares) / supplyAtRequest;
        uint256 eurcOut = (eurcBal * shares) / supplyAtRequest;

        if (usdcOut > 0) USDC.safeTransfer(msg.sender, usdcOut);
        if (usycOut > 0) USYC.safeTransfer(msg.sender, usycOut);
        if (eurcOut > 0) EURC.safeTransfer(msg.sender, eurcOut);

        emit WithdrawClaimed(msg.sender, shares, usdcOut, usycOut, eurcOut);
    }

    // ============= AI execute allocation =============

    /// @notice Off-chain AI operator calls this to update target
    ///         allocation. Three percentages must sum to 100. The change
    ///         must clear minRebalanceBps and respect the cooldown.
    ///         Opens a tournament round atomically if tournament is wired.
    function executeAllocation(
        uint8 newUsdcPct,
        uint8 newUsycPct,
        uint8 newEurcPct,
        string calldata reasoning,
        uint8 confidence
    ) external onlyAI returns (uint256 decisionId, uint256 roundId) {
        if (uint16(newUsdcPct) + newUsycPct + newEurcPct != 100) revert InvalidAllocation();

        // Cooldown
        if (lastRebalanceAt > 0 && block.timestamp < lastRebalanceAt + minTimeBetweenRebalances) {
            revert RebalanceCooldown();
        }

        // Min rebalance delta: max absolute change across the three legs
        uint8 dUsdc = _absDiff(newUsdcPct, targetUsdcPct);
        uint8 dUsyc = _absDiff(newUsycPct, targetUsycPct);
        uint8 dEurc = _absDiff(newEurcPct, targetEurcPct);
        uint8 maxDelta = dUsdc > dUsyc ? dUsdc : dUsyc;
        if (dEurc > maxDelta) maxDelta = dEurc;
        if (uint256(maxDelta) * 100 < minRebalanceBps) revert AllocChangeTooSmall();

        targetUsdcPct = newUsdcPct;
        targetUsycPct = newUsycPct;
        targetEurcPct = newEurcPct;
        lastRebalanceAt = block.timestamp;

        if (address(decisionLog) != address(0)) {
            decisionId = decisionLog.logDecision(
                msg.sender,
                newUsdcPct,
                newUsycPct,
                newEurcPct,
                confidence,
                reasoning
            );
        }

        if (address(tournament) != address(0)) {
            roundId = tournament.openRound(newUsdcPct, newUsycPct, newEurcPct);
        }

        emit AllocationExecuted(decisionId, newUsdcPct, newUsycPct, newEurcPct, roundId);
    }

    // ============= Views =============

    /// @notice Nominal USD value of vault (V1 simplification, 1:1 anchor on
    ///         all three assets). V2 will use Chainlink-style price feeds.
    function _nominalUsdValue() internal view returns (uint256) {
        return USDC.balanceOf(address(this))
            + USYC.balanceOf(address(this))
            + EURC.balanceOf(address(this));
    }

    function totalAssetsUsd() external view returns (uint256) {
        return _nominalUsdValue();
    }

    function getAllocation() external view returns (uint8 u, uint8 y, uint8 e) {
        return (targetUsdcPct, targetUsycPct, targetEurcPct);
    }

    function getBalances() external view returns (uint256 usdcBal, uint256 usycBal, uint256 eurcBal) {
        return (
            USDC.balanceOf(address(this)),
            USYC.balanceOf(address(this)),
            EURC.balanceOf(address(this))
        );
    }

    function _absDiff(uint8 a, uint8 b) internal pure returns (uint8) {
        return a > b ? a - b : b - a;
    }
}
