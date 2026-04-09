// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title RedemptionRouter
/// @notice Single entry point for users: pay USDC, receive memecoins (and vice versa).
/// @dev Handles USDC -> LT mint -> bonding curve buy (or HyperSwap swap post-graduation).
///      Sell path: memecoin -> LT -> USDC redeem.
///      UUPS upgradeable. Per-token LT mapping via ltForToken.
contract RedemptionRouter is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard {
    // TODO: Implement
    // Key features:
    // - Per-token ltForToken mapping
    // - Phase detection (curve vs graduated) to route appropriately
    // - Atomic path: USDC -> mint LT -> buy on curve -> tokens to user
    // - Reverse path: tokens -> sell on curve -> redeem LT -> USDC to user
    // - Post-graduation: route through HyperSwap instead of bonding curve
    // - AlreadyRedeeming guard (one pending per address per LT)

    function initialize(
        address owner_
    ) external initializer {
        __Ownable_init(owner_);
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyOwner {}
}
