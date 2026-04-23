// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Bonding} from "../src/Bonding.sol";
import {FFactory} from "../src/FFactory.sol";
import {FRouter} from "../src/FRouter.sol";
import {LaunchpadRouter} from "../src/LaunchpadRouter.sol";
import {LPLock} from "../src/LPLock.sol";
import {FeeVault} from "../src/FeeVault.sol";

contract Deploy is Script {
    // HyperEVM mainnet addresses
    address constant USDC = 0xb88339CB7199b77E23DB6E890353E22632Ba630f;
    address constant HYPERSWAP_ROUTER = 0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A;

    // Fee config at deploy time: 0.5% buy/sell, 20% of that to the creator.
    uint256 constant BUY_FEE_BPS = 50;
    uint256 constant SELL_FEE_BPS = 50;
    uint256 constant CREATOR_FEE_BPS = 2000;
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
        factory.initialize();
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
        address bondingProxy = _deployBonding(address(factory), address(router), MAX_TX, HYPERSWAP_ROUTER, lpLockProxy);
        console.log("Bonding (proxy):", bondingProxy);

        // 5. Deploy FeeVault (proxy). `feeTo = deployer` initially — rotate via
        //    `setFeeTo` once the multisig is set up.
        FeeVault feeVaultImpl = new FeeVault();
        bytes memory feeVaultInit = abi.encodeCall(FeeVault.initialize, (USDC, deployer));
        address feeVaultProxy = address(new ERC1967Proxy(address(feeVaultImpl), feeVaultInit));
        console.log("FeeVault (proxy):", feeVaultProxy);

        // 6. Deploy LaunchpadRouter (proxy)
        LaunchpadRouter rrImpl = new LaunchpadRouter();
        bytes memory rrInit = abi.encodeCall(
            LaunchpadRouter.initialize,
            (bondingProxy, USDC, HYPERSWAP_ROUTER, feeVaultProxy, BUY_FEE_BPS, SELL_FEE_BPS, CREATOR_FEE_BPS)
        );
        address rrProxy = address(new ERC1967Proxy(address(rrImpl), rrInit));
        console.log("LaunchpadRouter (proxy):", rrProxy);

        // 7. Wire roles and permissions
        factory.setRouter(address(router));
        factory.grantRole(factory.BONDING_ROLE(), bondingProxy);
        router.grantRole(router.BONDING_ROLE(), bondingProxy);
        LPLock(lpLockProxy).setLocker(bondingProxy, true);
        Bonding(bondingProxy).addRouter(rrProxy);
        FeeVault(feeVaultProxy).addDepositor(rrProxy);

        console.log("--- Deployment complete ---");
        console.log("USDC:", USDC);
        console.log("HyperSwap Router:", HYPERSWAP_ROUTER);
    }

    function _deployBonding(
        address factory_,
        address router_,
        uint256 maxTx_,
        address hyperswapRouter_,
        address lpLock_
    ) internal returns (address) {
        Bonding impl = new Bonding();
        bytes memory initData =
            abi.encodeCall(Bonding.initialize, (factory_, router_, maxTx_, hyperswapRouter_, lpLock_));
        return address(new ERC1967Proxy(address(impl), initData));
    }
}
