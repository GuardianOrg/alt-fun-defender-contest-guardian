// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Factory} from "../src/Factory.sol";
import {Pair} from "../src/Pair.sol";
import {Router} from "../src/Router.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract FactoryTest is Test {
    Factory public factory;
    Router public router;

    address public owner = address(this);
    address public bondingRole = makeAddr("bonding");
    address public stranger = makeAddr("stranger");

    MockERC20 public tokenA;
    MockERC20 public tokenB;

    function setUp() public {
        factory = new Factory();
        factory.initialize();

        router = new Router();
        router.initialize(address(factory));

        factory.setRouter(address(router));
        factory.grantRole(factory.BONDING_ROLE(), bondingRole);

        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
    }

    // ─── Initialize Tests ─────────────────────────────────────────────────

    function test_initialize_grantsAdminRole() public view {
        assertTrue(factory.hasRole(factory.DEFAULT_ADMIN_ROLE(), owner));
    }

    // ─── createPair Tests ─────────────────────────────────────────────────

    function test_createPair_storesPairAndLt() public {
        vm.prank(bondingRole);
        address pair = factory.createPair(address(tokenA), address(tokenB));

        assertTrue(pair != address(0), "Pair should be created");
        assertEq(factory.getPair(address(tokenA), address(tokenB)), pair);
        assertEq(factory.getPair(address(tokenB), address(tokenA)), pair, "Reverse lookup should also work");
        assertEq(factory.pairFor(address(tokenA)), pair);
        assertEq(factory.ltFor(address(tokenA)), address(tokenB));
    }

    function test_createPair_incrementsPairCount() public {
        assertEq(factory.pairCount(), 0);

        vm.prank(bondingRole);
        factory.createPair(address(tokenA), address(tokenB));

        assertEq(factory.pairCount(), 1);
    }

    function test_createPair_emitsPairCreated() public {
        vm.prank(bondingRole);
        vm.expectEmit(true, true, false, false);
        emit Factory.PairCreated(address(tokenA), address(tokenB), address(0), 1);
        factory.createPair(address(tokenA), address(tokenB));
    }

    function test_createPair_pairHasCorrectImmutables() public {
        vm.prank(bondingRole);
        address pairAddr = factory.createPair(address(tokenA), address(tokenB));
        Pair pair = Pair(pairAddr);

        assertEq(pair.router(), address(router));
        assertEq(pair.launchedToken(), address(tokenA));
        assertEq(pair.assetToken(), address(tokenB));
    }

    function test_createPair_revertsForZeroTokenA() public {
        vm.prank(bondingRole);
        vm.expectRevert(Factory.ZeroAddress.selector);
        factory.createPair(address(0), address(tokenB));
    }

    function test_createPair_revertsForZeroTokenB() public {
        vm.prank(bondingRole);
        vm.expectRevert(Factory.ZeroAddress.selector);
        factory.createPair(address(tokenA), address(0));
    }

    function test_createPair_revertsWithoutRouter() public {
        Factory factory2 = new Factory();
        factory2.initialize();
        factory2.grantRole(factory2.BONDING_ROLE(), bondingRole);
        // No setRouter call

        vm.prank(bondingRole);
        vm.expectRevert(Factory.NoRouter.selector);
        factory2.createPair(address(tokenA), address(tokenB));
    }

    function test_createPair_revertsWithoutBondingRole() public {
        vm.prank(stranger);
        vm.expectRevert();
        factory.createPair(address(tokenA), address(tokenB));
    }

    function test_createPair_revertsOnDuplicate() public {
        vm.startPrank(bondingRole);
        factory.createPair(address(tokenA), address(tokenB));

        vm.expectRevert(Factory.PairExists.selector);
        factory.createPair(address(tokenA), address(tokenB));
        vm.stopPrank();
    }

    function test_createPair_revertsOnDuplicateReversedOrder() public {
        vm.startPrank(bondingRole);
        factory.createPair(address(tokenA), address(tokenB));

        vm.expectRevert(Factory.PairExists.selector);
        factory.createPair(address(tokenB), address(tokenA));
        vm.stopPrank();
    }

    function test_createPair_multiplePairsTracked() public {
        MockERC20 tokenC = new MockERC20("Token C", "TKC");

        vm.startPrank(bondingRole);
        address pair1 = factory.createPair(address(tokenA), address(tokenB));
        address pair2 = factory.createPair(address(tokenC), address(tokenB));
        vm.stopPrank();

        assertEq(factory.pairCount(), 2);
        assertTrue(pair1 != pair2, "Pairs should be different");
    }

    // ─── pairFor / ltFor Tests ────────────────────────────────────────────

    function test_pairFor_returnsZeroForUnknownToken() public view {
        assertEq(factory.pairFor(address(tokenA)), address(0));
    }

    function test_ltFor_returnsZeroForUnknownToken() public view {
        assertEq(factory.ltFor(address(tokenA)), address(0));
    }

    function test_getPair_returnsZeroForUnknownPair() public view {
        assertEq(factory.getPair(address(tokenA), address(tokenB)), address(0));
    }

    function test_getPair_symmetricLookup() public {
        vm.prank(bondingRole);
        address pair = factory.createPair(address(tokenA), address(tokenB));

        assertEq(factory.getPair(address(tokenA), address(tokenB)), pair);
        assertEq(factory.getPair(address(tokenB), address(tokenA)), pair);
    }

    // ─── setRouter Tests ──────────────────────────────────────────────────

    function test_setRouter_updatesRouter() public {
        Router newRouter = new Router();
        newRouter.initialize(address(factory));
        factory.setRouter(address(newRouter));
        assertEq(factory.router(), address(newRouter));
    }

    function test_setRouter_revertsOnFactoryMismatch() public {
        Factory otherFactory = new Factory();
        otherFactory.initialize();
        Router mismatched = new Router();
        mismatched.initialize(address(otherFactory));

        vm.expectRevert(Factory.RouterFactoryMismatch.selector);
        factory.setRouter(address(mismatched));
    }

    function test_setRouter_revertsWithoutAdmin() public {
        vm.prank(stranger);
        vm.expectRevert();
        factory.setRouter(makeAddr("newRouter"));
    }

    function test_setRouter_revertsAfterPairCreated() public {
        vm.prank(bondingRole);
        factory.createPair(address(tokenA), address(tokenB));

        vm.expectRevert(Factory.RouterFrozen.selector);
        factory.setRouter(makeAddr("newRouter"));
    }
}
