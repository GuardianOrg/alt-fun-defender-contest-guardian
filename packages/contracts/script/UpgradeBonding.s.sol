// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Bonding} from "../src/Bonding.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @notice Deploy a fresh `Bonding` implementation and point the live proxy
///         at it. All existing proxy state (graduation threshold, router
///         allowlist, token records, pending-graduation entries) is preserved
///         — UUPS upgrades only swap the implementation address.
///
///         Override `BONDING_PROXY` via env var to target a non-default
///         deployment.
///
///         This upgrade adds the on-chain BounceTech LT-existence gate to
///         `Bonding.launch` (see issue #268). The new `bounceGlobalStorage`
///         storage slot is backfilled atomically with the impl swap by
///         calling the new impl's `initializeBounceGlobalStorage` from
///         `upgradeToAndCall` — `reinitializer(2)` lets it run once on a
///         proxy already at `_initialized == 1`. Skipping the backfill
///         would brick `launch` (the gate would dereference a zero
///         `bounceGlobalStorage` and revert in every launch tx).
contract UpgradeBonding is Script {
    address constant DEFAULT_BONDING_PROXY = 0x06dA483b9BaAfF21942D034A8E027e32d93E77CE;
    /// @dev BounceTech `GlobalStorage` on HyperEVM mainnet. See
    ///      `Deploy.s.sol::BOUNCE_GLOBAL_STORAGE` for source-of-truth notes.
    address constant BOUNCE_GLOBAL_STORAGE = 0xa07d06383c1863c8A54d427aC890643d76cc03ff;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address bondingProxy = vm.envOr("BONDING_PROXY", DEFAULT_BONDING_PROXY);
        address bounceGlobalStorage = vm.envOr("BOUNCE_GLOBAL_STORAGE", BOUNCE_GLOBAL_STORAGE);

        console.log("Deployer:", vm.addr(pk));
        console.log("Bonding proxy:", bondingProxy);
        console.log("BounceTech GlobalStorage:", bounceGlobalStorage);
        console.log("Current graduationThresholdUsd:", Bonding(bondingProxy).graduationThresholdUsd());

        vm.startBroadcast(pk);

        Bonding newImpl = new Bonding();
        console.log("New Bonding impl:", address(newImpl));

        // Atomic upgrade + backfill. The new impl exposes
        // `initializeBounceGlobalStorage` behind `reinitializer(2)` so it
        // runs exactly once and locks itself, leaving every other slot
        // untouched. Splitting this into a separate call would leave the
        // proxy in a window where `launch` reverts on the zero gate.
        bytes memory initCall = abi.encodeCall(Bonding.initializeBounceGlobalStorage, (bounceGlobalStorage));
        UUPSUpgradeable(bondingProxy).upgradeToAndCall(address(newImpl), initCall);
        console.log("Proxy upgraded and bounceGlobalStorage backfilled.");

        vm.stopBroadcast();

        console.log("bounceGlobalStorage:", address(Bonding(bondingProxy).bounceGlobalStorage()));
        console.log("graduationThresholdUsd (unchanged):", Bonding(bondingProxy).graduationThresholdUsd());
    }
}
