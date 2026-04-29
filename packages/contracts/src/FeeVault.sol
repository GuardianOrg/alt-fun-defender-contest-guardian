// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/// @title FeeVault
/// @notice Holds protocol and creator USDC fees accrued from allowlisted depositors (routers).
/// @dev Depositors `transfer` USDC to this vault and then call `accrue()` to update balances.
///      The vault does NOT pull USDC via `transferFrom`; it trusts the allowlist to pass truthful
///      amounts. As a defense-in-depth check, `accrue` verifies that the vault's USDC balance
///      covers the running sum of all outstanding creator + protocol claims, so a buggy or
///      misconfigured depositor cannot inflate accruals beyond the funds actually delivered.
///
///      Creator attribution is supplied by the depositor on each call (looked up via the
///      `Bonding` token registry) — the vault itself has no opinion about what a "creator" is.
contract FeeVault is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    IERC20 public usdc;

    /// @notice Protocol fee recipient. Receives payout on `claimProtocol()`.
    address public feeTo;

    /// @dev Depositors allowed to call `accrue`. Owner-managed via `addDepositor` /
    ///      `removeDepositor`. The set model mirrors `Bonding._routers` so a router upgrade
    ///      path is always open: whitelist the new router, migrate frontends, remove the old.
    EnumerableSet.AddressSet private _depositors;

    /// @notice Pending creator USDC balances. Cleared on `claim()`.
    mapping(address => uint256) public creatorBalance;

    /// @notice Pending protocol USDC balance. Cleared on `claimProtocol()`.
    uint256 public protocolBalance;

    /// @notice Lifetime gross creator USDC accrued (never decreases). Used for UI "total earned".
    mapping(address => uint256) public lifetimeCreatorEarned;

    /// @notice Lifetime gross protocol USDC accrued (never decreases).
    uint256 public lifetimeProtocolEarned;

    /// @notice Sum of all unclaimed `creatorBalance` entries. Tracked as a running counter so
    ///         `accrue` can verify the vault's USDC balance covers every outstanding claim in
    ///         O(1) without iterating the creator mapping.
    uint256 public totalAccruedCreator;

    /// @dev Storage gap for future upgrades. Sized so this contract's storage block
    ///      totals 50 slots (9 named + 41 gap). Append new state variables before
    ///      this gap and shrink its length to match.
    uint256[41] private __gap;

    event FeeAccrued(
        address indexed token, address indexed creator, uint256 creatorAmount, uint256 protocolAmount, bool isBuy
    );
    event CreatorFeesClaimed(address indexed creator, uint256 amount);
    event ProtocolFeesClaimed(address indexed feeTo, uint256 amount);
    event DonationsSwept(address indexed feeTo, uint256 amount);
    event DepositorAdded(address indexed depositor);
    event DepositorRemoved(address indexed depositor);
    event FeeToUpdated(address indexed feeTo);

    error NotDepositor();
    error NothingToClaim();
    error ZeroAddress();
    error DepositorAlreadyAdded();
    error DepositorNotFound();
    error UnderfundedAccrual();

    modifier onlyDepositor() {
        if (!_depositors.contains(msg.sender)) revert NotDepositor();
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address usdc_,
        address feeTo_
    ) external initializer {
        if (usdc_ == address(0) || feeTo_ == address(0)) revert ZeroAddress();
        __Ownable_init(msg.sender);
        usdc = IERC20(usdc_);
        feeTo = feeTo_;
    }

    // ─── Accrual (depositor-only) ────────────────────────────────────────

    /// @notice Record a fee accrual. The caller MUST have transferred
    ///         `creatorAmount + protocolAmount` USDC to this vault prior to calling.
    /// @dev Reverts with `UnderfundedAccrual` if the vault's USDC balance does not cover
    ///      the running sum of every outstanding creator + protocol claim after this call.
    ///      This catches a buggy or misconfigured depositor that calls `accrue` without
    ///      first transferring (or with an inflated amount) before any user funds are lost.
    /// @param token         Token the fee is attributed to (informational, emitted in event).
    /// @param creator       Creator receiving the creator share.
    /// @param creatorAmount Creator USDC share (6dp).
    /// @param protocolAmount Protocol USDC share (6dp).
    /// @param isBuy         Whether the trade was a buy (informational, emitted in event).
    function accrue(
        address token,
        address creator,
        uint256 creatorAmount,
        uint256 protocolAmount,
        bool isBuy
    ) external onlyDepositor {
        if (creatorAmount > 0) {
            creatorBalance[creator] += creatorAmount;
            totalAccruedCreator += creatorAmount;
            lifetimeCreatorEarned[creator] += creatorAmount;
        }
        if (protocolAmount > 0) {
            protocolBalance += protocolAmount;
            lifetimeProtocolEarned += protocolAmount;
        }
        if (usdc.balanceOf(address(this)) < totalAccruedCreator + protocolBalance) revert UnderfundedAccrual();
        emit FeeAccrued(token, creator, creatorAmount, protocolAmount, isBuy);
    }

    // ─── Claims ──────────────────────────────────────────────────────────

    /// @notice Claim the caller's pending creator USDC. Reverts if zero.
    function claim() external nonReentrant returns (uint256 amount) {
        amount = creatorBalance[msg.sender];
        if (amount == 0) revert NothingToClaim();
        creatorBalance[msg.sender] = 0;
        totalAccruedCreator -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit CreatorFeesClaimed(msg.sender, amount);
    }

    /// @notice Send pending protocol USDC to the configured `feeTo`. Owner-only.
    function claimProtocol() external nonReentrant onlyOwner returns (uint256 amount) {
        amount = protocolBalance;
        if (amount == 0) revert NothingToClaim();
        protocolBalance = 0;
        usdc.safeTransfer(feeTo, amount);
        emit ProtocolFeesClaimed(feeTo, amount);
    }

    /// @notice Sweep any USDC in the vault that is not backing an outstanding accrual to `feeTo`.
    /// @dev Direct USDC donations to the vault would otherwise inflate `balanceOf` above the
    ///      running accrual tally, masking the `accrue` underfund check: a buggy depositor that
    ///      called `accrue` without first transferring USDC could be silently back-filled by
    ///      donation funds. Owner runs this periodically so `balanceOf` stays aligned with
    ///      `totalAccruedCreator + protocolBalance` and the underfund check remains effective.
    function sweepDonations() external nonReentrant onlyOwner returns (uint256 amount) {
        uint256 backed = totalAccruedCreator + protocolBalance;
        uint256 balance = usdc.balanceOf(address(this));
        if (balance <= backed) revert NothingToClaim();
        amount = balance - backed;
        usdc.safeTransfer(feeTo, amount);
        emit DonationsSwept(feeTo, amount);
    }

    // ─── Admin ───────────────────────────────────────────────────────────

    function addDepositor(
        address depositor
    ) external onlyOwner {
        if (depositor == address(0)) revert ZeroAddress();
        if (!_depositors.add(depositor)) revert DepositorAlreadyAdded();
        emit DepositorAdded(depositor);
    }

    function removeDepositor(
        address depositor
    ) external onlyOwner {
        if (!_depositors.remove(depositor)) revert DepositorNotFound();
        emit DepositorRemoved(depositor);
    }

    function setFeeTo(
        address feeTo_
    ) external onlyOwner {
        if (feeTo_ == address(0)) revert ZeroAddress();
        feeTo = feeTo_;
        emit FeeToUpdated(feeTo_);
    }

    // ─── Views ───────────────────────────────────────────────────────────

    function isDepositor(
        address depositor
    ) external view returns (bool) {
        return _depositors.contains(depositor);
    }

    function getDepositors() external view returns (address[] memory) {
        return _depositors.values();
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyOwner {}
}
