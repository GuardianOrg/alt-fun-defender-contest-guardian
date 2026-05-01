// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/// @title FeeVault
/// @notice Holds creator + protocol USDC fees from allowlisted depositors (Zaps).
/// @dev Depositors `transfer` USDC then call `accrue` — the vault never pulls
///      via `transferFrom`. Trust is bounded by an O(1) underfund check in
///      `accrue` (vault USDC balance ≥ outstanding creator + protocol claims),
///      so a buggy depositor can't inflate balances beyond delivered funds.
contract FeeVault is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    IERC20 public usdc;

    /// @notice Protocol fee recipient. Receives `claimProtocol()` payout.
    address public feeTo;

    EnumerableSet.AddressSet private _depositors;

    mapping(address => uint256) public creatorBalance;

    uint256 public protocolBalance;

    /// @notice Lifetime gross creator USDC accrued (never decreases).
    mapping(address => uint256) public lifetimeCreatorEarned;

    uint256 public lifetimeProtocolEarned;

    /// @notice Running sum of unclaimed creator balances. Lets `accrue` do its
    ///         underfund check in O(1) without iterating the creator mapping.
    uint256 public totalAccruedCreator;

    /// @dev Storage gap → 50 slots total. Append new state variables before
    ///      this gap and shrink the length to match.
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

    /// @notice Record a fee accrual. Caller MUST have transferred
    ///         `creatorAmount + protocolAmount` USDC to this vault first.
    /// @dev Reverts `UnderfundedAccrual` if the vault's USDC balance no longer
    ///      covers all outstanding claims — catches a depositor that calls
    ///      `accrue` without (or under-) transferring before user funds are lost.
    function accrue(
        address token,
        address creator,
        uint256 creatorAmount,
        uint256 protocolAmount,
        bool isBuy
    ) external onlyDepositor {
        if (creatorAmount > 0) {
            if (creator == address(0)) revert ZeroAddress();
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

    function claim() external nonReentrant returns (uint256 amount) {
        amount = creatorBalance[msg.sender];
        if (amount == 0) revert NothingToClaim();
        creatorBalance[msg.sender] = 0;
        totalAccruedCreator -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit CreatorFeesClaimed(msg.sender, amount);
    }

    function claimProtocol() external nonReentrant onlyOwner returns (uint256 amount) {
        amount = protocolBalance;
        if (amount == 0) revert NothingToClaim();
        protocolBalance = 0;
        usdc.safeTransfer(feeTo, amount);
        emit ProtocolFeesClaimed(feeTo, amount);
    }

    /// @notice Sweep unbacked USDC (donations) to `feeTo`. Required because
    ///         direct USDC transfers would otherwise inflate `balanceOf` above
    ///         the accrual tally and silently mask the `accrue` underfund
    ///         check. Owner runs periodically.
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
