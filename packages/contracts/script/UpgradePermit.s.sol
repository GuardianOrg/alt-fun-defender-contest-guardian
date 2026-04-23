// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Bonding} from "../src/Bonding.sol";
import {LaunchpadRouter} from "../src/LaunchpadRouter.sol";

/// @notice UUPS-upgrade Bonding and LaunchpadRouter to pick up the EIP-2612
///         permit additions. Bonding's bytecode is unchanged but it embeds the
///         FERC20 creation code — redeploying its implementation is what lets
///         *new* tokens launch with `ERC20Permit` support. LaunchpadRouter adds
///         `buyWithPermit` / `sellWithPermit` / `createTokenWithPermit`.
///
///         Storage layout for both contracts is unchanged (we only added
///         functions and a struct type). No re-initialisation needed.
///
/// @dev    Required env vars:
///           - DEPLOYER_PRIVATE_KEY: signer of both upgrade txs (must be the
///             current proxy owner).
///           - BONDING_PROXY, LAUNCHPAD_ROUTER_PROXY: the live proxy addresses.
contract UpgradePermit is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address bondingProxy = vm.envAddress("BONDING_PROXY");
        address routerProxy = vm.envAddress("LAUNCHPAD_ROUTER_PROXY");

        console.log("Signer:          ", vm.addr(pk));
        console.log("Bonding proxy:   ", bondingProxy);
        console.log("Router proxy:    ", routerProxy);

        vm.startBroadcast(pk);

        Bonding newBonding = new Bonding();
        console.log("Bonding impl:    ", address(newBonding));
        UUPSUpgradeable(bondingProxy).upgradeToAndCall(address(newBonding), "");

        LaunchpadRouter newRouter = new LaunchpadRouter();
        console.log("Router impl:     ", address(newRouter));
        UUPSUpgradeable(routerProxy).upgradeToAndCall(address(newRouter), "");

        vm.stopBroadcast();

        console.log("--- Upgrade complete ---");
    }
}
