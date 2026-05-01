// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title LPLock
/// @notice Locks LP tokens from graduated tokens. No withdraw in v1.
/// @dev UUPS-upgradeable to support v2 `migrateLT` functionality.
contract LPLock is UUPSUpgradeable, OwnableUpgradeable {
    struct LockInfo {
        address lpPair;
        uint256 amount;
        uint256 lockedAt;
    }

    mapping(address => LockInfo) public locks;

    mapping(address => bool) public isLocker;

    /// @dev Storage gap → 50 slots total. Append new state variables before
    ///      this gap and shrink the length to match.
    uint256[48] private __gap;

    event LPLocked(address indexed token, address indexed lpPair, uint256 amount);
    event LockerUpdated(address indexed locker, bool authorized);

    error NotAuthorized();
    error InsufficientLPBalance();
    error AlreadyLocked();

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
        if (!isLocker[msg.sender]) revert NotAuthorized();
        if (locks[token].amount != 0) revert AlreadyLocked();
        if (IERC20(lpPair).balanceOf(address(this)) < amount) revert InsufficientLPBalance();
        locks[token] = LockInfo({lpPair: lpPair, amount: amount, lockedAt: block.timestamp});
        emit LPLocked(token, lpPair, amount);
    }

    function setLocker(
        address locker,
        bool authorized
    ) external onlyOwner {
        isLocker[locker] = authorized;
        emit LockerUpdated(locker, authorized);
    }

    function getLock(
        address token
    ) external view returns (address lpPair, uint256 amount, uint256 lockedAt) {
        LockInfo storage info = locks[token];
        return (info.lpPair, info.amount, info.lockedAt);
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyOwner {}
}
