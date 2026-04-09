// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Bonding} from "../src/Bonding.sol";
import {FFactory} from "../src/FFactory.sol";
import {FRouter} from "../src/FRouter.sol";
import {RedemptionRouter} from "../src/RedemptionRouter.sol";
import {LPLock} from "../src/LPLock.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address assetToken = vm.envAddress("ASSET_TOKEN");

        vm.startBroadcast(deployerPrivateKey);

        _deploy(deployer, assetToken);

        vm.stopBroadcast();
    }

    function _deploy(address deployer, address assetToken) internal {
        address feeReceiver = deployer;

        FFactory factory = new FFactory();
        factory.initialize(feeReceiver, 1, 1);

        FRouter router = new FRouter();
        router.initialize(address(factory), assetToken);

        address bondingProxy = _deployBonding(address(factory), address(router), feeReceiver);

        factory.setRouter(address(router));
        factory.grantRole(factory.BONDING_ROLE(), bondingProxy);
        router.grantRole(router.BONDING_ROLE(), bondingProxy);

        _deployStubs(deployer);

        console.log("FFactory:", address(factory));
        console.log("FRouter:", address(router));
        console.log("Bonding (proxy):", bondingProxy);
    }

    function _deployBonding(address factory_, address router_, address feeReceiver) internal returns (address) {
        Bonding impl = new Bonding();
        bytes memory initData = abi.encodeCall(
            Bonding.initialize, (factory_, router_, feeReceiver, 100 ether, 10_000, 100, 85_000_000 ether)
        );
        return address(new ERC1967Proxy(address(impl), initData));
    }

    function _deployStubs(
        address deployer
    ) internal {
        RedemptionRouter rImpl = new RedemptionRouter();
        bytes memory rInit = abi.encodeCall(RedemptionRouter.initialize, (deployer));
        address rProxy = address(new ERC1967Proxy(address(rImpl), rInit));

        LPLock lImpl = new LPLock();
        bytes memory lInit = abi.encodeCall(LPLock.initialize, (deployer));
        address lProxy = address(new ERC1967Proxy(address(lImpl), lInit));

        console.log("RedemptionRouter (proxy):", rProxy);
        console.log("LPLock (proxy):", lProxy);
    }
}
