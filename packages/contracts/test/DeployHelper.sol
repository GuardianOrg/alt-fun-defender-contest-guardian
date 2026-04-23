// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Bonding} from "../src/Bonding.sol";
import {FFactory} from "../src/FFactory.sol";
import {FRouter} from "../src/FRouter.sol";
import {LPLock} from "../src/LPLock.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockLeveragedToken} from "./mocks/MockLeveragedToken.sol";
import {MockHyperswapRouter} from "./mocks/MockHyperswapRouter.sol";

/// @notice Shared deployment wiring for Bonding-based test suites.
/// Deploys mocks, factory, router, LPLock proxy, and Bonding proxy with roles configured.
/// Subclasses should call `_deployCore()` in their `setUp()` and then perform any additional setup.
abstract contract DeployHelper is Test {
    MockERC20 public usdc;
    MockLeveragedToken public lt;
    MockHyperswapRouter public hyperswapRouter;
    FFactory public factory;
    FRouter public frouter;
    Bonding public bonding;
    LPLock public lpLockContract;

    address public owner = address(this);
    address public feeReceiver = makeAddr("feeReceiver");
    address public creator = makeAddr("creator");
    address public trader = makeAddr("trader");
    address public trader2 = makeAddr("trader2");

    uint256 constant BUY_TAX_BPS = 50; // 0.5%
    uint256 constant SELL_TAX_BPS = 50; // 0.5%
    uint256 constant MAX_TX = 100; // 100% = no limit
    uint256 constant LT_EXCHANGE_RATE = 1 ether; // 1 LT = $1 USD

    /// @notice Deploys all core contracts and wires roles. Does NOT allowlist any
    /// router on Bonding — callers must do that themselves (e.g. `bonding.addRouter(...)`).
    /// Suites that call `bonding.buy/sell/launch` directly should allowlist the
    /// pranked address as a router.
    function _deployCore() internal {
        usdc = new MockERC20("USD Coin", "USDC");
        lt = new MockLeveragedToken("HYPE 2x Long", "HYPE2L", LT_EXCHANGE_RATE, 2, true, "HYPE", address(usdc));
        hyperswapRouter = new MockHyperswapRouter();

        factory = new FFactory();
        factory.initialize(feeReceiver, BUY_TAX_BPS, SELL_TAX_BPS);

        frouter = new FRouter();
        frouter.initialize(address(factory));

        LPLock lpLockImpl = new LPLock();
        bytes memory lpLockInit = abi.encodeCall(LPLock.initialize, (owner));
        lpLockContract = LPLock(address(new ERC1967Proxy(address(lpLockImpl), lpLockInit)));

        Bonding bondingImpl = new Bonding();
        bytes memory bondingInit = abi.encodeCall(
            Bonding.initialize,
            (address(factory), address(frouter), feeReceiver, MAX_TX, address(hyperswapRouter), address(lpLockContract))
        );
        bonding = Bonding(address(new ERC1967Proxy(address(bondingImpl), bondingInit)));

        factory.setRouter(address(frouter));
        factory.grantRole(factory.BONDING_ROLE(), address(bonding));
        frouter.grantRole(frouter.BONDING_ROLE(), address(bonding));
        lpLockContract.setLocker(address(bonding), true);
        factory.setFeeParams(address(bonding), BUY_TAX_BPS, SELL_TAX_BPS);
    }
}
