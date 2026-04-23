// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Vm} from "forge-std/Test.sol";
import {Bonding} from "../src/Bonding.sol";
import {FERC20} from "../src/FERC20.sol";
import {LaunchpadRouter} from "../src/LaunchpadRouter.sol";
import {DeployHelper} from "./DeployHelper.sol";

/// @notice Coverage for the router allowlist + trader-attribution contract
/// invariants introduced to fix the "trades table shows router address, not
/// user" bug. Every path through which a `Bonding.Trade` event can be emitted
/// must record the real user, and only allowlisted routers may drive the
/// curve.
contract RouterAllowlistTest is DeployHelper {
    LaunchpadRouter public launchpadRouter;

    function setUp() public {
        _deployCore();

        LaunchpadRouter routerImpl = new LaunchpadRouter();
        bytes memory routerInit =
            abi.encodeCall(LaunchpadRouter.initialize, (address(bonding), address(usdc), address(hyperswapRouter)));
        launchpadRouter = LaunchpadRouter(address(new ERC1967Proxy(address(routerImpl), routerInit)));

        bonding.addRouter(address(launchpadRouter));
        usdc.mint(address(lt), 1_000_000 ether);
    }

    // ─── Allowlist management ────────────────────────────────────────────

    function test_addRouter_ownerCanAdd() public {
        address newRouter = makeAddr("newRouter");
        assertFalse(bonding.isRouter(newRouter));

        bonding.addRouter(newRouter);

        assertTrue(bonding.isRouter(newRouter));
    }

    function test_addRouter_emitsEvent() public {
        address newRouter = makeAddr("newRouter");

        vm.expectEmit(true, false, false, false);
        emit Bonding.RouterAdded(newRouter);
        bonding.addRouter(newRouter);
    }

    function test_addRouter_revertsForNonOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        bonding.addRouter(makeAddr("x"));
    }

    function test_addRouter_revertsOnZeroAddress() public {
        vm.expectRevert(Bonding.ZeroAddress.selector);
        bonding.addRouter(address(0));
    }

    function test_addRouter_revertsOnDuplicate() public {
        vm.expectRevert(Bonding.RouterAlreadyAdded.selector);
        bonding.addRouter(address(launchpadRouter));
    }

    function test_removeRouter_ownerCanRemove() public {
        bonding.removeRouter(address(launchpadRouter));
        assertFalse(bonding.isRouter(address(launchpadRouter)));
    }

    function test_removeRouter_emitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit Bonding.RouterRemoved(address(launchpadRouter));
        bonding.removeRouter(address(launchpadRouter));
    }

    function test_removeRouter_revertsForNonOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        bonding.removeRouter(address(launchpadRouter));
    }

    function test_removeRouter_revertsWhenNotAdded() public {
        vm.expectRevert(Bonding.RouterNotFound.selector);
        bonding.removeRouter(makeAddr("never-added"));
    }

    function test_getRouters_enumeratesAll() public {
        address r1 = makeAddr("r1");
        address r2 = makeAddr("r2");
        bonding.addRouter(r1);
        bonding.addRouter(r2);

        address[] memory routers = bonding.getRouters();
        assertEq(routers.length, 3);
        // Order is insertion-order minus swap-on-removal; just assert membership.
        assertTrue(bonding.isRouter(address(launchpadRouter)));
        assertTrue(bonding.isRouter(r1));
        assertTrue(bonding.isRouter(r2));
    }

    function test_removeRouter_shrinksEnumeration() public {
        bonding.removeRouter(address(launchpadRouter));
        assertEq(bonding.getRouters().length, 0);
    }

    // ─── Router-only gating ──────────────────────────────────────────────

    function test_bondingBuy_revertsForUnauthorizedCaller() public {
        address tokenAddr = _createBasicToken();
        lt.mintDirect(trader, 100 ether);

        vm.startPrank(trader);
        lt.approve(address(frouter), 100 ether);
        vm.expectRevert(Bonding.NotRouter.selector);
        bonding.buy(100 ether, tokenAddr, 0, trader);
        vm.stopPrank();
    }

    function test_bondingSell_revertsForUnauthorizedCaller() public {
        address tokenAddr = _createBasicToken();
        _buyViaRouter(tokenAddr, trader, 500 ether);

        uint256 balance = FERC20(tokenAddr).balanceOf(trader);
        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(frouter), balance);
        vm.expectRevert(Bonding.NotRouter.selector);
        bonding.sell(balance, tokenAddr, 0, trader);
        vm.stopPrank();
    }

    function test_bondingLaunch_revertsForUnauthorizedCaller() public {
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "X",
            ticker: "X",
            description: "",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: address(lt),
            purchaseAmount: 0
        });

        vm.prank(trader);
        vm.expectRevert(Bonding.NotRouter.selector);
        bonding.launch(params, trader);
    }

    function test_removedRouter_canNoLongerBuy() public {
        // Deploy a second router, use it, then remove it and check further calls revert.
        LaunchpadRouter secondary = _deploySecondaryRouter();
        bonding.addRouter(address(secondary));

        address tokenAddr = _createBasicToken();
        _buyVia(secondary, tokenAddr, trader, 100 ether);

        bonding.removeRouter(address(secondary));

        usdc.mint(trader, 100 ether);
        vm.startPrank(trader);
        usdc.approve(address(secondary), 100 ether);
        vm.expectRevert();
        secondary.buy(tokenAddr, 100 ether, 0, address(0));
        vm.stopPrank();
    }

    // ─── Trader attribution in Trade event ───────────────────────────────

    /// @notice The central invariant this refactor exists to enforce: a buy
    ///         routed through LaunchpadRouter must emit `Bonding.Trade` with
    ///         the user's EOA as `trader`, not the router's address.
    function test_traderAttribution_routerBuy_emitsUserAddress() public {
        address tokenAddr = _createBasicToken();
        usdc.mint(trader, 100 ether);

        vm.startPrank(trader);
        usdc.approve(address(launchpadRouter), 100 ether);

        // `Bonding.Trade(tokenAddr, trader, isBuy=true, ...)` — indexed topics
        // `token` and `trader` must match. Data fields are not asserted (the
        // exact LT/token/reserve values aren't the point of this test).
        vm.expectEmit(true, true, false, false, address(bonding));
        emit Bonding.Trade(tokenAddr, trader, true, 0, 0, 0, 0);
        launchpadRouter.buy(tokenAddr, 100 ether, 0, address(0));
        vm.stopPrank();
    }

    function test_traderAttribution_routerSell_emitsUserAddress() public {
        address tokenAddr = _createBasicToken();
        _buyViaRouter(tokenAddr, trader, 500 ether);

        uint256 balance = FERC20(tokenAddr).balanceOf(trader);
        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(launchpadRouter), balance);

        vm.expectEmit(true, true, false, false, address(bonding));
        emit Bonding.Trade(tokenAddr, trader, false, 0, 0, 0, 0);
        launchpadRouter.sell(tokenAddr, balance, 0);
        vm.stopPrank();
    }

    /// @notice Seed buys via `createToken` must attribute the `Trade` event to
    ///         the creator, not to the Bonding contract (the pre-fix behavior
    ///         that caused the UI to show the contract address on the very
    ///         first trade of every token).
    function test_traderAttribution_seedBuy_emitsCreatorAddress() public {
        usdc.mint(creator, 200 ether);

        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "SeedAttrib",
            ticker: "SEED",
            description: "",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: address(lt),
            purchaseAmount: 0
        });

        vm.startPrank(creator);
        usdc.approve(address(launchpadRouter), 200 ether);

        // The seed-buy's `Bonding.Trade` event, emitted mid-`createToken`,
        // must carry `creator` (not `address(bonding)` or the router).
        vm.recordLogs();
        launchpadRouter.createToken(params, 200 ether);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        vm.stopPrank();

        bytes32 tradeTopic = keccak256("Trade(address,address,bool,uint256,uint256,uint256,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(bonding) && logs[i].topics.length >= 3 && logs[i].topics[0] == tradeTopic) {
                address eventTrader = address(uint160(uint256(logs[i].topics[2])));
                assertEq(eventTrader, creator, "seed-buy Trade must attribute to creator");
                found = true;
                break;
            }
        }
        assertTrue(found, "expected a Bonding.Trade event from the seed buy");
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _createBasicToken() internal returns (address tokenAddr) {
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "Tok",
            ticker: "TOK",
            description: "",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: address(lt),
            purchaseAmount: 0
        });
        vm.prank(creator);
        tokenAddr = launchpadRouter.createToken(params, 0);
    }

    function _buyViaRouter(
        address tokenAddr,
        address buyer,
        uint256 usdcAmount
    ) internal returns (uint256 tokensOut) {
        return _buyVia(launchpadRouter, tokenAddr, buyer, usdcAmount);
    }

    function _buyVia(
        LaunchpadRouter r,
        address tokenAddr,
        address buyer,
        uint256 usdcAmount
    ) internal returns (uint256 tokensOut) {
        usdc.mint(buyer, usdcAmount);
        vm.startPrank(buyer);
        usdc.approve(address(r), usdcAmount);
        tokensOut = r.buy(tokenAddr, usdcAmount, 0, address(0));
        vm.stopPrank();
    }

    function _deploySecondaryRouter() internal returns (LaunchpadRouter secondary) {
        LaunchpadRouter impl = new LaunchpadRouter();
        bytes memory init =
            abi.encodeCall(LaunchpadRouter.initialize, (address(bonding), address(usdc), address(hyperswapRouter)));
        secondary = LaunchpadRouter(address(new ERC1967Proxy(address(impl), init)));
    }
}
