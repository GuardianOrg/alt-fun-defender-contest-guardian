// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
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
///      Owner is the protocol multisig. Uses `Ownable2StepUpgradeable` so a
///      bad `transferOwnership` can be cancelled (or simply ignored by the
///      pending owner) before it takes effect — single-step transfer to a
///      fat-fingered or contract-incompatible address would otherwise brick
///      every owner-only path on the live proxy.
///
///      Storage uses ERC-7201 namespaced layout (no `__gap` needed). All
///      mutable state lives in `FeeVaultStorage` at
///      `_FEE_VAULT_STORAGE_LOCATION`. See
///      `packages/contracts/AGENTS.md#storage-layout`.
contract FeeVault is UUPSUpgradeable, Ownable2StepUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @custom:storage-location erc7201:altfun.storage.FeeVault
    struct FeeVaultStorage {
        IERC20 usdc;
        /// @notice Protocol fee recipient. Receives `claimProtocol()` payout.
        address feeTo;
        EnumerableSet.AddressSet depositors;
        mapping(address creator => uint256) creatorBalance;
        uint256 protocolBalance;
        /// @notice Lifetime gross creator USDC accrued (never decreases).
        mapping(address creator => uint256) lifetimeCreatorEarned;
        uint256 lifetimeProtocolEarned;
        /// @notice Running sum of unclaimed creator balances. Lets `accrue`
        ///         do its underfund check in O(1) without iterating the
        ///         creator mapping.
        uint256 totalAccruedCreator;
    }

    // keccak256(abi.encode(uint256(keccak256("altfun.storage.FeeVault")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant _FEE_VAULT_STORAGE_LOCATION =
        0xa926bb40d5eda4681728c5a36d6763beef85e2d2279081fc5cff7e744da2d700;

    function _s() private pure returns (FeeVaultStorage storage $) {
        assembly {
            $.slot := _FEE_VAULT_STORAGE_LOCATION
        }
    }

    event FeeAccrued(
        address indexed token, address indexed creator, uint256 creatorAmount, uint256 protocolAmount, bool isBuy
    );
    event CreatorFeesClaimed(address indexed creator, uint256 amount);
    event ProtocolFeesClaimed(address indexed feeTo, uint256 amount);
    event DonationsSwept(address indexed feeTo, uint256 amount);
    event DepositorAdded(address indexed depositor);
    event DepositorRemoved(address indexed depositor);
    event FeeToUpdated(address indexed oldFeeTo, address indexed newFeeTo);

    error NotDepositor();
    error NothingToClaim();
    error ZeroAddress();
    error DepositorAlreadyAdded();
    error DepositorNotFound();
    error UnderfundedAccrual();

    modifier onlyDepositor() {
        if (!_s().depositors.contains(msg.sender)) revert NotDepositor();
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
        FeeVaultStorage storage $ = _s();
        $.usdc = IERC20(usdc_);
        $.feeTo = feeTo_;
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
        FeeVaultStorage storage $ = _s();
        if (creatorAmount > 0) {
            if (creator == address(0)) revert ZeroAddress();
            $.creatorBalance[creator] += creatorAmount;
            $.totalAccruedCreator += creatorAmount;
            $.lifetimeCreatorEarned[creator] += creatorAmount;
        }
        if (protocolAmount > 0) {
            $.protocolBalance += protocolAmount;
            $.lifetimeProtocolEarned += protocolAmount;
        }
        if ($.usdc.balanceOf(address(this)) < $.totalAccruedCreator + $.protocolBalance) {
            revert UnderfundedAccrual();
        }
        emit FeeAccrued(token, creator, creatorAmount, protocolAmount, isBuy);
    }

    // ─── Claims ──────────────────────────────────────────────────────────

    function claim() external nonReentrant returns (uint256 amount) {
        FeeVaultStorage storage $ = _s();
        amount = $.creatorBalance[msg.sender];
        if (amount == 0) revert NothingToClaim();
        $.creatorBalance[msg.sender] = 0;
        $.totalAccruedCreator -= amount;
        $.usdc.safeTransfer(msg.sender, amount);
        emit CreatorFeesClaimed(msg.sender, amount);
    }

    function claimProtocol() external nonReentrant returns (uint256 amount) {
        FeeVaultStorage storage $ = _s();
        amount = $.protocolBalance;
        if (amount == 0) revert NothingToClaim();
        $.protocolBalance = 0;
        address feeTo_ = $.feeTo;
        $.usdc.safeTransfer(feeTo_, amount);
        emit ProtocolFeesClaimed(feeTo_, amount);
    }

    /// @notice Sweep unbacked USDC (donations) to `feeTo`. Required because
    ///         direct USDC transfers would otherwise inflate `balanceOf` above
    ///         the accrual tally and silently mask the `accrue` underfund
    ///         check. Permissionless — funds always go to the admin-set `feeTo`.
    function sweepDonations() external nonReentrant returns (uint256 amount) {
        FeeVaultStorage storage $ = _s();
        uint256 backed = $.totalAccruedCreator + $.protocolBalance;
        uint256 balance = $.usdc.balanceOf(address(this));
        if (balance <= backed) revert NothingToClaim();
        amount = balance - backed;
        address feeTo_ = $.feeTo;
        $.usdc.safeTransfer(feeTo_, amount);
        emit DonationsSwept(feeTo_, amount);
    }

    // ─── Admin ───────────────────────────────────────────────────────────

    function addDepositor(
        address depositor
    ) external onlyOwner {
        if (depositor == address(0)) revert ZeroAddress();
        if (!_s().depositors.add(depositor)) revert DepositorAlreadyAdded();
        emit DepositorAdded(depositor);
    }

    function removeDepositor(
        address depositor
    ) external onlyOwner {
        if (!_s().depositors.remove(depositor)) revert DepositorNotFound();
        emit DepositorRemoved(depositor);
    }

    function setFeeTo(
        address feeTo_
    ) external onlyOwner {
        if (feeTo_ == address(0)) revert ZeroAddress();
        FeeVaultStorage storage $ = _s();
        address old = $.feeTo;
        $.feeTo = feeTo_;
        emit FeeToUpdated(old, feeTo_);
    }

    // ─── Views ───────────────────────────────────────────────────────────

    function usdc() external view returns (IERC20) {
        return _s().usdc;
    }

    function feeTo() external view returns (address) {
        return _s().feeTo;
    }

    function creatorBalance(
        address creator
    ) external view returns (uint256) {
        return _s().creatorBalance[creator];
    }

    function protocolBalance() external view returns (uint256) {
        return _s().protocolBalance;
    }

    function lifetimeCreatorEarned(
        address creator
    ) external view returns (uint256) {
        return _s().lifetimeCreatorEarned[creator];
    }

    function lifetimeProtocolEarned() external view returns (uint256) {
        return _s().lifetimeProtocolEarned;
    }

    function totalAccruedCreator() external view returns (uint256) {
        return _s().totalAccruedCreator;
    }

    function isDepositor(
        address depositor
    ) external view returns (bool) {
        return _s().depositors.contains(depositor);
    }

    function getDepositors() external view returns (address[] memory) {
        return _s().depositors.values();
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyOwner {}
}
