// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Bonding} from "../src/Bonding.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @notice Deploy a fresh `Bonding` implementation and upgrade the live proxy
///         to point at it. Used here to roll out the testing-mode constants
///         (`VIRTUAL_LIQUIDITY_USD = 10 ether` etc.) without redeploying the
///         entire stack — proxy address, all wiring, and existing state stay
///         intact.
///
///         Override `BONDING_PROXY` via env var to target a non-default
///         deployment. After the upgrade we ratchet
///         `graduationThresholdUsd` down to the new (lower) test value;
///         this requires the upgrade to land first because the OLD
///         implementation's `MIN_GRADUATION_THRESHOLD_USD` (= old
///         `VIRTUAL_LIQUIDITY_USD = 4000 ether`) would reject anything
///         below 4000.
contract UpgradeBonding is Script {
    address constant DEFAULT_BONDING_PROXY = 0x06dA483b9BaAfF21942D034A8E027e32d93E77CE;

    /// @dev New owner-set graduation threshold (18-dp USD). Must be >=
    ///      the new `MIN_GRADUATION_THRESHOLD_USD` enforced by the upgraded
    ///      implementation (= new `VIRTUAL_LIQUIDITY_USD`).
    uint256 constant NEW_GRADUATION_THRESHOLD = 300 ether;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address bondingProxy = vm.envOr("BONDING_PROXY", DEFAULT_BONDING_PROXY);

        console.log("Deployer:", vm.addr(pk));
        console.log("Bonding proxy:", bondingProxy);

        vm.startBroadcast(pk);

        Bonding newImpl = new Bonding();
        console.log("New Bonding impl:", address(newImpl));

        UUPSUpgradeable(bondingProxy).upgradeToAndCall(address(newImpl), "");
        console.log("Proxy upgraded.");

        Bonding(bondingProxy).setGraduationThresholdUsd(NEW_GRADUATION_THRESHOLD);
        console.log("graduationThresholdUsd set to:", NEW_GRADUATION_THRESHOLD);

        vm.stopBroadcast();

        console.log("VIRTUAL_LIQUIDITY_USD now:", Bonding(bondingProxy).VIRTUAL_LIQUIDITY_USD());
        console.log("graduationThresholdUsd now:", Bonding(bondingProxy).graduationThresholdUsd());
    }
}
