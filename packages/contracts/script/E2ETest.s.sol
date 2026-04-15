// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Bonding} from "../src/Bonding.sol";
import {RedemptionRouter} from "../src/RedemptionRouter.sol";
import {IFPair} from "../src/interfaces/IFPair.sol";

contract E2ETest is Script {
    address constant HYPE2L = 0x0f8db745e9C28275F8B6e2BAF6BAA8eE7431b557;
    address constant BONDING = 0xBaC11B2C489be1405A5efeeDd1d9c6B127Ac997A;
    address constant REDEMPTION_ROUTER = 0x9A87734bE17c88810d46100d7709eC113373466d;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        console.log("Deployer:", deployer);

        Bonding bonding = Bonding(BONDING);
        RedemptionRouter router = RedemptionRouter(REDEMPTION_ROUTER);

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

        address tokenAddr = router.createToken(params, 0);
        console.log("Token:", tokenAddr);

        vm.stopBroadcast();

        Bonding.TokenInfo memory info = bonding.getTokenInfo(tokenAddr);
        address pairAddr = info.pair;
        console.log("Pair:", pairAddr);

        IFPair pair = IFPair(pairAddr);
        (uint256 rt, uint256 ra) = pair.getReserves();
        console.log("Reserve token:", rt);
        console.log("Reserve asset:", ra);
        console.log("Trading:", bonding.isTrading(tokenAddr));
        console.log("Tokens count:", bonding.allTokensLength());
    }
}
