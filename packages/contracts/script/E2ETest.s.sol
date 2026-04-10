// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Bonding} from "../src/Bonding.sol";
import {IFPair} from "../src/interfaces/IFPair.sol";

contract E2ETest is Script {
    address constant HYPE2L = 0x0f8db745e9C28275F8B6e2BAF6BAA8eE7431b557;
    address constant BONDING = 0x80001B9766aEb92847BAdE7Ff83c333e22bfA06B;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        console.log("Deployer:", deployer);

        Bonding bonding = Bonding(BONDING);

        vm.startBroadcast(pk);

        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "E2E Test Token",
            ticker: "E2E",
            description: "End-to-end test",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: HYPE2L,
            purchaseAmount: 0
        });

        (address tokenAddr, address pairAddr,) = bonding.launch(params, deployer);
        console.log("Token:", tokenAddr);
        console.log("Pair:", pairAddr);

        vm.stopBroadcast();

        // Verify state
        IFPair pair = IFPair(pairAddr);
        (uint256 rt, uint256 ra) = pair.getReserves();
        console.log("Reserve token:", rt);
        console.log("Reserve asset:", ra);
        console.log("Trading:", bonding.isTrading(tokenAddr));
        console.log("Tokens count:", bonding.allTokensLength());
    }
}
