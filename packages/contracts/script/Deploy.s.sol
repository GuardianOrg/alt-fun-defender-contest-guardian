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
    // HyperEVM mainnet addresses
    address constant USDC = 0xb88339CB7199b77E23DB6E890353E22632Ba630f;
    address constant HYPERSWAP_ROUTER = 0xda0f518d521e0dE83fAdC8500C2D21b6a6C39bF9;

    // 0.5% = 50 basis points for both buy and sell tax
    uint256 constant BUY_TAX_BPS = 50;
    uint256 constant SELL_TAX_BPS = 50;
    uint256 constant MAX_TX = 100; // 100% = no per-tx limit

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);
        _deploy(deployer);
        vm.stopBroadcast();
    }

    function _deploy(
        address deployer
    ) internal {
        // 1. Deploy FFactory
        FFactory factory = new FFactory();
        factory.initialize(deployer, BUY_TAX_BPS, SELL_TAX_BPS);
        console.log("FFactory:", address(factory));

        // 2. Deploy FRouter
        FRouter router = new FRouter();
        router.initialize(address(factory));
        console.log("FRouter:", address(router));

        // 3. Deploy LPLock (proxy)
        LPLock lpLockImpl = new LPLock();
        bytes memory lpLockInit = abi.encodeCall(LPLock.initialize, (deployer));
        address lpLockProxy = address(new ERC1967Proxy(address(lpLockImpl), lpLockInit));
        console.log("LPLock (proxy):", lpLockProxy);

        // 4. Deploy Bonding (proxy)
        address bondingProxy =
            _deployBonding(address(factory), address(router), deployer, MAX_TX, HYPERSWAP_ROUTER, lpLockProxy);
        console.log("Bonding (proxy):", bondingProxy);

        // 5. Deploy RedemptionRouter (proxy)
        RedemptionRouter rrImpl = new RedemptionRouter();
        bytes memory rrInit = abi.encodeCall(RedemptionRouter.initialize, (bondingProxy, USDC, HYPERSWAP_ROUTER));
        address rrProxy = address(new ERC1967Proxy(address(rrImpl), rrInit));
        console.log("RedemptionRouter (proxy):", rrProxy);

        // 6. Wire roles and permissions
        factory.setRouter(address(router));
        factory.grantRole(factory.BONDING_ROLE(), bondingProxy);
        router.grantRole(router.BONDING_ROLE(), bondingProxy);
        LPLock(lpLockProxy).setLocker(bondingProxy, true);

        // Set feeTo = Bonding so trade fees accumulate there
        factory.setFeeParams(bondingProxy, BUY_TAX_BPS, SELL_TAX_BPS);

        console.log("--- Deployment complete ---");
        console.log("USDC:", USDC);
        console.log("HyperSwap Router:", HYPERSWAP_ROUTER);
    }

    function _deployBonding(
        address factory_,
        address router_,
        address feeTo_,
        uint256 maxTx_,
        address hyperswapRouter_,
        address lpLock_
    ) internal returns (address) {
        Bonding impl = new Bonding();
        bytes memory initData =
            abi.encodeCall(Bonding.initialize, (factory_, router_, feeTo_, maxTx_, hyperswapRouter_, lpLock_));
        return address(new ERC1967Proxy(address(impl), initData));
    }
}
