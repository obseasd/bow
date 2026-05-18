// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title BowLendingPool — Aave-style supply pool for the Bow strategy
/// @notice
///   A self-contained lending pool that demonstrates the lending leg of
///   Bow's strategy on Arc testnet. Each supported asset (USDC, USYC,
///   EURC) has a configurable supply APR. Suppliers deposit the
///   underlying ERC-20, the pool tracks their position + accrued
///   interest internally, and they can withdraw principal + interest
///   at any time.
///
///   This is a deliberate, single-purpose mock. It is NOT an Aave V3
///   port. It exists to prove that the Bow vault architecture composes
///   cleanly with a lending leg, and to give judges a working pool to
///   interact with on Arc testnet, where no production lending protocol
///   is live yet.
///
///   Interest model: linear (simple interest, no compounding within a
///   single supply). On every state-changing call we accrue interest
///   for the touched (user, asset) pair, then apply the new action.
///   This is deterministic, easy to audit, and accurate for the time
///   horizons Bow operates at.
///
///   When Aave V3 lands on Arc, BowLendingPool is replaced by a thin
///   adapter that calls Aave's `Pool.supply` and `Pool.withdraw` and
///   reads `aToken.balanceOf`. Same external API, real protocol behind.
contract BowLendingPool {
    using SafeERC20 for IERC20;

    // ============= Storage =============

    address public owner;

    struct Reserve {
        bool accepted;          // whether this asset is accepted
        uint256 supplyAprBps;   // supply APR in basis points (e.g. 330 = 3.30%)
        uint256 totalSupplied;  // gross sum across all users, ignoring interest
        uint64  totalSupplyAccrueTime; // pool-level "last accrue" for totals (optional)
    }

    struct Position {
        uint256 principal;      // current principal (with interest baked in at last update)
        uint64  lastUpdate;     // timestamp of last accrue
    }

    /// asset address => reserve params
    mapping(address => Reserve) public reserves;
    /// (user, asset) => position
    mapping(address => mapping(address => Position)) public positions;

    // ============= Events =============

    event ReserveSet(address indexed asset, bool accepted, uint256 supplyAprBps);
    event Supplied(address indexed user, address indexed asset, uint256 amount, uint256 newPrincipal);
    event Withdrawn(address indexed user, address indexed asset, uint256 amount, uint256 newPrincipal);

    // ============= Errors =============

    error OnlyOwner();
    error AssetNotAccepted();
    error AmountZero();
    error InsufficientBalance();

    // ============= Modifiers =============

    modifier onlyOwner() { if (msg.sender != owner) revert OnlyOwner(); _; }

    constructor() {
        owner = msg.sender;
    }

    // ============= Admin =============

    /// @notice Configure which assets are accepted and at what APR.
    ///         Caller is the contract owner (deployer by default). APR is
    ///         in basis points (1% = 100 bps). For example, USDC at 330
    ///         bps = 3.30% APR.
    function setReserve(address asset, bool accepted, uint256 supplyAprBps) external onlyOwner {
        reserves[asset] = Reserve({
            accepted: accepted,
            supplyAprBps: supplyAprBps,
            totalSupplied: reserves[asset].totalSupplied,
            totalSupplyAccrueTime: reserves[asset].totalSupplyAccrueTime
        });
        emit ReserveSet(asset, accepted, supplyAprBps);
    }

    // ============= Core: supply / withdraw =============

    /// @notice Supply `amount` of `asset` into the pool. The caller's
    ///         position is accrued first (interest since last touch is
    ///         added to principal), then `amount` is added on top.
    function supply(address asset, uint256 amount) external {
        if (amount == 0) revert AmountZero();
        Reserve memory r = reserves[asset];
        if (!r.accepted) revert AssetNotAccepted();

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        Position storage p = positions[msg.sender][asset];
        p.principal = _accruedBalance(p, r.supplyAprBps);
        p.principal += amount;
        p.lastUpdate = uint64(block.timestamp);

        reserves[asset].totalSupplied += amount;

        emit Supplied(msg.sender, asset, amount, p.principal);
    }

    /// @notice Withdraw `amount` of `asset` from the caller's position.
    ///         Interest is accrued first, then `amount` is subtracted
    ///         from the (principal + interest) balance and transferred.
    ///         Use type(uint256).max to withdraw the full balance.
    function withdraw(address asset, uint256 amount) external returns (uint256 withdrawn) {
        Reserve memory r = reserves[asset];
        if (!r.accepted) revert AssetNotAccepted();

        Position storage p = positions[msg.sender][asset];
        uint256 accrued = _accruedBalance(p, r.supplyAprBps);
        if (accrued == 0) revert InsufficientBalance();

        if (amount == type(uint256).max || amount > accrued) amount = accrued;
        if (amount == 0) revert AmountZero();

        p.principal = accrued - amount;
        p.lastUpdate = uint64(block.timestamp);

        // Cap totalSupplied subtraction at the principal portion that's
        // disappearing. Interest is "minted" implicitly so the principal
        // counter may drift slightly below the real outstanding balance
        // when accrued interest is large; that's fine for an MVP.
        uint256 totalReduce = amount > reserves[asset].totalSupplied ? reserves[asset].totalSupplied : amount;
        reserves[asset].totalSupplied -= totalReduce;

        IERC20(asset).safeTransfer(msg.sender, amount);
        withdrawn = amount;

        emit Withdrawn(msg.sender, asset, amount, p.principal);
    }

    // ============= Views =============

    /// @notice Current balance of a user for an asset, including
    ///         accrued interest as of `block.timestamp`. Read-only.
    function balanceOf(address user, address asset) external view returns (uint256) {
        Position memory p = positions[user][asset];
        return _accruedBalance(p, reserves[asset].supplyAprBps);
    }

    /// @notice Interest earned by a user for an asset since their last
    ///         supply/withdraw, evaluated at `block.timestamp`.
    function interestEarned(address user, address asset) external view returns (uint256) {
        Position memory p = positions[user][asset];
        uint256 acc = _accruedBalance(p, reserves[asset].supplyAprBps);
        return acc > p.principal ? acc - p.principal : 0;
    }

    /// @notice Get reserve config + total supplied for an asset.
    function getReserveInfo(address asset)
        external
        view
        returns (bool accepted, uint256 supplyAprBps, uint256 totalSupplied)
    {
        Reserve memory r = reserves[asset];
        return (r.accepted, r.supplyAprBps, r.totalSupplied);
    }

    // ============= Internals =============

    /// @dev Linear interest accrual. Returns principal + earned interest
    ///      from `p.lastUpdate` to `block.timestamp` at `aprBps`.
    function _accruedBalance(Position memory p, uint256 aprBps) internal view returns (uint256) {
        if (p.principal == 0 || p.lastUpdate == 0 || aprBps == 0) return p.principal;
        uint256 elapsed = block.timestamp - p.lastUpdate;
        // interest = principal * (aprBps / 10000) * (elapsed / SECONDS_PER_YEAR)
        // SECONDS_PER_YEAR = 31_536_000
        uint256 interest = (p.principal * aprBps * elapsed) / (10000 * 31536000);
        return p.principal + interest;
    }
}
