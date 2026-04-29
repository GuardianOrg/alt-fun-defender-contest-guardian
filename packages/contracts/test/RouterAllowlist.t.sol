// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Vm} from "forge-std/Test.sol";
import {Bonding} from "../src/Bonding.sol";
import {Token} from "../src/Token.sol";
import {Zap} from "../src/Zap.sol";
import {DeployHelper} from "./DeployHelper.sol";

/// @notice Coverage for the router allowlist + trader-attribution contract
/// invariants introduced to fix the "trades table shows router address, not
/// user" bug. Every path through which a `Bonding.Trade` event can be emitted
/// must record the real user, and only allowlisted routers may drive the
/// curve.
contract RouterAllowlistTest is DeployHelper {
    Zap public zap;

    function setUp() public {
        _deployCore();

        Zap zapImpl = new Zap();
        bytes memory zapInit = abi.encodeCall(
            Zap.initialize, (address(bonding), address(usdc), address(hyperswapRouter), address(feeVault), 50, 50, 2000)
        );
        zap = Zap(address(new ERC1967Proxy(address(zapImpl), zapInit)));

        bonding.addRouter(address(zap));
        feeVault.addDepositor(address(zap));
        usdc.mint(address(lt), 1_000_000 ether);

        // Align graduation threshold to virtual liquidity so:
        //   1) buys sized off `_smallBuyUsdc()` never accidentally graduate
        //      and reroute trader-attribution events through Hyperswap.
        //   2) USD-trigger graduation tests in this suite (none today, but
        //      future ones) remain reachable.
        // See DeployHelper for the rationale behind this fixed multiple.
        _alignThresholdToVirtualLiquidity();
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
        bonding.addRouter(address(zap));
    }

    function test_removeRouter_ownerCanRemove() public {
        bonding.removeRouter(address(zap));
        assertFalse(bonding.isRouter(address(zap)));
    }

    function test_removeRouter_emitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit Bonding.RouterRemoved(address(zap));
        bonding.removeRouter(address(zap));
    }

    function test_removeRouter_revertsForNonOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        bonding.removeRouter(address(zap));
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
        assertTrue(bonding.isRouter(address(zap)));
        assertTrue(bonding.isRouter(r1));
        assertTrue(bonding.isRouter(r2));
    }

    function test_removeRouter_shrinksEnumeration() public {
        bonding.removeRouter(address(zap));
        assertEq(bonding.getRouters().length, 0);
    }

    // ─── Router-only gating ──────────────────────────────────────────────

    function test_bondingBuy_revertsForUnauthorizedCaller() public {
        address tokenAddr = _createBasicToken();
        uint256 buyAmount = _smallBuyLt();
        lt.mintDirect(trader, buyAmount);

        vm.startPrank(trader);
        lt.approve(address(curveRouter), buyAmount);
        vm.expectRevert(Bonding.NotRouter.selector);
        bonding.buy(buyAmount, tokenAddr, 0, trader);
        vm.stopPrank();
    }

    function test_bondingSell_revertsForUnauthorizedCaller() public {
        address tokenAddr = _createBasicToken();
        _buyViaRouter(tokenAddr, trader, _smallBuyUsdc());

        uint256 balance = Token(tokenAddr).balanceOf(trader);
        vm.startPrank(trader);
        Token(tokenAddr).approve(address(curveRouter), balance);
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
            urls: ["", "", ""],
            ltAddress: address(lt),
            // `onlyRouter` reverts before the vanity check ever runs, so no
            // need to mine a real suffix here.
            salt: bytes32(0)
        });

        vm.prank(trader);
        vm.expectRevert(Bonding.NotRouter.selector);
        bonding.launch(params, trader);
    }

    function test_removedRouter_canNoLongerBuy() public {
        // Deploy a second router, use it, then remove it and check further calls revert.
        Zap secondary = _deploySecondaryRouter();
        bonding.addRouter(address(secondary));

        address tokenAddr = _createBasicToken();
        uint256 buyAmount = _smallBuyUsdc();
        _buyVia(secondary, tokenAddr, trader, buyAmount);

        bonding.removeRouter(address(secondary));

        usdc.mint(trader, buyAmount);
        vm.startPrank(trader);
        usdc.approve(address(secondary), buyAmount);
        vm.expectRevert();
        secondary.buy(tokenAddr, buyAmount, 0, address(0));
        vm.stopPrank();
    }

    // ─── Trader attribution in Trade event ───────────────────────────────

    /// @notice The central invariant this refactor exists to enforce: a buy
    ///         routed through Zap must emit `Bonding.Trade` with
    ///         the user's EOA as `trader`, not the router's address.
    function test_traderAttribution_routerBuy_emitsUserAddress() public {
        address tokenAddr = _createBasicToken();
        uint256 buyAmount = _smallBuyUsdc();
        usdc.mint(trader, buyAmount);

        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);

        // `Bonding.Trade(tokenAddr, trader, isBuy=true, ...)` — indexed topics
        // `token` and `trader` must match. Data fields are not asserted (the
        // exact LT/token/reserve values aren't the point of this test).
        vm.expectEmit(true, true, false, false, address(bonding));
        emit Bonding.Trade(tokenAddr, trader, true, 0, 0, 0, 0);
        zap.buy(tokenAddr, buyAmount, 0, address(0));
        vm.stopPrank();
    }

    function test_traderAttribution_routerSell_emitsUserAddress() public {
        address tokenAddr = _createBasicToken();
        // Sized below the graduation point so the sell stays on the curve
        // (post-grad sells route through Hyperswap and do NOT emit the
        // `Bonding.Trade` topic this test asserts on).
        _buyViaRouter(tokenAddr, trader, _smallBuyUsdc());

        uint256 balance = Token(tokenAddr).balanceOf(trader);
        vm.startPrank(trader);
        Token(tokenAddr).approve(address(zap), balance);

        vm.expectEmit(true, true, false, false, address(bonding));
        emit Bonding.Trade(tokenAddr, trader, false, 0, 0, 0, 0);
        zap.sell(tokenAddr, balance, 0);
        vm.stopPrank();
    }

    /// @notice Seed buys via `createToken` must attribute the `Trade` event to
    ///         the creator, not to the Bonding contract (the pre-fix behavior
    ///         that caused the UI to show the contract address on the very
    ///         first trade of every token).
    function test_traderAttribution_seedBuy_emitsCreatorAddress() public {
        uint256 seedAmount = _defaultSeedUsdc();
        usdc.mint(creator, seedAmount);

        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "SeedAttrib",
            ticker: "SEED",
            description: "",
            image: "",
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator)
        });

        vm.startPrank(creator);
        usdc.approve(address(zap), seedAmount);

        // The seed-buy's `Bonding.Trade` event, emitted mid-`createToken`,
        // must carry `creator` (not `address(bonding)` or the router).
        vm.recordLogs();
        zap.createToken(params, seedAmount);
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
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator)
        });
        vm.prank(creator);
        tokenAddr = zap.createToken(params, 0);
    }

    function _buyViaRouter(
        address tokenAddr,
        address buyer,
        uint256 usdcAmount
    ) internal returns (uint256 tokensOut) {
        return _buyVia(zap, tokenAddr, buyer, usdcAmount);
    }

    function _buyVia(
        Zap r,
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

    function _deploySecondaryRouter() internal returns (Zap secondary) {
        Zap impl = new Zap();
        bytes memory init = abi.encodeCall(
            Zap.initialize, (address(bonding), address(usdc), address(hyperswapRouter), address(feeVault), 50, 50, 2000)
        );
        secondary = Zap(address(new ERC1967Proxy(address(impl), init)));
        feeVault.addDepositor(address(secondary));
    }
}
