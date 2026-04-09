// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Bonding} from "../src/Bonding.sol";
import {FFactory} from "../src/FFactory.sol";
import {FRouter} from "../src/FRouter.sol";
import {FERC20} from "../src/FERC20.sol";
import {IFPair} from "../src/interfaces/IFPair.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract BondingTest is Test {
    MockERC20 public asset;
    FFactory public factory;
    FRouter public router;
    Bonding public bonding;

    address public owner = address(this);
    address public feeReceiver = makeAddr("feeReceiver");
    address public creator = makeAddr("creator");
    address public trader = makeAddr("trader");
    address public trader2 = makeAddr("trader2");

    uint256 constant LAUNCH_FEE = 100 ether;
    uint256 constant BUY_TAX = 1; // 1%
    uint256 constant SELL_TAX = 1; // 1%
    uint256 constant ASSET_RATE = 10_000;
    uint256 constant MAX_TX = 100; // 100% = no limit
    uint256 constant GRAD_THRESHOLD = 85_000_000 ether; // 85M tokens remaining

    function setUp() public {
        asset = new MockERC20("Virtual Token", "VIRTUAL");

        factory = new FFactory();
        factory.initialize(feeReceiver, BUY_TAX, SELL_TAX);

        router = new FRouter();
        router.initialize(address(factory), address(asset));

        Bonding bondingImpl = new Bonding();
        bytes memory initData = abi.encodeCall(
            Bonding.initialize,
            (address(factory), address(router), feeReceiver, LAUNCH_FEE, ASSET_RATE, MAX_TX, GRAD_THRESHOLD)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(bondingImpl), initData);
        bonding = Bonding(address(proxy));

        factory.setRouter(address(router));
        factory.grantRole(factory.BONDING_ROLE(), address(bonding));
        router.grantRole(router.BONDING_ROLE(), address(bonding));
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _launchToken() internal returns (address tokenAddr, address pairAddr) {
        return _launchToken(200 ether);
    }

    function _launchToken(uint256 purchaseAmount) internal returns (address tokenAddr, address pairAddr) {
        asset.mint(creator, purchaseAmount);
        vm.startPrank(creator);
        asset.approve(address(bonding), purchaseAmount);
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "TestToken",
            ticker: "TEST",
            description: "A test token",
            image: "https://img.test/logo.png",
            urls: ["https://x.com/test", "", "", "https://test.com"],
            purchaseAmount: purchaseAmount
        });
        (tokenAddr, pairAddr,) = bonding.launch(params);
        vm.stopPrank();
    }

    function _buyTokens(address tokenAddr, address buyer, uint256 amount) internal returns (uint256 tokensOut) {
        asset.mint(buyer, amount);
        vm.startPrank(buyer);
        asset.approve(address(router), amount);
        tokensOut = bonding.buy(amount, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();
    }

    // ─── Setup Tests ─────────────────────────────────────────────────────

    function test_setUp_ownerIsCorrect() public view {
        assertEq(bonding.owner(), owner);
    }

    function test_setUp_factoryAndRouterLinked() public view {
        assertEq(address(bonding.factory()), address(factory));
        assertEq(address(bonding.router()), address(router));
        assertEq(factory.router(), address(router));
    }

    function test_setUp_paramsCorrect() public view {
        assertEq(bonding.fee(), LAUNCH_FEE);
        assertEq(bonding.K(), 3_000_000_000_000);
        assertEq(bonding.assetRate(), ASSET_RATE);
        assertEq(bonding.maxTx(), MAX_TX);
        assertEq(bonding.gradThreshold(), GRAD_THRESHOLD);
    }

    // ─── Launch Tests ────────────────────────────────────────────────────

    function test_launch_createsToken() public {
        (address tokenAddr,) = _launchToken();
        FERC20 token = FERC20(tokenAddr);

        assertEq(token.symbol(), "TEST");
        assertTrue(bytes(token.name()).length > 0);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
    }

    function test_launch_createsPair() public {
        (address tokenAddr, address pair) = _launchToken();

        assertFalse(pair == address(0));
        assertEq(factory.getPair(tokenAddr, address(asset)), pair);
        assertEq(factory.allPairsLength(), 1);
    }

    function test_launch_setsTokenInfo() public {
        (address tokenAddr,) = _launchToken();

        (address infoCreator,, address infoPair,,, bool trading, bool graduated) = bonding.tokenInfo(tokenAddr);

        assertEq(infoCreator, creator);
        assertFalse(infoPair == address(0));
        assertTrue(trading);
        assertFalse(graduated);
    }

    function test_launch_creatorReceivesInitialTokens() public {
        (address tokenAddr,) = _launchToken();
        FERC20 token = FERC20(tokenAddr);

        uint256 creatorBalance = token.balanceOf(creator);
        assertTrue(creatorBalance > 0, "Creator should have tokens from seed buy");
    }

    function test_launch_feeGoesToReceiver() public {
        uint256 balBefore = asset.balanceOf(feeReceiver);
        _launchToken(200 ether);
        uint256 balAfter = asset.balanceOf(feeReceiver);

        uint256 launchFee = LAUNCH_FEE;
        uint256 initialPurchase = 200 ether - launchFee;
        uint256 buyTaxOnInitialPurchase = (BUY_TAX * initialPurchase) / 100;
        assertEq(balAfter - balBefore, launchFee + buyTaxOnInitialPurchase);
    }

    function test_launch_pairHasVirtualLiquidity() public {
        (, address pairAddr) = _launchToken();
        IFPair pair = IFPair(pairAddr);

        (uint256 reserveToken, uint256 reserveAsset) = pair.getReserves();
        uint256 k = pair.kLast();

        assertTrue(reserveToken > 0, "Token reserve should be > 0");
        assertTrue(reserveAsset > 0, "Asset reserve should be > 0 (virtual)");
        assertApproxEqRel(k, reserveToken * reserveAsset, 0.001e18, "k ~= reserve0 * reserve1 at mint");

        uint256 realAssetBalance = pair.assetBalance();
        assertTrue(realAssetBalance < reserveAsset, "Real balance < virtual reserve (virtual liquidity)");
    }

    function test_launch_revertsIfPurchaseTooLow() public {
        asset.mint(creator, 50 ether);
        vm.startPrank(creator);
        asset.approve(address(bonding), 50 ether);
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "Bad",
            ticker: "BAD",
            description: "",
            image: "",
            urls: ["", "", "", ""],
            purchaseAmount: 50 ether
        });
        vm.expectRevert(Bonding.InvalidInput.selector);
        bonding.launch(params);
        vm.stopPrank();
    }

    function test_launch_tracksMultipleTokens() public {
        _launchToken();
        vm.warp(block.timestamp + 1);
        _launchToken();
        assertEq(bonding.allTokensLength(), 2);
    }

    // ─── Buy Tests ───────────────────────────────────────────────────────

    function test_buy_givesTokensToTrader() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = 500 ether;
        uint256 tokensOut = _buyTokens(tokenAddr, trader, buyAmount);

        assertEq(FERC20(tokenAddr).balanceOf(trader), tokensOut);
        assertTrue(tokensOut > 0, "Should receive tokens");
    }

    function test_buy_deductsAssetFromTrader() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = 500 ether;
        asset.mint(trader, buyAmount);

        vm.startPrank(trader);
        asset.approve(address(router), buyAmount);
        bonding.buy(buyAmount, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();

        assertEq(asset.balanceOf(trader), 0, "All asset should be spent");
    }

    function test_buy_feeGoesToReceiver() public {
        (address tokenAddr,) = _launchToken();
        uint256 feeBalBefore = asset.balanceOf(feeReceiver);

        uint256 buyAmount = 1000 ether;
        _buyTokens(tokenAddr, trader, buyAmount);

        uint256 expectedFee = (BUY_TAX * buyAmount) / 100;
        assertEq(asset.balanceOf(feeReceiver) - feeBalBefore, expectedFee);
    }

    function test_buy_priceIncreasesWithSuccessiveBuys() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = 100 ether;
        uint256 tokensOut1 = _buyTokens(tokenAddr, trader, buyAmount);
        uint256 tokensOut2 = _buyTokens(tokenAddr, trader2, buyAmount);

        assertTrue(tokensOut2 < tokensOut1, "Second buy should get fewer tokens (price increased)");
    }

    function test_buy_emitsEvent() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = 100 ether;
        asset.mint(trader, buyAmount);

        vm.startPrank(trader);
        asset.approve(address(router), buyAmount);

        vm.expectEmit(true, true, false, false);
        emit Bonding.Buy(tokenAddr, trader, 0, 0);
        bonding.buy(buyAmount, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();
    }

    function test_buy_revertsOnDeadline() public {
        (address tokenAddr,) = _launchToken();

        asset.mint(trader, 100 ether);
        vm.startPrank(trader);
        asset.approve(address(router), 100 ether);
        vm.expectRevert(Bonding.DeadlineExpired.selector);
        bonding.buy(100 ether, tokenAddr, 0, block.timestamp - 1);
        vm.stopPrank();
    }

    function test_buy_revertsOnSlippage() public {
        (address tokenAddr,) = _launchToken();

        asset.mint(trader, 100 ether);
        vm.startPrank(trader);
        asset.approve(address(router), 100 ether);
        vm.expectRevert(Bonding.SlippageExceeded.selector);
        bonding.buy(100 ether, tokenAddr, type(uint256).max, block.timestamp + 300);
        vm.stopPrank();
    }

    // ─── Sell Tests ──────────────────────────────────────────────────────

    function test_sell_returnsAssetToTrader() public {
        (address tokenAddr,) = _launchToken();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, 500 ether);

        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(router), tokensOut);
        uint256 assetBack = bonding.sell(tokensOut, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();

        assertEq(asset.balanceOf(trader), assetBack);
        assertTrue(assetBack > 0, "Should receive asset back");
    }

    function test_sell_burnsMemecoinsFromTrader() public {
        (address tokenAddr,) = _launchToken();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, 500 ether);

        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(router), tokensOut);
        bonding.sell(tokensOut, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();

        assertEq(FERC20(tokenAddr).balanceOf(trader), 0, "All tokens should be sold");
    }

    function test_sell_feeDeducted() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = 1000 ether;
        uint256 tokensOut = _buyTokens(tokenAddr, trader, buyAmount);

        uint256 feeBalBefore = asset.balanceOf(feeReceiver);

        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(router), tokensOut);
        bonding.sell(tokensOut, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();

        uint256 feeReceived = asset.balanceOf(feeReceiver) - feeBalBefore;
        assertTrue(feeReceived > 0, "Fee receiver should get sell fee");
    }

    function test_sell_revertsOnSlippage() public {
        (address tokenAddr,) = _launchToken();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, 500 ether);

        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(router), tokensOut);
        vm.expectRevert(Bonding.SlippageExceeded.selector);
        bonding.sell(tokensOut, tokenAddr, type(uint256).max, block.timestamp + 300);
        vm.stopPrank();
    }

    function test_sell_revertsOnDeadline() public {
        (address tokenAddr,) = _launchToken();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, 500 ether);

        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(router), tokensOut);
        vm.expectRevert(Bonding.DeadlineExpired.selector);
        bonding.sell(tokensOut, tokenAddr, 0, block.timestamp - 1);
        vm.stopPrank();
    }

    // ─── Round Trip Tests ────────────────────────────────────────────────

    function test_buyThenSell_traderLosesToFees() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = 1000 ether;
        uint256 tokensOut = _buyTokens(tokenAddr, trader, buyAmount);

        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(router), tokensOut);
        uint256 assetBack = bonding.sell(tokensOut, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();

        assertTrue(assetBack < buyAmount, "Trader loses to fees on round trip");
    }

    // ─── Graduation Tests ────────────────────────────────────────────────

    function test_graduation_triggeredByLargeBuy() public {
        (address tokenAddr,) = _launchToken();

        uint256 bigBuy = 50_000 ether;
        _buyTokens(tokenAddr, trader, bigBuy);

        assertTrue(bonding.isGraduated(tokenAddr), "Token should be graduated");
        assertFalse(bonding.isTrading(tokenAddr), "Token should not be trading");
    }

    function test_graduation_drainsAssetFromPair() public {
        (address tokenAddr, address pairAddr) = _launchToken();

        uint256 bigBuy = 50_000 ether;
        _buyTokens(tokenAddr, trader, bigBuy);

        assertEq(IFPair(pairAddr).assetBalance(), 0, "Pair asset balance should be drained");
    }

    function test_graduation_burnsRemainingTokens() public {
        (address tokenAddr, address pairAddr) = _launchToken();

        uint256 bigBuy = 50_000 ether;
        _buyTokens(tokenAddr, trader, bigBuy);

        assertEq(FERC20(tokenAddr).balanceOf(pairAddr), 0, "Pair should have no remaining tokens");
    }

    function test_graduation_emitsEvent() public {
        (address tokenAddr,) = _launchToken();

        uint256 bigBuy = 50_000 ether;
        asset.mint(trader, bigBuy);

        vm.startPrank(trader);
        asset.approve(address(router), bigBuy);

        vm.expectEmit(true, false, false, false);
        emit Bonding.Graduated(tokenAddr, 0, 0);
        bonding.buy(bigBuy, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();
    }

    function test_graduation_bondingHoldsAssets() public {
        (address tokenAddr,) = _launchToken();

        uint256 bondingBalBefore = asset.balanceOf(address(bonding));
        uint256 bigBuy = 50_000 ether;
        _buyTokens(tokenAddr, trader, bigBuy);

        uint256 bondingBalAfter = asset.balanceOf(address(bonding));
        assertTrue(bondingBalAfter > bondingBalBefore, "Bonding should hold graduated assets");
    }

    // ─── Post-Graduation Tests ───────────────────────────────────────────

    function test_postGraduation_buyReverts() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, 50_000 ether);

        assertTrue(bonding.isGraduated(tokenAddr));

        asset.mint(trader2, 100 ether);
        vm.startPrank(trader2);
        asset.approve(address(router), 100 ether);
        vm.expectRevert(Bonding.TokenNotTrading.selector);
        bonding.buy(100 ether, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();
    }

    function test_postGraduation_sellReverts() public {
        (address tokenAddr,) = _launchToken();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, 1000 ether);

        _buyTokens(tokenAddr, trader2, 50_000 ether);
        assertTrue(bonding.isGraduated(tokenAddr));

        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(router), tokensOut);
        vm.expectRevert(Bonding.TokenNotTrading.selector);
        bonding.sell(tokensOut, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();
    }

    // ─── Multiple Tokens Test ────────────────────────────────────────────

    function test_multipleTokens_independentCurves() public {
        (address token1,) = _launchToken();
        vm.warp(block.timestamp + 1);
        (address token2,) = _launchToken();

        uint256 tokensOut1 = _buyTokens(token1, trader, 500 ether);
        uint256 tokensOut2 = _buyTokens(token2, trader, 500 ether);

        assertApproxEqRel(tokensOut1, tokensOut2, 0.01e18, "Same buy amount should give similar tokens on fresh curves");
    }

    // ─── AMM Math Tests ─────────────────────────────────────────────────

    function test_amm_kRemainsConstant() public {
        (address tokenAddr, address pairAddr2) = _launchToken();
        IFPair pair = IFPair(pairAddr2);

        uint256 kBefore = pair.kLast();
        _buyTokens(tokenAddr, trader, 500 ether);
        uint256 kAfter = pair.kLast();

        assertEq(kBefore, kAfter, "k should not change after trades");
    }

    function test_amm_reservesUpdateCorrectly() public {
        (address tokenAddr, address pairAddr) = _launchToken();
        IFPair pair = IFPair(pairAddr);

        (uint256 r0Before, uint256 r1Before) = pair.getReserves();

        uint256 buyAmount = 500 ether;
        _buyTokens(tokenAddr, trader, buyAmount);

        (uint256 r0After, uint256 r1After) = pair.getReserves();

        assertTrue(r0After < r0Before, "Token reserve should decrease on buy");
        assertTrue(r1After > r1Before, "Asset reserve should increase on buy");
    }

    function test_amm_getAmountOut_buyAndSell() public {
        (address tokenAddr,) = _launchToken();

        uint256 netBuyIn = 99 ether; // 100 ether minus 1% fee
        uint256 tokensOut = router.getAmountOut(tokenAddr, true, netBuyIn);
        assertTrue(tokensOut > 0, "getAmountOut should return > 0 for buy");

        uint256 assetBack = router.getAmountOut(tokenAddr, false, tokensOut);
        assertApproxEqRel(assetBack, netBuyIn, 0.1e18, "Sell should approximately return what was put in");
    }

    // ─── FERC20 Tests ────────────────────────────────────────────────────

    function test_ferc20_hasCorrectSupply() public {
        (address tokenAddr,) = _launchToken();
        assertEq(FERC20(tokenAddr).totalSupply(), 1_000_000_000 ether);
    }

    function test_ferc20_nameIsPrefixed() public {
        (address tokenAddr,) = _launchToken();
        assertEq(FERC20(tokenAddr).name(), "fun TestToken");
    }

    function test_ferc20_ownerIsBonding() public {
        (address tokenAddr,) = _launchToken();
        assertEq(FERC20(tokenAddr).owner(), address(bonding));
    }

    // ─── Fuzz Tests ──────────────────────────────────────────────────────

    function testFuzz_buy_doesNotRevert(
        uint256 buyAmount
    ) public {
        buyAmount = bound(buyAmount, 1 ether, 10_000 ether);
        (address tokenAddr,) = _launchToken();

        asset.mint(trader, buyAmount);
        vm.startPrank(trader);
        asset.approve(address(router), buyAmount);
        uint256 tokensOut = bonding.buy(buyAmount, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();

        assertTrue(tokensOut > 0);
    }

    function testFuzz_buyThenSell_noProfit(
        uint256 buyAmount
    ) public {
        buyAmount = bound(buyAmount, 10 ether, 5000 ether);
        (address tokenAddr,) = _launchToken();

        uint256 tokensOut = _buyTokens(tokenAddr, trader, buyAmount);

        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(router), tokensOut);
        uint256 assetBack = bonding.sell(tokensOut, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();

        assertTrue(assetBack <= buyAmount, "Should never profit on round trip");
    }

    // ─── Admin Tests ─────────────────────────────────────────────────────

    function test_setParams_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        bonding.setParams(0, 10_000, 100, 85_000_000 ether, feeReceiver);
    }

    function test_setParams_updatesValues() public {
        bonding.setParams(200 ether, 20_000, 50, 100_000_000 ether, trader);

        assertEq(bonding.fee(), 200 ether);
        assertEq(bonding.assetRate(), 20_000);
        assertEq(bonding.maxTx(), 50);
        assertEq(bonding.gradThreshold(), 100_000_000 ether);
        assertEq(bonding.feeTo(), trader);
    }

    function test_setParams_revertsOnZeroAssetRate() public {
        vm.expectRevert(Bonding.InvalidInput.selector);
        bonding.setParams(100 ether, 0, 100, 85_000_000 ether, feeReceiver);
    }
}
