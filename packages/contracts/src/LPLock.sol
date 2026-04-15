// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @title LPLock
/// @notice Locks LP tokens from graduated tokens. No withdraw in v1.
/// @dev UUPS upgradeable to support v2 migrateLT() functionality.
///      LP tokens are sent directly to this contract during graduation.
///      recordLock() is called by the Bonding contract to track locks.
contract LPLock is UUPSUpgradeable, OwnableUpgradeable {
    struct LockInfo {
        address lpPair;
        uint256 amount;
        uint256 lockedAt;
    }

    /// @notice Token address -> lock details
    mapping(address => LockInfo) public locks;

    /// @notice Addresses authorized to record locks (Bonding contract)
    mapping(address => bool) public isLocker;

    event LPLocked(address indexed token, address indexed lpPair, uint256 amount);
    event LockerUpdated(address indexed locker, bool authorized);

    error NotAuthorized();

    function initialize(
        address owner_
    ) external initializer {
        __Ownable_init(owner_);
    }

    /// @notice Record an LP lock. Called by Bonding after graduation.
    ///         LP tokens must already be at this address.
    function recordLock(
        address token,
        address lpPair,
        uint256 amount
    ) external {
        if (!isLocker[msg.sender]) revert NotAuthorized();
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
