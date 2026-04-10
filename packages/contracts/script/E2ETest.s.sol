// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Bonding} from "../src/Bonding.sol";
import {RedemptionRouter} from "../src/RedemptionRouter.sol";
import {IFPair} from "../src/interfaces/IFPair.sol";

contract E2ETest is Script {
    address constant HYPE2L = 0x0f8db745e9C28275F8B6e2BAF6BAA8eE7431b557;
    address constant BONDING = 0x80001B9766aEb92847BAdE7Ff83c333e22bfA06B;
    address constant REDEMPTION_ROUTER = 0x9466386335AdE8b10516F510E5c2BF6d2B2aA679;

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
