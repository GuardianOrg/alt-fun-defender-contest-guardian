// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Bonding} from "../src/Bonding.sol";
import {Zap} from "../src/Zap.sol";
import {IPair} from "../src/interfaces/IPair.sol";
import {VanityMining} from "../src/lib/VanityMining.sol";

contract E2ETest is Script {
    /// @dev Pinned LT on HyperEVM mainnet — same `HYPE2L` used by the test
    ///      suite in `DeployHelper.sol`. Not deployed by us, so it stays a
    ///      constant rather than a per-deploy env var.
    address constant HYPE2L = 0x0f8db745e9C28275F8B6e2BAF6BAA8eE7431b557;

    /// @dev Defaults track the currently-live deployment recorded in
    ///      `packages/shared/src/constants/addresses.ts`. Override via
    ///      `BONDING_ADDRESS` / `ZAP_ADDRESS` env vars when
    ///      pointing the script at a different deployment (staging, fork,
    ///      next mainnet rev, etc.) so the script stays runnable without a
    ///      recompile after every upgrade.
    address constant DEFAULT_BONDING = 0x06dA483b9BaAfF21942D034A8E027e32d93E77CE;
    address constant DEFAULT_ZAP = 0x38c3EdA163A6ae77427D36Aa284667D605b7A907;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        console.log("Deployer:", deployer);

        address bondingAddr = vm.envOr("BONDING_ADDRESS", DEFAULT_BONDING);
        address zapAddr = vm.envOr("ZAP_ADDRESS", DEFAULT_ZAP);
        console.log("Bonding:", bondingAddr);
        console.log("Zap:", zapAddr);

        Bonding bonding = Bonding(bondingAddr);
        Zap zap = Zap(zapAddr);

        // Mine a vanity salt off-broadcast — `Bonding._deployAndSeed` reverts
        // with `NotVanityAddress` unless the resulting address ends in
        // `Bonding.VANITY_SUFFIX` (`0xa1fa`). Pulling `tokenImplementation()`
        // from the live Bonding (rather than hardcoding) means a future
        // `Token` implementation upgrade doesn't break the script.
        string memory tokenName = "E2E Test Token";
        string memory tokenTicker = "E2E";
        bytes32 vanitySalt = VanityMining.mine(
            deployer,
            keccak256(bytes(tokenName)),
            keccak256(bytes(tokenTicker)),
            bonding.tokenImplementation(),
            bondingAddr,
            keccak256(abi.encode(block.timestamp))
        );
        console.log("Mined vanity salt:");
        console.logBytes32(vanitySalt);

        vm.startBroadcast(pk);

        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: tokenName,
            ticker: tokenTicker,
            description: "End-to-end test",
            image: "",
            urls: ["", "", ""],
            ltAddress: HYPE2L,
            salt: vanitySalt
        });

        address tokenAddr = zap.createToken(params, 0);
        console.log("Token:", tokenAddr);

        vm.stopBroadcast();

        Bonding.TokenInfo memory info = bonding.getTokenInfo(tokenAddr);
        address pairAddr = info.pair;
        console.log("Pair:", pairAddr);

        IPair pair = IPair(pairAddr);
        (uint256 rt, uint256 ra) = pair.getReserves();
        console.log("Reserve token:", rt);
        console.log("Reserve asset:", ra);
        console.log("Trading:", bonding.isTrading(tokenAddr));
    }
}
