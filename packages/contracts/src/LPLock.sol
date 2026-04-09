// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @title LPLock
/// @notice Locks LP tokens from graduated tokens. No withdraw in v1.
/// @dev UUPS upgradeable to support v2 migrateLT() functionality.
contract LPLock is UUPSUpgradeable, OwnableUpgradeable {
    // TODO: Implement
    // Key features:
    // - Lock LP tokens after graduation
    // - No withdraw function in v1
    // - v2 will add migrateLT() for paired-LT migration
    // - Emit events for transparency

    event LPLocked(address indexed token, address indexed pair, uint256 amount);

    function initialize(
        address owner_
    ) external initializer {
        __Ownable_init(owner_);
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyOwner {}
}
