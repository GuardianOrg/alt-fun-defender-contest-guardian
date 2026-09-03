// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title LPLock
/// @notice Locks LP tokens from graduated tokens. No withdraw in v1.
/// @dev UUPS-upgradeable to support v2 `migrateLT` functionality.
///      Owner is the protocol multisig. Uses `Ownable2StepUpgradeable` so a
///      bad `transferOwnership` can be cancelled (or simply ignored by the
///      pending owner) before it takes effect — single-step transfer to a
///      fat-fingered or contract-incompatible address would otherwise brick
///      every owner-only path on the live proxy.
///
///      Storage uses ERC-7201 namespaced layout (no `__gap` needed). All
///      mutable state lives in `LPLockStorage` at `_LP_LOCK_STORAGE_LOCATION`.
contract LPLock is UUPSUpgradeable, Ownable2StepUpgradeable {
    struct LockInfo {
        address lpPair;
        uint256 amount;
        uint256 lockedAt;
    }

    /// @custom:storage-location erc7201:altfun.storage.LPLock
    struct LPLockStorage {
        mapping(address token => LockInfo) locks;
        /// @dev Locker allowlist for `recordLock`. Add-only via `addLocker` —
        ///      there is no removal path. A live revoke would brick every
        ///      in-flight `Bonding.finalizeGraduation` (token permanently
        ///      stuck in `Lifecycle.Graduating`, no on-chain recovery), so
        ///      the only way to retire a locker is a UUPS upgrade — which
        ///      surfaces on-chain ahead of time instead of as a one-tx kill
        ///      switch.
        mapping(address account => bool) isLocker;
    }

    // keccak256(abi.encode(uint256(keccak256("altfun.storage.LPLock")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant _LP_LOCK_STORAGE_LOCATION =
        0x57e36a555d9dab2c98f4867e0f00fcc9beedb947224d36563fd15d5248644d00;

    function _s() private pure returns (LPLockStorage storage $) {
        assembly {
            $.slot := _LP_LOCK_STORAGE_LOCATION
        }
    }

    event LPLocked(address indexed token, address indexed lpPair, uint256 amount);
    event LockerAdded(address indexed locker);

    error NotAuthorized();
    error InsufficientLPBalance();
    error AlreadyLocked();
    error LockerAlreadyAdded();
    error ZeroAddress();
    error ZeroAmount();

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_
    ) external initializer {
        __Ownable_init(owner_);
    }

    /// @notice Record an LP lock. LP tokens must already sit at this address.
    function recordLock(
        address token,
        address lpPair,
        uint256 amount
    ) external {
        LPLockStorage storage $ = _s();
        if (!$.isLocker[msg.sender]) revert NotAuthorized();
        if (lpPair == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        // `lockedAt` is the one-shot sentinel: it is always set to a non-zero
        // timestamp on the first lock, so the guard holds for any `amount`.
        if ($.locks[token].lockedAt != 0) revert AlreadyLocked();
        if (IERC20(lpPair).balanceOf(address(this)) < amount) revert InsufficientLPBalance();
        $.locks[token] = LockInfo({lpPair: lpPair, amount: amount, lockedAt: block.timestamp});
        emit LPLocked(token, lpPair, amount);
    }

    /// @notice Authorise a new `recordLock` caller. Add-only by design — see
    ///         the natspec on `LPLockStorage.isLocker` for why there's no
    ///         `removeLocker`.
    function addLocker(
        address locker
    ) external onlyOwner {
        if (locker == address(0)) revert ZeroAddress();
        LPLockStorage storage $ = _s();
        if ($.isLocker[locker]) revert LockerAlreadyAdded();
        $.isLocker[locker] = true;
        emit LockerAdded(locker);
    }

    /// @notice Mirrors the auto-generated getter for the pre-ERC-7201 public
    ///         `locks` mapping so the external ABI is unchanged.
    function locks(
        address token
    ) external view returns (address lpPair, uint256 amount, uint256 lockedAt) {
        LockInfo storage info = _s().locks[token];
        return (info.lpPair, info.amount, info.lockedAt);
    }

    function isLocker(
        address account
    ) external view returns (bool) {
        return _s().isLocker[account];
    }

    function getLock(
        address token
    ) external view returns (address lpPair, uint256 amount, uint256 lockedAt) {
        LockInfo storage info = _s().locks[token];
        return (info.lpPair, info.amount, info.lockedAt);
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyOwner {}
}
