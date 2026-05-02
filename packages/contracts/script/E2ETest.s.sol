// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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
    address constant DEFAULT_BONDING = 0xCbED46f0278a4266369d3fd0C78644A860617870;
    address constant DEFAULT_ZAP = 0x05f1Bc679F70DB71Fa311B2b45d0e0701323d217;

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

        // Mine a vanity salt off-broadcast — `Bonding._checkVanity` reverts
        // with `NotVanityAddress` unless the resulting address ends in
        // `Bonding.VANITY_TRAILING_ZEROS = 5` zero hex chars (so the
        // address renders as `0x…00000`). Pulling `tokenImplementation()`
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

        // `Zap.createToken` now enforces a `MIN_SEED_USDC` (= `$20`) seed
        // buy as part of the anti-snipe design. Approve USDC and pass the
        // floor amount so the broadcast doesn't revert with `BelowMinSeed`.
        uint256 seedAmount = zap.MIN_SEED_USDC();
        address usdcAddr = address(zap.usdc());

        vm.startBroadcast(pk);

        IERC20(usdcAddr).approve(zapAddr, seedAmount);

        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: tokenName,
            ticker: tokenTicker,
            description: "End-to-end test",
            image: "",
            urls: ["", "", ""],
            ltAddress: HYPE2L,
            salt: vanitySalt
        });

        address tokenAddr = zap.createToken(params, seedAmount);
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
