// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IDecisionLog} from "./IDecisionLog.sol";
import {ITournamentVault} from "./ITournamentVault.sol";

/// @title Bow HybridVaultV2 — 3-asset AI-managed treasury with lending control
/// @notice
///   V2 = V1 + lending integration. The AI operator can now deploy idle
///   vault funds into a BowLendingPool to earn yield, and pull them back
///   when users withdraw or the strategy needs liquidity. Same external
///   deposit/withdraw API as V1; the lending surface is additive + AI-only.
interface IBowLendingPool {
    function supply(address asset, uint256 amount) external;
    function withdraw(address asset, uint256 amount) external returns (uint256);
    function balanceOf(address user, address asset) external view returns (uint256);
}

contract HybridVaultV2 {
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
    error LendingNotSet();

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
    event LendingPoolUpdated(address indexed pool);
    event LendingSupplied(address indexed asset, uint256 amount);
    event LendingWithdrawn(address indexed asset, uint256 amount);

    // ============= Storage =============

    // Three managed assets (immutable after deploy)
    IERC20 public immutable USDC;
    IERC20 public immutable USYC;
    IERC20 public immutable EURC;

    address public owner;
    address public ai;

    IDecisionLog public decisionLog;
    ITournamentVault public tournament;
    IBowLendingPool public lendingPool;

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

    function setLendingPool(address _pool) external onlyOwner {
        lendingPool = IBowLendingPool(_pool);
        emit LendingPoolUpdated(_pool);
    }

    // ============= Lending control (AI-only) =============

    /// @notice Send `amount` of `asset` from the vault into the lending
    ///         pool. The vault becomes the supplier; the pool tracks the
    ///         position under the vault's address. Withdraw it back via
    ///         withdrawFromLending().
    function supplyToLending(address asset, uint256 amount) external onlyAI {
        if (amount == 0) revert AmountZero();
        if (address(lendingPool) == address(0)) revert LendingNotSet();
        IERC20 t = _assetToken(asset);
        t.safeIncreaseAllowance(address(lendingPool), amount);
        lendingPool.supply(asset, amount);
        emit LendingSupplied(asset, amount);
    }

    /// @notice Withdraw `amount` of `asset` from the lending pool back
    ///         into the vault. Use type(uint256).max to redeem the full
    ///         lending position for this asset.
    function withdrawFromLending(address asset, uint256 amount) external onlyAI returns (uint256 withdrawn) {
        if (address(lendingPool) == address(0)) revert LendingNotSet();
        // Validate asset symbol guard
        _assetToken(asset);
        withdrawn = lendingPool.withdraw(asset, amount);
        emit LendingWithdrawn(asset, withdrawn);
    }

    function _assetToken(address asset) internal view returns (IERC20) {
        if (asset == address(USDC)) return USDC;
        if (asset == address(USYC)) return USYC;
        if (asset == address(EURC)) return EURC;
        revert InvalidAsset();
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
    ///         The user receives a proportional share of the vault's
    ///         IDLE balance for each asset.
    ///
    ///         IMPORTANT: if part of the vault's funds is currently
    ///         supplied to the lending pool, the AI operator is expected
    ///         to call withdrawFromLending() BEFORE the round settles, so
    ///         that the idle balance covers all pending claims. The 1-
    ///         round cooldown is exactly the window in which the operator
    ///         reads the queued withdraws, redeems the necessary amount
    ///         from lending, and unlocks claim time. This pattern keeps
    ///         claim-time gas low and avoids cross-contract reverts.
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

        // Payouts come from the vault's idle balance (the lending position
        // is excluded — see note above; operator must pre-redeem).
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

    /// @notice Nominal USD value of vault (1:1 anchor on all three assets).
    ///         Sums both the idle balance held by the vault contract AND
    ///         the position supplied to the lending pool (which earns
    ///         interest, so this value grows over time without on-chain
    ///         deposit activity).
    function _nominalUsdValue() internal view returns (uint256) {
        return _totalAsset(address(USDC))
            + _totalAsset(address(USYC))
            + _totalAsset(address(EURC));
    }

    function _totalAsset(address asset) internal view returns (uint256) {
        uint256 idle = IERC20(asset).balanceOf(address(this));
        uint256 supplied = address(lendingPool) != address(0)
            ? lendingPool.balanceOf(address(this), asset)
            : 0;
        return idle + supplied;
    }

    function totalAssetsUsd() external view returns (uint256) {
        return _nominalUsdValue();
    }

    function getAllocation() external view returns (uint8 u, uint8 y, uint8 e) {
        return (targetUsdcPct, targetUsycPct, targetEurcPct);
    }

    /// @notice Total balances per asset, summing idle (in the vault) AND
    ///         the position supplied to the lending pool.
    function getBalances() external view returns (uint256 usdcBal, uint256 usycBal, uint256 eurcBal) {
        return (
            _totalAsset(address(USDC)),
            _totalAsset(address(USYC)),
            _totalAsset(address(EURC))
        );
    }

    /// @notice Detailed breakdown: idle in vault vs supplied to lending,
    ///         per asset. Used by the frontend to show "Idle / Lending"
    ///         columns and to compute the effective yield exposure.
    function getDetailedBalances()
        external
        view
        returns (
            uint256 usdcIdle, uint256 usdcLending,
            uint256 usycIdle, uint256 usycLending,
            uint256 eurcIdle, uint256 eurcLending
        )
    {
        usdcIdle = USDC.balanceOf(address(this));
        usycIdle = USYC.balanceOf(address(this));
        eurcIdle = EURC.balanceOf(address(this));
        if (address(lendingPool) != address(0)) {
            usdcLending = lendingPool.balanceOf(address(this), address(USDC));
            usycLending = lendingPool.balanceOf(address(this), address(USYC));
            eurcLending = lendingPool.balanceOf(address(this), address(EURC));
        }
    }

    function _absDiff(uint8 a, uint8 b) internal pure returns (uint8) {
        return a > b ? a - b : b - a;
    }
}
