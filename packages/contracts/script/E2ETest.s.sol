// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Bonding} from "../src/Bonding.sol";
import {LaunchpadRouter} from "../src/LaunchpadRouter.sol";
import {IFPair} from "../src/interfaces/IFPair.sol";

contract E2ETest is Script {
    address constant HYPE2L = 0x0f8db745e9C28275F8B6e2BAF6BAA8eE7431b557;
    address constant BONDING = 0x1944710C55ac3Dcbf36ED9B80f289418B26c032a;
    address constant LAUNCHPAD_ROUTER = 0x3E86AFB20De663f8689C09698aEeF3DF5F28a1Fe;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        console.log("Deployer:", deployer);

        Bonding bonding = Bonding(BONDING);
        LaunchpadRouter router = LaunchpadRouter(LAUNCHPAD_ROUTER);

        vm.startBroadcast(pk);

        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "E2E Test Token",
            ticker: "E2E",
            description: "End-to-end test",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: HYPE2L
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
