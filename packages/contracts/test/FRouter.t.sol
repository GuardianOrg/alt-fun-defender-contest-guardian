// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FFactory} from "../src/FFactory.sol";
import {FRouter} from "../src/FRouter.sol";
import {FPair} from "../src/FPair.sol";
import {IFPair} from "../src/interfaces/IFPair.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract FRouterTest is Test {
    FFactory public factory;
    FRouter public router;

    MockERC20 public token;
    MockERC20 public asset;

    address public owner = address(this);
    address public feeReceiver = makeAddr("feeReceiver");
    address public bondingRole = makeAddr("bonding");
    address public trader = makeAddr("trader");
    address public stranger = makeAddr("stranger");

    uint256 constant BUY_TAX_BPS = 50; // 0.5%
    uint256 constant SELL_TAX_BPS = 50; // 0.5%

    uint256 constant TOKEN_SUPPLY = 750_000_000 ether;
    uint256 constant ASSET_RESERVE = 4000 ether;

    address pairAddr;

    function setUp() public {
        token = new MockERC20("Token", "TKN");
        asset = new MockERC20("Asset", "LT");

        factory = new FFactory();
        factory.initialize(feeReceiver, BUY_TAX_BPS, SELL_TAX_BPS);

        router = new FRouter();
        router.initialize(address(factory));

        factory.setRouter(address(router));
        factory.grantRole(factory.BONDING_ROLE(), bondingRole);
        router.grantRole(router.BONDING_ROLE(), bondingRole);

        // Create pair and seed liquidity
        vm.prank(bondingRole);
        pairAddr = factory.createPair(address(token), address(asset));

        // Mint tokens to bonding role for initial liquidity
        token.mint(bondingRole, TOKEN_SUPPLY);
        vm.startPrank(bondingRole);
        token.approve(address(router), TOKEN_SUPPLY);
        // For FRouter unit tests, use matching virtual/real reserves (no overflow scenario).
        router.addInitialLiquidity(address(token), TOKEN_SUPPLY, TOKEN_SUPPLY, ASSET_RESERVE);
        vm.stopPrank();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _doBuy(
        address buyer,
        uint256 amountIn
    ) internal returns (uint256 tokensOut) {
        asset.mint(buyer, amountIn);
        vm.startPrank(buyer);
        asset.approve(address(router), amountIn);
        vm.stopPrank();

        vm.prank(bondingRole);
        (,, tokensOut) = router.buy(amountIn, address(token), buyer);
    }

    function _doSell(
        address seller,
        uint256 tokenAmount
    ) internal returns (uint256 netAssetOut) {
        vm.startPrank(seller);
        token.approve(address(router), tokenAmount);
        vm.stopPrank();

        vm.prank(bondingRole);
        (, netAssetOut,) = router.sell(tokenAmount, address(token), seller);
    }

    // ─── getAmountOut Tests ──────────────────────────────────────────────

    function test_getAmountOut_buy_returnsPositive() public view {
        uint256 out = router.getAmountOut(address(token), true, 100 ether);
        assertTrue(out > 0, "Buy should return tokens");
    }

    function test_getAmountOut_sell_returnsPositive() public view {
        uint256 out = router.getAmountOut(address(token), false, 1_000_000 ether);
        assertTrue(out > 0, "Sell should return asset");
    }

    function test_getAmountOut_buy_largerInputGivesMoreOutput() public view {
        uint256 out1 = router.getAmountOut(address(token), true, 100 ether);
        uint256 out2 = router.getAmountOut(address(token), true, 200 ether);
        assertTrue(out2 > out1, "Larger input should give more output");
    }

    function test_getAmountOut_buy_zeroInputReturnsZero() public view {
        uint256 out = router.getAmountOut(address(token), true, 0);
        assertEq(out, 0, "Zero input should give zero output");
    }

    function test_getAmountOut_sell_zeroInputReturnsZero() public view {
        uint256 out = router.getAmountOut(address(token), false, 0);
        assertEq(out, 0, "Zero input should give zero output");
    }

    function test_getAmountOut_revertsForUnknownPair() public {
        address fakeToken = makeAddr("fakeToken");
        vm.expectRevert(FRouter.PairNotFound.selector);
        router.getAmountOut(fakeToken, true, 100 ether);
    }

    function test_getAmountOut_constantProductHolds() public view {
        // For a buy: new_r1 = r1 + amountIn, new_r0 = k / new_r1
        // tokensOut = r0 - new_r0
        uint256 amountIn = 500 ether;
        uint256 tokensOut = router.getAmountOut(address(token), true, amountIn);

        IFPair pair = IFPair(pairAddr);
        (uint256 r0, uint256 r1) = pair.getReserves();
        uint256 k = pair.kLast();

        uint256 newR1 = r1 + amountIn;
        uint256 newR0 = k / newR1;
        assertEq(tokensOut, r0 - newR0, "Output should match constant product formula");
    }

    function test_getAmountOut_extremeReserves() public {
        // Test with a very large buy relative to reserves
        uint256 largeAmount = 3000 ether; // 75% of asset reserve
        uint256 out = router.getAmountOut(address(token), true, largeAmount);
        assertTrue(out > 0, "Should handle large buy");
        assertTrue(out < TOKEN_SUPPLY, "Output should not exceed supply");
    }

    // ─── Buy Tests ───────────────────────────────────────────────────────

    function test_buy_transfersTokensToTrader() public {
        uint256 tokensOut = _doBuy(trader, 500 ether);
        assertEq(token.balanceOf(trader), tokensOut);
        assertTrue(tokensOut > 0);
    }

    function test_buy_deductsFeeFromInput() public {
        uint256 amountIn = 1000 ether;
        uint256 expectedFee = (BUY_TAX_BPS * amountIn) / 10_000; // 5 ether
        uint256 feeReceiverBefore = asset.balanceOf(feeReceiver);

        _doBuy(trader, amountIn);

        uint256 feeReceiverAfter = asset.balanceOf(feeReceiver);
        assertEq(feeReceiverAfter - feeReceiverBefore, expectedFee, "Fee should go to feeReceiver");
    }

    function test_buy_netAmountEntersPair() public {
        uint256 amountIn = 1000 ether;
        uint256 expectedNet = amountIn - (BUY_TAX_BPS * amountIn) / 10_000;

        IFPair pair = IFPair(pairAddr);
        (, uint256 r1Before) = pair.getReserves();

        _doBuy(trader, amountIn);

        (, uint256 r1After) = pair.getReserves();
        assertEq(r1After - r1Before, expectedNet, "Net amount should increase asset reserve");
    }

    function test_buy_returnsCorrectValues() public {
        uint256 amountIn = 500 ether;
        uint256 expectedFee = (BUY_TAX_BPS * amountIn) / 10_000;
        uint256 expectedNet = amountIn - expectedFee;

        asset.mint(trader, amountIn);
        vm.prank(trader);
        asset.approve(address(router), amountIn);

        vm.prank(bondingRole);
        (uint256 amountInUsed, uint256 netAssetIn, uint256 tokensOut) = router.buy(amountIn, address(token), trader);

        assertEq(amountInUsed, amountIn, "No overflow expected, amountInUsed should equal amountIn");
        assertEq(netAssetIn, expectedNet, "netAssetIn should be amountIn minus fee");
        assertTrue(tokensOut > 0, "tokensOut should be positive");
    }

    function test_buy_revertsOnZeroAmount() public {
        vm.prank(bondingRole);
        vm.expectRevert(FRouter.ZeroAmount.selector);
        router.buy(0, address(token), trader);
    }

    function test_buy_revertsWithoutBondingRole() public {
        asset.mint(stranger, 100 ether);
        vm.startPrank(stranger);
        asset.approve(address(router), 100 ether);
        vm.expectRevert();
        router.buy(100 ether, address(token), stranger);
        vm.stopPrank();
    }

    function test_buy_priceIncreasesWithSuccessiveBuys() public {
        uint256 buyAmount = 200 ether;
        uint256 tokensOut1 = _doBuy(trader, buyAmount);

        address trader2 = makeAddr("trader2");
        uint256 tokensOut2 = _doBuy(trader2, buyAmount);

        assertTrue(tokensOut2 < tokensOut1, "Second buy should get fewer tokens");
    }

    function test_buy_kUnchanged() public {
        IFPair pair = IFPair(pairAddr);
        uint256 kBefore = pair.kLast();

        _doBuy(trader, 500 ether);

        assertEq(pair.kLast(), kBefore, "k should not change after buy");
    }

    // ─── Sell Tests ──────────────────────────────────────────────────────

    function test_sell_returnsAssetToTrader() public {
        uint256 tokensOut = _doBuy(trader, 500 ether);

        uint256 assetBefore = asset.balanceOf(trader);
        _doSell(trader, tokensOut);
        uint256 assetAfter = asset.balanceOf(trader);

        assertTrue(assetAfter > assetBefore, "Trader should receive asset");
    }

    function test_sell_deductsFeeFromOutput() public {
        uint256 tokensOut = _doBuy(trader, 500 ether);

        // Calculate expected gross output
        uint256 grossOut = router.getAmountOut(address(token), false, tokensOut);
        uint256 expectedFee = (SELL_TAX_BPS * grossOut) / 10_000;
        uint256 expectedNet = grossOut - expectedFee;

        uint256 feeReceiverBefore = asset.balanceOf(feeReceiver);

        vm.prank(trader);
        token.approve(address(router), tokensOut);

        vm.prank(bondingRole);
        (uint256 tokensIn, uint256 netAssetOut, uint256 grossAssetOut) = router.sell(tokensOut, address(token), trader);

        assertEq(tokensIn, tokensOut);
        assertEq(grossAssetOut, grossOut, "Gross output should match getAmountOut");
        assertEq(netAssetOut, expectedNet, "Net output should be gross minus fee");

        uint256 feeReceiverAfter = asset.balanceOf(feeReceiver);
        assertEq(feeReceiverAfter - feeReceiverBefore, expectedFee, "Fee should go to feeReceiver");
    }

    function test_sell_revertsOnZeroAmount() public {
        vm.prank(bondingRole);
        vm.expectRevert(FRouter.ZeroAmount.selector);
        router.sell(0, address(token), trader);
    }

    function test_sell_revertsWithoutBondingRole() public {
        uint256 tokensOut = _doBuy(trader, 500 ether);

        vm.startPrank(trader);
        token.approve(address(router), tokensOut);
        vm.expectRevert();
        router.sell(tokensOut, address(token), trader);
        vm.stopPrank();
    }

    function test_sell_kUnchanged() public {
        uint256 tokensOut = _doBuy(trader, 500 ether);
        IFPair pair = IFPair(pairAddr);
        uint256 kBefore = pair.kLast();

        _doSell(trader, tokensOut);

        assertEq(pair.kLast(), kBefore, "k should not change after sell");
    }

    // ─── Round Trip Tests ────────────────────────────────────────────────

    function test_roundTrip_traderLosesToFees() public {
        uint256 buyAmount = 1000 ether;
        uint256 tokensOut = _doBuy(trader, buyAmount);
        uint256 netAssetOut = _doSell(trader, tokensOut);

        assertTrue(netAssetOut < buyAmount, "Trader should lose to fees on round trip");
    }

    // ─── addInitialLiquidity Tests ───────────────────────────────────────

    function test_addInitialLiquidity_revertsWithoutBondingRole() public {
        // Create a fresh pair to test
        MockERC20 token2 = new MockERC20("Token2", "TK2");
        vm.prank(bondingRole);
        factory.createPair(address(token2), address(asset));

        token2.mint(stranger, 1000 ether);
        vm.startPrank(stranger);
        token2.approve(address(router), 1000 ether);
        vm.expectRevert();
        router.addInitialLiquidity(address(token2), 1000 ether, 1000 ether, 100 ether);
        vm.stopPrank();
    }

    function test_addInitialLiquidity_revertsForUnknownPair() public {
        address fakeToken = makeAddr("fakeToken");
        vm.prank(bondingRole);
        vm.expectRevert(FRouter.PairNotFound.selector);
        router.addInitialLiquidity(fakeToken, 1000 ether, 1000 ether, 100 ether);
    }

    // ─── Graduate Tests ──────────────────────────────────────────────────

    function test_graduate_drainsAssetBalance() public {
        // Fund the pair with real asset tokens (simulating buys)
        asset.mint(pairAddr, 5000 ether);

        uint256 pairBalance = IFPair(pairAddr).assetBalance();
        assertTrue(pairBalance > 0, "Pair should have asset balance");

        vm.prank(bondingRole);
        uint256 amount = router.graduate(address(token));

        assertEq(amount, pairBalance, "Should drain full asset balance");
        assertEq(asset.balanceOf(bondingRole), amount, "Assets should go to caller");
        assertEq(IFPair(pairAddr).assetBalance(), 0, "Pair should have no assets left");
    }

    function test_graduate_revertsWithoutBondingRole() public {
        vm.prank(stranger);
        vm.expectRevert();
        router.graduate(address(token));
    }

    function test_graduate_returnsZeroWhenNoBalance() public {
        // Create a fresh pair with no real asset balance
        MockERC20 token2 = new MockERC20("Token2", "TK2");
        MockERC20 asset2 = new MockERC20("Asset2", "LT2");

        vm.prank(bondingRole);
        factory.createPair(address(token2), address(asset2));

        vm.prank(bondingRole);
        uint256 amount = router.graduate(address(token2));
        assertEq(amount, 0, "Should return 0 when pair has no asset balance");
    }

    // ─── Fuzz Tests ──────────────────────────────────────────────────────

    function testFuzz_getAmountOut_buy_neverExceedsReserve(
        uint256 amountIn
    ) public view {
        amountIn = bound(amountIn, 1, 100_000 ether);
        uint256 out = router.getAmountOut(address(token), true, amountIn);
        assertTrue(out < TOKEN_SUPPLY, "Output should never exceed token reserve");
    }

    function testFuzz_getAmountOut_sell_neverExceedsReserve(
        uint256 amountIn
    ) public view {
        amountIn = bound(amountIn, 1, TOKEN_SUPPLY / 2);
        uint256 out = router.getAmountOut(address(token), false, amountIn);
        assertTrue(out < ASSET_RESERVE, "Output should never exceed asset reserve");
    }

    function testFuzz_buyThenSell_noProfit(
        uint256 buyAmount
    ) public {
        buyAmount = bound(buyAmount, 1 ether, 3000 ether);
        uint256 tokensOut = _doBuy(trader, buyAmount);
        uint256 netAssetOut = _doSell(trader, tokensOut);
        assertTrue(netAssetOut <= buyAmount, "Should never profit on round trip");
    }
}
