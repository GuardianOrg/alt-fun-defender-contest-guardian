// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Bonding} from "../src/Bonding.sol";
import {FFactory} from "../src/FFactory.sol";
import {FRouter} from "../src/FRouter.sol";
import {FERC20} from "../src/FERC20.sol";
import {LPLock} from "../src/LPLock.sol";
import {IFPair} from "../src/interfaces/IFPair.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockLeveragedToken} from "./mocks/MockLeveragedToken.sol";
import {MockHyperswapRouter} from "./mocks/MockHyperswapRouter.sol";

contract BondingTest is Test {
    MockERC20 public usdc;
    MockLeveragedToken public lt;
    MockHyperswapRouter public hyperswapRouter;
    FFactory public factory;
    FRouter public router;
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

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC");
        lt = new MockLeveragedToken("HYPE 2x Long", "HYPE2L", LT_EXCHANGE_RATE, 2, true, "HYPE", address(usdc));
        hyperswapRouter = new MockHyperswapRouter();

        factory = new FFactory();
        factory.initialize(feeReceiver, BUY_TAX_BPS, SELL_TAX_BPS);

        router = new FRouter();
        router.initialize(address(factory));

        LPLock lpLockImpl = new LPLock();
        bytes memory lpLockInit = abi.encodeCall(LPLock.initialize, (owner));
        lpLockContract = LPLock(address(new ERC1967Proxy(address(lpLockImpl), lpLockInit)));

        Bonding bondingImpl = new Bonding();
        bytes memory initData = abi.encodeCall(
            Bonding.initialize,
            (address(factory), address(router), feeReceiver, MAX_TX, address(hyperswapRouter), address(lpLockContract))
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(bondingImpl), initData);
        bonding = Bonding(address(proxy));

        factory.setRouter(address(router));
        factory.grantRole(factory.BONDING_ROLE(), address(bonding));
        router.grantRole(router.BONDING_ROLE(), address(bonding));
        lpLockContract.setLocker(address(bonding), true);
        bonding.setRedemptionRouter(creator);

        // Set feeTo = bonding so trade fees accumulate there for fee accounting
        factory.setFeeParams(address(bonding), BUY_TAX_BPS, SELL_TAX_BPS);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _launchToken() internal returns (address tokenAddr, address pairAddr) {
        return _launchToken(200 ether);
    }

    function _launchToken(
        uint256 seedLtAmount
    ) internal returns (address tokenAddr, address pairAddr) {
        lt.mintDirect(creator, seedLtAmount);
        vm.startPrank(creator);
        lt.approve(address(router), seedLtAmount);
        lt.approve(address(bonding), seedLtAmount);

        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "TestToken",
            ticker: "TEST",
            description: "A test token",
            image: "https://img.test/logo.png",
            urls: ["https://x.com/test", "", "", "https://test.com"],
            ltAddress: address(lt),
            purchaseAmount: seedLtAmount
        });
        (tokenAddr, pairAddr,) = bonding.launch(params, creator);
        vm.stopPrank();
    }

    function _launchTokenNoSeed() internal returns (address tokenAddr, address pairAddr) {
        vm.startPrank(creator);
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "NoSeed",
            ticker: "NOSEED",
            description: "No seed buy",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: address(lt),
            purchaseAmount: 0
        });
        (tokenAddr, pairAddr,) = bonding.launch(params, creator);
        vm.stopPrank();
    }

    function _buyTokens(
        address tokenAddr,
        address buyer,
        uint256 ltAmount
    ) internal returns (uint256 tokensOut) {
        lt.mintDirect(buyer, ltAmount);
        vm.startPrank(buyer);
        lt.approve(address(router), ltAmount);
        tokensOut = bonding.buy(ltAmount, tokenAddr, 0, block.timestamp + 300);
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
        assertEq(bonding.maxTx(), MAX_TX);
        assertEq(factory.buyTax(), BUY_TAX_BPS);
        assertEq(factory.sellTax(), SELL_TAX_BPS);
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
        assertEq(factory.getPair(tokenAddr, address(lt)), pair);
        assertEq(factory.pairFor(tokenAddr), pair);
        assertEq(factory.ltFor(tokenAddr), address(lt));
        assertEq(factory.allPairsLength(), 1);
    }

    function test_launch_setsTokenInfo() public {
        (address tokenAddr,) = _launchToken();

        (address infoCreator,,, address ltAddr,,, bool trading, bool graduated) = bonding.tokenInfo(tokenAddr);

        assertEq(infoCreator, creator);
        assertEq(ltAddr, address(lt));
        assertTrue(trading);
        assertFalse(graduated);
    }

    function test_launch_creatorReceivesInitialTokens() public {
        (address tokenAddr,) = _launchToken();
        FERC20 token = FERC20(tokenAddr);

        uint256 creatorBalance = token.balanceOf(creator);
        assertTrue(creatorBalance > 0, "Creator should have tokens from seed buy");
    }

    function test_launch_75percentOnCurve() public {
        (address tokenAddr, address pairAddr) = _launchToken();
        IFPair pair = IFPair(pairAddr);
        (uint256 reserveToken,) = pair.getReserves();

        uint256 totalSupply = FERC20(tokenAddr).totalSupply();
        uint256 expected75 = (totalSupply * 7500) / 10_000;

        // After seed buy, reserve should be slightly less than 75% (some bought out)
        assertTrue(reserveToken < expected75, "Reserve should be less than 75% after seed buy");
        assertTrue(reserveToken > expected75 / 2, "Reserve should still be substantial");
    }

    function test_launch_reservesLPTokens() public {
        (address tokenAddr,) = _launchToken();

        uint256 totalSupply = FERC20(tokenAddr).totalSupply();
        uint256 expected25 = (totalSupply * 2500) / 10_000;

        // lpReserve returns the tokens minus what was bought in seed
        uint256 bondingBalance = FERC20(tokenAddr).balanceOf(address(bonding));
        assertEq(bondingBalance, expected25, "Bonding should hold 25% for LP reserve");
    }

    function test_launch_noSeedBuy() public {
        (address tokenAddr, address pairAddr) = _launchTokenNoSeed();
        IFPair pair = IFPair(pairAddr);
        (uint256 reserveToken,) = pair.getReserves();

        uint256 totalSupply = FERC20(tokenAddr).totalSupply();
        uint256 expected75 = (totalSupply * 7500) / 10_000;
        assertEq(reserveToken, expected75, "Full 75% should be on curve with no seed buy");

        uint256 creatorBalance = FERC20(tokenAddr).balanceOf(creator);
        assertEq(creatorBalance, 0, "Creator should have no tokens without seed buy");
    }

    function test_launch_pairHasVirtualLiquidity() public {
        (, address pairAddr) = _launchToken();
        IFPair pair = IFPair(pairAddr);

        (uint256 reserveToken, uint256 reserveAsset) = pair.getReserves();
        uint256 k = pair.kLast();

        assertTrue(reserveToken > 0, "Token reserve should be > 0");
        assertTrue(reserveAsset > 0, "Asset reserve should be > 0 (virtual)");
        // k should be close to the product (not exact due to seed buy adjusting reserves)
        assertTrue(k > 0, "k should be > 0");

        uint256 realAssetBalance = pair.assetBalance();
        assertTrue(realAssetBalance < reserveAsset, "Real balance < virtual reserve (virtual liquidity)");
    }

    function test_launch_tracksMultipleTokens() public {
        _launchToken();
        vm.warp(block.timestamp + 1);
        _launchToken();
        assertEq(bonding.allTokensLength(), 2);
    }

    function test_launch_emitsEvent() public {
        lt.mintDirect(creator, 200 ether);
        vm.startPrank(creator);
        lt.approve(address(router), 200 ether);
        lt.approve(address(bonding), 200 ether);

        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "EventTest",
            ticker: "EVT",
            description: "",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: address(lt),
            purchaseAmount: 200 ether
        });

        vm.expectEmit(false, true, false, false);
        emit Bonding.TokenLaunched(address(0), creator, address(lt), "EventTest", "EVT", 0, 0);
        bonding.launch(params, creator);
        vm.stopPrank();
    }

    // ─── Buy Tests ───────────────────────────────────────────────────────

    function test_buy_givesTokensToTrader() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = 500 ether;
        uint256 tokensOut = _buyTokens(tokenAddr, trader, buyAmount);

        assertEq(FERC20(tokenAddr).balanceOf(trader), tokensOut);
        assertTrue(tokensOut > 0, "Should receive tokens");
    }

    function test_buy_deductsLtFromTrader() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = 500 ether;
        lt.mintDirect(trader, buyAmount);

        vm.startPrank(trader);
        lt.approve(address(router), buyAmount);
        bonding.buy(buyAmount, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();

        assertEq(lt.balanceOf(trader), 0, "All LT should be spent");
    }

    function test_buy_feeGoesToBonding() public {
        (address tokenAddr,) = _launchToken();
        uint256 bondingBalBefore = lt.balanceOf(address(bonding));

        uint256 buyAmount = 1000 ether;
        _buyTokens(tokenAddr, trader, buyAmount);

        uint256 expectedFee = (BUY_TAX_BPS * buyAmount) / 10_000;
        uint256 bondingBalAfter = lt.balanceOf(address(bonding));
        assertEq(bondingBalAfter - bondingBalBefore, expectedFee, "Fee should go to bonding");
    }

    function test_buy_priceIncreasesWithSuccessiveBuys() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = 100 ether;
        uint256 tokensOut1 = _buyTokens(tokenAddr, trader, buyAmount);
        uint256 tokensOut2 = _buyTokens(tokenAddr, trader2, buyAmount);

        assertTrue(tokensOut2 < tokensOut1, "Second buy should get fewer tokens (price increased)");
    }

    function test_buy_emitsTradeEvent() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = 100 ether;
        lt.mintDirect(trader, buyAmount);

        vm.startPrank(trader);
        lt.approve(address(router), buyAmount);

        vm.expectEmit(true, true, false, false);
        emit Bonding.Trade(tokenAddr, trader, true, 0, 0, 0, 0);
        bonding.buy(buyAmount, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();
    }

    function test_buy_revertsOnDeadline() public {
        (address tokenAddr,) = _launchToken();

        lt.mintDirect(trader, 100 ether);
        vm.startPrank(trader);
        lt.approve(address(router), 100 ether);
        vm.expectRevert(Bonding.DeadlineExpired.selector);
        bonding.buy(100 ether, tokenAddr, 0, block.timestamp - 1);
        vm.stopPrank();
    }

    function test_buy_revertsOnSlippage() public {
        (address tokenAddr,) = _launchToken();

        lt.mintDirect(trader, 100 ether);
        vm.startPrank(trader);
        lt.approve(address(router), 100 ether);
        vm.expectRevert(Bonding.SlippageExceeded.selector);
        bonding.buy(100 ether, tokenAddr, type(uint256).max, block.timestamp + 300);
        vm.stopPrank();
    }

    // ─── Sell Tests ──────────────────────────────────────────────────────

    function test_sell_returnsLtToTrader() public {
        (address tokenAddr,) = _launchToken();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, 500 ether);

        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(router), tokensOut);
        uint256 ltBack = bonding.sell(tokensOut, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();

        assertEq(lt.balanceOf(trader), ltBack);
        assertTrue(ltBack > 0, "Should receive LT back");
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

    function test_sell_revertsOnSlippage() public {
        (address tokenAddr,) = _launchToken();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, 500 ether);

        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(router), tokensOut);
        vm.expectRevert(Bonding.SlippageExceeded.selector);
        bonding.sell(tokensOut, tokenAddr, type(uint256).max, block.timestamp + 300);
        vm.stopPrank();
    }

    // ─── Round Trip Tests ────────────────────────────────────────────────

    function test_buyThenSell_traderLosesToFees() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = 1000 ether;
        uint256 tokensOut = _buyTokens(tokenAddr, trader, buyAmount);

        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(router), tokensOut);
        uint256 ltBack = bonding.sell(tokensOut, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();

        assertTrue(ltBack < buyAmount, "Trader loses to fees on round trip");
    }

    // ─── Creator Fee Tests ───────────────────────────────────────────────

    function test_creatorFees_accrue() public {
        (address tokenAddr,) = _launchTokenNoSeed();

        uint256 buyAmount = 1000 ether;
        _buyTokens(tokenAddr, trader, buyAmount);

        uint256 creatorFee = bonding.creatorFees(creator, address(lt));
        assertTrue(creatorFee > 0, "Creator should have accrued fees");

        uint256 totalFee = (BUY_TAX_BPS * buyAmount) / 10_000;
        uint256 expectedCreatorShare = (totalFee * 2000) / 10_000; // 20% of total fee
        assertEq(creatorFee, expectedCreatorShare, "Creator fee should be 20% of total fee");
    }

    function test_creatorFees_claimable() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, 1000 ether);

        uint256 accrued = bonding.creatorFees(creator, address(lt));
        assertTrue(accrued > 0);

        vm.prank(creator);
        bonding.claimCreatorFees(address(lt));

        assertEq(lt.balanceOf(creator), accrued, "Creator should receive claimed fees");
        assertEq(bonding.creatorFees(creator, address(lt)), 0, "Accrued should be zero after claim");
    }

    function test_protocolFees_accrue() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, 1000 ether);

        uint256 protocolFee = bonding.protocolFees(address(lt));
        assertTrue(protocolFee > 0, "Protocol should have accrued fees");
    }

    function test_transferCreator() public {
        (address tokenAddr,) = _launchToken();

        vm.prank(creator);
        bonding.transferCreator(tokenAddr, trader);

        (address newCreator,,,,,,,) = bonding.tokenInfo(tokenAddr);
        assertEq(newCreator, trader);
    }

    function test_transferCreator_onlyCreator() public {
        (address tokenAddr,) = _launchToken();

        vm.prank(trader);
        vm.expectRevert(Bonding.NotCreator.selector);
        bonding.transferCreator(tokenAddr, trader);
    }

    // ─── Graduation Tests ────────────────────────────────────────────────
    // Note: Full graduation with HyperSwap seeding requires mock UniV2 Router.
    // These tests verify the canGraduate check and pre-graduation state.

    function test_canGraduate_returnsFalseInitially() public {
        (address tokenAddr,) = _launchToken();
        assertFalse(bonding.canGraduate(tokenAddr), "Should not be graduatable initially");
    }

    function test_canGraduate_returnsTrueWhenThresholdMet() public {
        (address tokenAddr,) = _launchToken();

        // Buy a moderate amount at $1/LT (below threshold)
        _buyTokens(tokenAddr, trader, 5000 ether);
        assertFalse(bonding.canGraduate(tokenAddr), "Should not graduate yet at $1/LT");

        // Increase exchange rate so existing LT crosses $12K threshold
        lt.setExchangeRate(3 ether); // $3/LT -> ~$15K value
        assertTrue(bonding.canGraduate(tokenAddr), "Should be graduatable after exchange rate increase");
    }

    // ─── Post-Graduation Tests ───────────────────────────────────────────

    function test_postGraduation_buyReverts() public {
        (address tokenAddr,) = _launchToken();

        // Buy enough LT to build up reserves
        _buyTokens(tokenAddr, trader, 5000 ether);
        assertFalse(bonding.isGraduated(tokenAddr));

        // Increase exchange rate so LT value crosses $12K threshold
        lt.setExchangeRate(3 ether);
        assertTrue(bonding.canGraduate(tokenAddr));

        // Next buy triggers graduation
        _buyTokens(tokenAddr, trader2, 100 ether);
        assertTrue(bonding.isGraduated(tokenAddr));

        // Buying on graduated token should revert
        lt.mintDirect(trader, 100 ether);
        vm.startPrank(trader);
        lt.approve(address(router), 100 ether);
        vm.expectRevert(Bonding.TokenNotTrading.selector);
        bonding.buy(100 ether, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();
    }

    // ─── Graduation Integration Tests ──────────────────────────────────────

    function test_graduation_setsGraduatedFlag() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, 5000 ether);
        lt.setExchangeRate(3 ether);
        _buyTokens(tokenAddr, trader2, 100 ether);

        assertTrue(bonding.isGraduated(tokenAddr));
        assertFalse(bonding.isTrading(tokenAddr));
    }

    function test_graduation_sellAlsoReverts() public {
        (address tokenAddr,) = _launchToken();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, 5000 ether);
        lt.setExchangeRate(3 ether);
        _buyTokens(tokenAddr, trader2, 100 ether);
        assertTrue(bonding.isGraduated(tokenAddr));

        vm.startPrank(trader);
        FERC20(tokenAddr).approve(address(router), tokensOut);
        vm.expectRevert(Bonding.TokenNotTrading.selector);
        bonding.sell(tokensOut, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();
    }

    function test_graduation_emitsTokenGraduated() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, 5000 ether);
        lt.setExchangeRate(3 ether);

        lt.mintDirect(trader2, 100 ether);
        vm.startPrank(trader2);
        lt.approve(address(router), 100 ether);

        vm.expectEmit(true, false, false, false);
        emit Bonding.TokenGraduated(tokenAddr, address(0), 0);
        bonding.buy(100 ether, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();
    }

    function test_graduation_createsLpLock() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, 5000 ether);
        lt.setExchangeRate(3 ether);
        _buyTokens(tokenAddr, trader2, 100 ether);

        (address lpPair, uint256 lockedAmount, uint256 lockedAt) = lpLockContract.getLock(tokenAddr);
        assertTrue(lpPair != address(0), "LP pair should be recorded");
        assertTrue(lockedAmount > 0, "Locked LP amount should be > 0");
        assertTrue(lockedAt > 0, "Lock timestamp should be set");
    }

    function test_graduation_setsGraduatedPair() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, 5000 ether);
        lt.setExchangeRate(3 ether);
        _buyTokens(tokenAddr, trader2, 100 ether);

        address hyperPair = bonding.graduatedPair(tokenAddr);
        assertTrue(hyperPair != address(0), "HyperSwap pair should be set");
    }

    function test_graduation_lpReserveCleared() public {
        (address tokenAddr,) = _launchToken();
        uint256 lpBefore = bonding.lpReserve(tokenAddr);
        assertTrue(lpBefore > 0, "LP reserve should be set before graduation");

        _buyTokens(tokenAddr, trader, 5000 ether);
        lt.setExchangeRate(3 ether);
        _buyTokens(tokenAddr, trader2, 100 ether);

        assertEq(bonding.lpReserve(tokenAddr), 0, "LP reserve should be cleared after graduation");
    }

    function test_graduation_lpTokensSentToLpLock() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, 5000 ether);
        lt.setExchangeRate(3 ether);
        _buyTokens(tokenAddr, trader2, 100 ether);

        address hyperPair = bonding.graduatedPair(tokenAddr);
        uint256 lpBalance = IERC20(hyperPair).balanceOf(address(lpLockContract));
        assertTrue(lpBalance > 0, "LPLock should hold LP tokens");
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

        _buyTokens(tokenAddr, trader, 500 ether);

        (uint256 r0After, uint256 r1After) = pair.getReserves();

        assertTrue(r0After < r0Before, "Token reserve should decrease on buy");
        assertTrue(r1After > r1Before, "Asset reserve should increase on buy");
    }

    function test_amm_getAmountOut_buyAndSell() public {
        (address tokenAddr,) = _launchTokenNoSeed();

        uint256 netBuyIn = 100 ether;
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

        lt.mintDirect(trader, buyAmount);
        vm.startPrank(trader);
        lt.approve(address(router), buyAmount);
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
        uint256 ltBack = bonding.sell(tokensOut, tokenAddr, 0, block.timestamp + 300);
        vm.stopPrank();

        assertTrue(ltBack <= buyAmount, "Should never profit on round trip");
    }

    // ─── Admin Tests ─────────────────────────────────────────────────────

    function test_setParams_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        bonding.setParams(100, feeReceiver);
    }

    function test_setParams_updatesValues() public {
        bonding.setParams(50, trader);

        assertEq(bonding.maxTx(), 50);
        assertEq(bonding.feeTo(), trader);
    }
}
