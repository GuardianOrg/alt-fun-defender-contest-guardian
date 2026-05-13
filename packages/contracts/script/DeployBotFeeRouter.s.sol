// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BotFeeRouter} from "../src/BotFeeRouter.sol";
import {IZap} from "../src/interfaces/IZap.sol";

/// @notice Standalone deploy for `BotFeeRouter` against an already-deployed
///         `Zap`. Use this on mainnet when the rest of the Alt Fun stack
///         is already live and you only need to add (or rotate) the router.
///         For first-time stack deploys, `Deploy.s.sol` already deploys
///         `BotFeeRouter` as part of the same broadcast.
///
/// Required env:
///   - `DEPLOYER_PRIVATE_KEY` — funded HyperEVM wallet
///   - `ZAP_ADDRESS`          — existing Zap proxy
///   - `BOT_FEE_TREASURY`     — cold wallet for the bot operator's fee
///
/// Optional env:
///   - `USDC_ADDRESS` — override for non-mainnet runs; defaults to
///                      HyperEVM mainnet USDC.
contract DeployBotFeeRouter is Script {
    address constant DEFAULT_USDC = 0xb88339CB7199b77E23DB6E890353E22632Ba630f;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address zapAddress = vm.envAddress("ZAP_ADDRESS");
        address treasury = vm.envAddress("BOT_FEE_TREASURY");
        address usdc;
        try vm.envAddress("USDC_ADDRESS") returns (address u) {
            usdc = u;
        } catch {
            usdc = DEFAULT_USDC;
        }

        console.log("Deployer:", vm.addr(deployerPrivateKey));
        console.log("Zap:", zapAddress);
        console.log("USDC:", usdc);
        console.log("Treasury:", treasury);

        vm.startBroadcast(deployerPrivateKey);
        BotFeeRouter router = new BotFeeRouter(IZap(zapAddress), IERC20(usdc), treasury);
        vm.stopBroadcast();

        console.log("BotFeeRouter:", address(router));
    }
}
