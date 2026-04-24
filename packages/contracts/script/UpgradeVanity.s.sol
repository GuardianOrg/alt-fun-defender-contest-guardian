// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Bonding} from "../src/Bonding.sol";

/// @notice UUPS-upgrade Bonding to enforce the on-chain vanity suffix.
///
///         The new bytecode adds:
///           - `bytes2 public constant VANITY_SUFFIX = 0xa1fa`
///           - `error NotVanityAddress(address tokenAddr)`
///           - a final `if (suffix != VANITY_SUFFIX) revert` inside
///             `_deployAndSeed`
///
///         Storage layout is unchanged (constants don't claim slots; no new
///         state vars), so no re-initialisation is required. The FERC20
///         implementation address (`tokenImplementation`) is preserved across
///         the upgrade — frontend salt mining keeps working unchanged.
///
///         LaunchpadRouter and FERC20 are bit-identical to the live deploy,
///         so they aren't touched here.
///
/// @dev    Required env vars:
///           - DEPLOYER_PRIVATE_KEY: signer (must be Bonding proxy owner).
///           - BONDING_PROXY: live proxy address.
contract UpgradeVanity is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address bondingProxy = vm.envAddress("BONDING_PROXY");

        console.log("Signer:        ", vm.addr(pk));
        console.log("Bonding proxy: ", bondingProxy);

        // Pre-flight: confirm we're upgrading something that doesn't already
        // know about VANITY_SUFFIX. If the call succeeds the upgrade is a
        // no-op — bail before burning gas.
        try Bonding(bondingProxy).VANITY_SUFFIX() returns (bytes2 existing) {
            if (existing == bytes2(0xa1fa)) {
                console.log("Bonding already enforces VANITY_SUFFIX; nothing to upgrade.");
                return;
            }
            console.log("Unexpected VANITY_SUFFIX on live proxy; refusing to upgrade.");
            revert("unexpected vanity suffix");
        } catch {
            // No `VANITY_SUFFIX()` selector on the live impl — proceed.
        }

        vm.startBroadcast(pk);

        Bonding newImpl = new Bonding();
        console.log("New Bonding impl:", address(newImpl));

        UUPSUpgradeable(bondingProxy).upgradeToAndCall(address(newImpl), "");

        vm.stopBroadcast();

        bytes2 onChain = Bonding(bondingProxy).VANITY_SUFFIX();
        console.log("Post-upgrade VANITY_SUFFIX:");
        console.logBytes2(onChain);
        require(onChain == bytes2(0xa1fa), "VANITY_SUFFIX mismatch after upgrade");

        console.log("--- Upgrade complete ---");
    }
}
