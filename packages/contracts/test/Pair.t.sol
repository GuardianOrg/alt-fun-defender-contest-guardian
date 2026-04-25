// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Pair} from "../src/Pair.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract PairTest is Test {
    Pair public pair;
    MockERC20 public token;
    MockERC20 public asset;

    address public routerAddr = makeAddr("router");
    address public stranger = makeAddr("stranger");
    address public recipient = makeAddr("recipient");

    uint256 constant INITIAL_TOKEN_RESERVE = 750_000_000 ether;
    uint256 constant INITIAL_ASSET_RESERVE = 4000 ether;

    function setUp() public {
        token = new MockERC20("Token", "TKN");
        asset = new MockERC20("Asset", "LT");

        pair = new Pair(routerAddr, address(token), address(asset));

        // Fund pair with tokens for testing
        token.mint(address(pair), INITIAL_TOKEN_RESERVE);
        asset.mint(address(pair), INITIAL_ASSET_RESERVE);
    }

    // ─── Constructor / Immutables Tests ───────────────────────────────────

    function test_constructor_setsImmutables() public view {
        assertEq(pair.router(), routerAddr);
        assertEq(pair.tokenA(), address(token));
        assertEq(pair.tokenB(), address(asset));
    }

    // ─── Mint Tests ──────────────────────────────────────────────────────

    function test_mint_initializesPool() public {
        vm.prank(routerAddr);
        bool success = pair.mint(INITIAL_TOKEN_RESERVE, INITIAL_ASSET_RESERVE);
        assertTrue(success);

        (uint256 reserve0, uint256 reserve1) = pair.getReserves();
        assertEq(reserve0, INITIAL_TOKEN_RESERVE);
        assertEq(reserve1, INITIAL_ASSET_RESERVE);
        assertEq(pair.kLast(), INITIAL_TOKEN_RESERVE * INITIAL_ASSET_RESERVE);
    }

    function test_mint_emitsEvent() public {
        vm.prank(routerAddr);
        vm.expectEmit(false, false, false, true);
        emit Pair.Mint(INITIAL_TOKEN_RESERVE, INITIAL_ASSET_RESERVE);
        pair.mint(INITIAL_TOKEN_RESERVE, INITIAL_ASSET_RESERVE);
    }

    function test_mint_revertsOnSecondCall() public {
        vm.startPrank(routerAddr);
        pair.mint(INITIAL_TOKEN_RESERVE, INITIAL_ASSET_RESERVE);

        vm.expectRevert(Pair.AlreadyMinted.selector);
        pair.mint(INITIAL_TOKEN_RESERVE, INITIAL_ASSET_RESERVE);
        vm.stopPrank();
    }

    function test_mint_revertsForNonRouter() public {
        vm.prank(stranger);
        vm.expectRevert(Pair.OnlyRouter.selector);
        pair.mint(INITIAL_TOKEN_RESERVE, INITIAL_ASSET_RESERVE);
    }

    // ─── Swap Tests ──────────────────────────────────────────────────────

    function test_swap_updatesReserves() public {
        vm.startPrank(routerAddr);
        pair.mint(INITIAL_TOKEN_RESERVE, INITIAL_ASSET_RESERVE);

        // Simulate buy: asset in, tokens out
        uint256 assetIn = 100 ether;
        uint256 tokensOut = 50_000 ether;
        pair.swap(0, tokensOut, assetIn, 0);

        (uint256 r0, uint256 r1) = pair.getReserves();
        assertEq(r0, INITIAL_TOKEN_RESERVE - tokensOut);
        assertEq(r1, INITIAL_ASSET_RESERVE + assetIn);
        vm.stopPrank();
    }

    function test_swap_emitsEvent() public {
        vm.startPrank(routerAddr);
        pair.mint(INITIAL_TOKEN_RESERVE, INITIAL_ASSET_RESERVE);

        vm.expectEmit(false, false, false, true);
        emit Pair.Swap(0, 50_000 ether, 100 ether, 0);
        pair.swap(0, 50_000 ether, 100 ether, 0);
        vm.stopPrank();
    }

    function test_swap_revertsForNonRouter() public {
        vm.prank(routerAddr);
        pair.mint(INITIAL_TOKEN_RESERVE, INITIAL_ASSET_RESERVE);

        vm.prank(stranger);
        vm.expectRevert(Pair.OnlyRouter.selector);
        pair.swap(0, 100 ether, 50 ether, 0);
    }

    function test_swap_sellUpdatesReserves() public {
        vm.startPrank(routerAddr);
        pair.mint(INITIAL_TOKEN_RESERVE, INITIAL_ASSET_RESERVE);

        // Simulate sell: tokens in, asset out
        uint256 tokensIn = 50_000 ether;
        uint256 assetOut = 100 ether;
        pair.swap(tokensIn, 0, 0, assetOut);

        (uint256 r0, uint256 r1) = pair.getReserves();
        assertEq(r0, INITIAL_TOKEN_RESERVE + tokensIn);
        assertEq(r1, INITIAL_ASSET_RESERVE - assetOut);
        vm.stopPrank();
    }

    // ─── Transfer Tests ──────────────────────────────────────────────────

    function test_transferToken_sendsTokenA() public {
        vm.prank(routerAddr);
        uint256 amount = 1000 ether;
        pair.transferToken(recipient, amount);

        assertEq(token.balanceOf(recipient), amount);
    }

    function test_transferToken_revertsForNonRouter() public {
        vm.prank(stranger);
        vm.expectRevert(Pair.OnlyRouter.selector);
        pair.transferToken(recipient, 1000 ether);
    }

    function test_transferAsset_sendsTokenB() public {
        vm.prank(routerAddr);
        uint256 amount = 100 ether;
        pair.transferAsset(recipient, amount);

        assertEq(asset.balanceOf(recipient), amount);
    }

    function test_transferAsset_revertsForNonRouter() public {
        vm.prank(stranger);
        vm.expectRevert(Pair.OnlyRouter.selector);
        pair.transferAsset(recipient, 100 ether);
    }

    // ─── View Functions Tests ────────────────────────────────────────────

    function test_getReserves_returnsZeroBeforeMint() public view {
        (uint256 r0, uint256 r1) = pair.getReserves();
        assertEq(r0, 0);
        assertEq(r1, 0);
    }

    function test_kLast_returnsZeroBeforeMint() public view {
        assertEq(pair.kLast(), 0);
    }

    function test_tokenBalance_reportsRealBalance() public view {
        assertEq(pair.tokenBalance(), INITIAL_TOKEN_RESERVE);
    }

    function test_assetBalance_reportsRealBalance() public view {
        assertEq(pair.assetBalance(), INITIAL_ASSET_RESERVE);
    }

    function test_balances_divergeFromReserves() public {
        // Mint with reserves matching real balances
        vm.prank(routerAddr);
        pair.mint(INITIAL_TOKEN_RESERVE, INITIAL_ASSET_RESERVE);

        // Transfer out some asset without updating reserves (simulating graduation drain)
        vm.prank(routerAddr);
        pair.transferAsset(recipient, 500 ether);

        // Real balance should be less than reserve
        (uint256 r0, uint256 r1) = pair.getReserves();
        assertEq(r0, INITIAL_TOKEN_RESERVE);
        assertEq(r1, INITIAL_ASSET_RESERVE);
        assertEq(pair.assetBalance(), INITIAL_ASSET_RESERVE - 500 ether);
    }

    // ─── K Invariant Tests ───────────────────────────────────────────────

    function test_kLast_unchangedAfterSwap() public {
        vm.startPrank(routerAddr);
        pair.mint(INITIAL_TOKEN_RESERVE, INITIAL_ASSET_RESERVE);

        uint256 kBefore = pair.kLast();
        pair.swap(0, 50_000 ether, 100 ether, 0);
        uint256 kAfter = pair.kLast();

        assertEq(kBefore, kAfter, "k should not change on swap");
        vm.stopPrank();
    }
}
