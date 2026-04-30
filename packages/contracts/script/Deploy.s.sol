// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Bonding} from "../src/Bonding.sol";
import {Token} from "../src/Token.sol";
import {Factory} from "../src/Factory.sol";
import {Router} from "../src/Router.sol";
import {Zap} from "../src/Zap.sol";
import {LPLock} from "../src/LPLock.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {IUniswapV2Router02} from "../src/interfaces/IUniswapV2Router02.sol";

contract Deploy is Script {
    // HyperEVM mainnet addresses
    address constant USDC = 0xb88339CB7199b77E23DB6E890353E22632Ba630f;
    address constant HYPERSWAP_ROUTER = 0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A;
    /// @dev BounceTech `Factory` (HyperEVM mainnet). Source of truth for
    ///      "is this address a real BounceTech LT?" via `ltExists(address)`.
    ///      Mirrors `FACTORY_ADDRESS` in `bounce-tech/bounce-npm`. If
    ///      BounceTech ever redeploys their factory, also call
    ///      `Bonding.setBounceFactory` post-rotation — `Bonding` reads
    ///      from this slot at every launch.
    address constant BOUNCE_FACTORY = 0xeD8bCDe433EB7c4B69DB1235483bf0Edb726Fc1B;

    // Fee config at deploy time: 0.5% buy/sell, 20% of that to the creator.
    uint256 constant BUY_FEE_BPS = 50;
    uint256 constant SELL_FEE_BPS = 50;
    uint256 constant CREATOR_FEE_BPS = 2000;

    /// @dev USD-denominated (18-dp) graduation trigger seeded into the
    ///      Bonding proxy at `initialize`. Immutable for the life of the
    ///      proxy — changing it requires a UUPS upgrade with a
    ///      `reinitializer`.
    uint256 constant GRADUATION_THRESHOLD_USD = 12_000 ether;

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
        Factory factory = new Factory();
        factory.initialize();
        console.log("Factory:", address(factory));

        Router router = new Router();
        router.initialize(address(factory));
        console.log("Router:", address(router));

        LPLock lpLockImpl = new LPLock();
        bytes memory lpLockInit = abi.encodeCall(LPLock.initialize, (deployer));
        address lpLockProxy = address(new ERC1967Proxy(address(lpLockImpl), lpLockInit));
        console.log("LPLock (proxy):", lpLockProxy);

        // Deploy Token implementation. This is the singleton that every
        // launched token clones via EIP-1167. The constructor calls
        // `_disableInitializers()` so this address itself can never be
        // initialised — it exists only to host the runtime bytecode.
        Token tokenImpl = new Token();
        console.log("Token (impl):", address(tokenImpl));

        address hyperswapFactory = IUniswapV2Router02(HYPERSWAP_ROUTER).factory();
        address bondingProxy =
            _deployBonding(address(factory), address(router), hyperswapFactory, lpLockProxy, address(tokenImpl));
        console.log("Bonding (proxy):", bondingProxy);

        // Deploy FeeVault (proxy). `feeTo = deployer` initially — rotate via
        // `setFeeTo` once the multisig is set up.
        FeeVault feeVaultImpl = new FeeVault();
        bytes memory feeVaultInit = abi.encodeCall(FeeVault.initialize, (USDC, deployer));
        address feeVaultProxy = address(new ERC1967Proxy(address(feeVaultImpl), feeVaultInit));
        console.log("FeeVault (proxy):", feeVaultProxy);

        Zap zapImpl = new Zap();
        bytes memory zapInit = abi.encodeCall(
            Zap.initialize,
            (bondingProxy, USDC, HYPERSWAP_ROUTER, feeVaultProxy, BUY_FEE_BPS, SELL_FEE_BPS, CREATOR_FEE_BPS)
        );
        address zapProxy = address(new ERC1967Proxy(address(zapImpl), zapInit));
        console.log("Zap (proxy):", zapProxy);

        factory.setRouter(address(router));
        factory.grantRole(factory.BONDING_ROLE(), bondingProxy);
        router.grantRole(router.BONDING_ROLE(), bondingProxy);
        LPLock(lpLockProxy).setLocker(bondingProxy, true);
        Bonding(bondingProxy).addRouter(zapProxy);
        FeeVault(feeVaultProxy).addDepositor(zapProxy);

        console.log("--- Deployment complete ---");
        console.log("USDC:", USDC);
        console.log("HyperSwap Router:", HYPERSWAP_ROUTER);
    }

    function _deployBonding(
        address factory_,
        address router_,
        address hyperswapFactory_,
        address lpLock_,
        address tokenImplementation_
    ) internal returns (address) {
        Bonding impl = new Bonding();
        bytes memory initData = abi.encodeCall(
            Bonding.initialize,
            (
                factory_,
                router_,
                hyperswapFactory_,
                lpLock_,
                tokenImplementation_,
                GRADUATION_THRESHOLD_USD,
                BOUNCE_FACTORY
            )
        );
        return address(new ERC1967Proxy(address(impl), initData));
    }
}
