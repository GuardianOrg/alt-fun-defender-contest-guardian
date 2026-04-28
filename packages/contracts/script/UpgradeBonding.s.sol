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
///         This upgrade adds metadata length caps to `Bonding.launch`:
///         - description <= 8 000 bytes
///         - image        <=   512 bytes
///         - each url[i]  <=   512 bytes
///         No storage layout changes; no initializer call required.
contract UpgradeBonding is Script {
    address constant DEFAULT_BONDING_PROXY = 0x06dA483b9BaAfF21942D034A8E027e32d93E77CE;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address bondingProxy = vm.envOr("BONDING_PROXY", DEFAULT_BONDING_PROXY);

        console.log("Deployer:", vm.addr(pk));
        console.log("Bonding proxy:", bondingProxy);
        console.log("Current graduationThresholdUsd:", Bonding(bondingProxy).graduationThresholdUsd());

        vm.startBroadcast(pk);

        Bonding newImpl = new Bonding();
        console.log("New Bonding impl:", address(newImpl));

        UUPSUpgradeable(bondingProxy).upgradeToAndCall(address(newImpl), "");
        console.log("Proxy upgraded.");

        vm.stopBroadcast();

        console.log("MAX_DESCRIPTION_LENGTH:", Bonding(bondingProxy).MAX_DESCRIPTION_LENGTH());
        console.log("MAX_IMAGE_LENGTH:", Bonding(bondingProxy).MAX_IMAGE_LENGTH());
        console.log("MAX_URL_LENGTH:", Bonding(bondingProxy).MAX_URL_LENGTH());
        console.log("graduationThresholdUsd (unchanged):", Bonding(bondingProxy).graduationThresholdUsd());
    }
}
