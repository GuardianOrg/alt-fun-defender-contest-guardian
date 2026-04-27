// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Bonding} from "../src/Bonding.sol";
import {Token} from "../src/Token.sol";
import {IPair} from "../src/interfaces/IPair.sol";
import {DeployHelper} from "./DeployHelper.sol";

contract BondingTest is DeployHelper {
    function setUp() public {
        _deployCore();
        // Tests drive Bonding directly (bypassing Zap) by pranking
        // as each actor. Allowlist every pranked address so `onlyRouter`-gated
        // functions accept their calls.
        bonding.addRouter(creator);
        bonding.addRouter(trader);
        bonding.addRouter(trader2);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _launchToken() internal returns (address tokenAddr, address pairAddr) {
        return _launchToken(200 ether);
    }

    function _launchToken(
        uint256 seedLtAmount
    ) internal returns (address tokenAddr, address pairAddr) {
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "TestToken",
            ticker: "TEST",
            description: "A test token",
            image: "https://img.test/logo.png",
            urls: ["https://x.com/test", "", "", "https://test.com"],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator)
        });
        vm.prank(creator);
        (tokenAddr, pairAddr,) = bonding.launch(params, creator);

        // Seed buys no longer happen inside `Bonding.launch` — they're now a
        // post-launch step in the Zap. To preserve the seeded curve
        // state these Bonding-level tests rely on, perform an equivalent seed
        // buy via `bonding.buy` (creator is already on the router allowlist).
        if (seedLtAmount > 0) {
            _buyTokens(tokenAddr, creator, seedLtAmount);
        }
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
            salt: _mineVanitySalt(creator)
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
        if (!bonding.isRouter(buyer)) bonding.addRouter(buyer);
        vm.startPrank(buyer);
        lt.approve(address(curveRouter), ltAmount);
        (tokensOut,) = bonding.buy(ltAmount, tokenAddr, 0, buyer);
        vm.stopPrank();

        // Two-phase graduation: if this buy crossed the threshold, drive
        // phase 2 inline so the rest of the test sees the standard
        // `Graduated` lifecycle (matches the production keeper's behaviour).
        if (bonding.isGraduating(tokenAddr)) bonding.finalizeGraduation(tokenAddr);
    }

    // ─── Setup Tests ─────────────────────────────────────────────────────

    function test_setUp_ownerIsCorrect() public view {
        assertEq(bonding.owner(), owner);
    }

    function test_setUp_factoryAndRouterLinked() public view {
        assertEq(address(bonding.factory()), address(factory));
        assertEq(address(bonding.router()), address(curveRouter));
        assertEq(factory.router(), address(curveRouter));
    }

    function test_setUp_paramsCorrect() public view {
        assertEq(bonding.maxTx(), MAX_TX);
    }

    // ─── Launch Tests ────────────────────────────────────────────────────

    function test_launch_createsToken() public {
        (address tokenAddr,) = _launchToken();
        Token token = Token(tokenAddr);

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

        (address infoCreator,,, address ltAddr,,, Bonding.Lifecycle lifecycle) = bonding.tokenInfo(tokenAddr);

        assertEq(infoCreator, creator);
        assertEq(ltAddr, address(lt));
        assertTrue(lifecycle == Bonding.Lifecycle.Curve);
    }

    function test_launch_creatorReceivesInitialTokens() public {
        (address tokenAddr,) = _launchToken();
        Token token = Token(tokenAddr);

        uint256 creatorBalance = token.balanceOf(creator);
        assertTrue(creatorBalance > 0, "Creator should have tokens from seed buy");
    }

    function test_launch_75percentOnCurveSellable() public {
        (address tokenAddr, address pairAddr) = _launchToken();
        IPair pair = IPair(pairAddr);

        uint256 totalSupply = Token(tokenAddr).totalSupply();
        uint256 expected75 = (totalSupply * 7500) / 10_000;

        // Real tokens in pair (sellable) should be slightly less than 75% after seed buy
        uint256 realBalance = pair.tokenBalance();
        assertTrue(realBalance < expected75, "Real balance should be less than 75% after seed buy");
        assertTrue(realBalance > expected75 / 2, "Real balance should still be substantial");

        // Virtual reserve0 starts at totalSupply (1B), so even after a seed buy it is well above 75%
        (uint256 reserveToken,) = pair.getReserves();
        assertTrue(reserveToken > expected75, "Virtual reserve0 should be > 75% (starts at totalSupply)");
    }

    function test_launch_reservesLPTokens() public {
        (address tokenAddr,) = _launchToken();

        uint256 totalSupply = Token(tokenAddr).totalSupply();
        uint256 expected25 = (totalSupply * 2500) / 10_000;

        // lpReserve returns the tokens minus what was bought in seed
        uint256 bondingBalance = Token(tokenAddr).balanceOf(address(bonding));
        assertEq(bondingBalance, expected25, "Bonding should hold 25% for LP reserve");
    }

    function test_launch_noSeedBuy() public {
        (address tokenAddr, address pairAddr) = _launchTokenNoSeed();
        IPair pair = IPair(pairAddr);
        (uint256 reserveToken,) = pair.getReserves();

        uint256 totalSupply = Token(tokenAddr).totalSupply();
        uint256 expected75 = (totalSupply * 7500) / 10_000;

        // Virtual reserve0 equals totalSupply; real balance equals curveSupply (75%)
        assertEq(reserveToken, totalSupply, "Virtual reserve0 should equal totalSupply");
        assertEq(pair.tokenBalance(), expected75, "Real token balance should equal 75%");

        uint256 creatorBalance = Token(tokenAddr).balanceOf(creator);
        assertEq(creatorBalance, 0, "Creator should have no tokens without seed buy");
    }

    function test_launch_pairHasVirtualLiquidity() public {
        (, address pairAddr) = _launchToken();
        IPair pair = IPair(pairAddr);

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
        vm.startPrank(creator);

        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "EventTest",
            ticker: "EVT",
            description: "",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator)
        });

        vm.expectEmit(false, true, false, false);
        emit Bonding.TokenLaunched(address(0), creator, address(lt), "EventTest", "EVT", 0, 0);
        bonding.launch(params, creator);
        vm.stopPrank();
    }

    // ─── Name/Ticker Length Validation ──────────────────────────────────

    function _launchParamsWithNameTicker(
        string memory name_,
        string memory ticker_
    ) internal returns (Bonding.LaunchParams memory) {
        return Bonding.LaunchParams({
            name: name_,
            ticker: ticker_,
            description: "",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator)
        });
    }

    function test_launch_revertsOnEmptyName() public {
        vm.startPrank(creator);
        Bonding.LaunchParams memory params = _launchParamsWithNameTicker("", "TEST");
        vm.expectRevert(Bonding.InvalidNameLength.selector);
        bonding.launch(params, creator);
        vm.stopPrank();
    }

    function test_launch_revertsOnNameTooLong() public {
        vm.startPrank(creator);
        // 35 chars (max is 34)
        Bonding.LaunchParams memory params = _launchParamsWithNameTicker("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "TEST");
        vm.expectRevert(Bonding.InvalidNameLength.selector);
        bonding.launch(params, creator);
        vm.stopPrank();
    }

    function test_launch_acceptsNameAtMaxLength() public {
        vm.startPrank(creator);
        // exactly 34 chars
        Bonding.LaunchParams memory params = _launchParamsWithNameTicker("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "TEST");
        (address tokenAddr,,) = bonding.launch(params, creator);
        vm.stopPrank();
        assertTrue(tokenAddr != address(0));
        assertEq(Token(tokenAddr).name(), "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    }

    function test_launch_revertsOnEmptyTicker() public {
        vm.startPrank(creator);
        Bonding.LaunchParams memory params = _launchParamsWithNameTicker("Valid", "");
        vm.expectRevert(Bonding.InvalidTickerLength.selector);
        bonding.launch(params, creator);
        vm.stopPrank();
    }

    function test_launch_revertsOnTickerTooLong() public {
        vm.startPrank(creator);
        // 11 chars (max is 10)
        Bonding.LaunchParams memory params = _launchParamsWithNameTicker("Valid", "AAAAAAAAAAA");
        vm.expectRevert(Bonding.InvalidTickerLength.selector);
        bonding.launch(params, creator);
        vm.stopPrank();
    }

    function test_launch_acceptsTickerAtMaxLength() public {
        vm.startPrank(creator);
        // exactly 10 chars
        Bonding.LaunchParams memory params = _launchParamsWithNameTicker("Valid", "AAAAAAAAAA");
        (address tokenAddr,,) = bonding.launch(params, creator);
        vm.stopPrank();
        assertTrue(tokenAddr != address(0));
        assertEq(Token(tokenAddr).symbol(), "AAAAAAAAAA");
    }

    function test_launch_acceptsMinLengthNameAndTicker() public {
        vm.startPrank(creator);
        Bonding.LaunchParams memory params = _launchParamsWithNameTicker("A", "B");
        (address tokenAddr,,) = bonding.launch(params, creator);
        vm.stopPrank();
        assertTrue(tokenAddr != address(0));
    }

    // ─── Buy Tests ───────────────────────────────────────────────────────

    function test_buy_givesTokensToTrader() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = 500 ether;
        uint256 tokensOut = _buyTokens(tokenAddr, trader, buyAmount);

        assertEq(Token(tokenAddr).balanceOf(trader), tokensOut);
        assertTrue(tokensOut > 0, "Should receive tokens");
    }

    function test_buy_deductsLtFromTrader() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = 500 ether;
        lt.mintDirect(trader, buyAmount);

        vm.startPrank(trader);
        lt.approve(address(curveRouter), buyAmount);
        bonding.buy(buyAmount, tokenAddr, 0, trader);
        vm.stopPrank();

        assertEq(lt.balanceOf(trader), 0, "All LT should be spent");
    }

    function test_buy_noFeeHeldInBonding() public {
        (address tokenAddr,) = _launchToken();
        uint256 bondingBalBefore = lt.balanceOf(address(bonding));

        _buyTokens(tokenAddr, trader, 1000 ether);

        // Fees have moved to Zap + FeeVault — Bonding no longer
        // retains any LT from trade fees.
        assertEq(lt.balanceOf(address(bonding)), bondingBalBefore, "Bonding should not accumulate trade fees");
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
        lt.approve(address(curveRouter), buyAmount);

        vm.expectEmit(true, true, false, false);
        emit Bonding.Trade(tokenAddr, trader, true, 0, 0, 0, 0);
        bonding.buy(buyAmount, tokenAddr, 0, trader);
        vm.stopPrank();
    }

    function test_buy_revertsOnSlippage() public {
        (address tokenAddr,) = _launchToken();

        lt.mintDirect(trader, 100 ether);
        vm.startPrank(trader);
        lt.approve(address(curveRouter), 100 ether);
        vm.expectRevert(Bonding.SlippageExceeded.selector);
        bonding.buy(100 ether, tokenAddr, type(uint256).max, trader);
        vm.stopPrank();
    }

    // ─── Sell Tests ──────────────────────────────────────────────────────

    function test_sell_returnsLtToTrader() public {
        (address tokenAddr,) = _launchToken();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, 500 ether);

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(curveRouter), tokensOut);
        uint256 ltBack = bonding.sell(tokensOut, tokenAddr, 0, trader);
        vm.stopPrank();

        assertEq(lt.balanceOf(trader), ltBack);
        assertTrue(ltBack > 0, "Should receive LT back");
    }

    function test_sell_burnsTokensFromTrader() public {
        (address tokenAddr,) = _launchToken();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, 500 ether);

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(curveRouter), tokensOut);
        bonding.sell(tokensOut, tokenAddr, 0, trader);
        vm.stopPrank();

        assertEq(Token(tokenAddr).balanceOf(trader), 0, "All tokens should be sold");
    }

    function test_sell_revertsOnSlippage() public {
        (address tokenAddr,) = _launchToken();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, 500 ether);

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(curveRouter), tokensOut);
        vm.expectRevert(Bonding.SlippageExceeded.selector);
        bonding.sell(tokensOut, tokenAddr, type(uint256).max, trader);
        vm.stopPrank();
    }

    // ─── Round Trip Tests ────────────────────────────────────────────────

    /// @notice With fees moved to Zap, a pure-Bonding round trip
    ///         is now lossless (ignoring rounding). The fee layer is exercised
    ///         end-to-end in `Zap.t.sol`.
    function test_buyThenSell_lossless() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = 1000 ether;
        uint256 tokensOut = _buyTokens(tokenAddr, trader, buyAmount);

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(curveRouter), tokensOut);
        uint256 ltBack = bonding.sell(tokensOut, tokenAddr, 0, trader);
        vm.stopPrank();

        assertApproxEqRel(ltBack, buyAmount, 0.001e18, "Round trip should be approximately lossless");
    }

    function test_transferCreator() public {
        (address tokenAddr,) = _launchToken();

        vm.prank(creator);
        bonding.transferCreator(tokenAddr, trader);

        (address newCreator,,,,,,) = bonding.tokenInfo(tokenAddr);
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
        lt.approve(address(curveRouter), 100 ether);
        vm.expectRevert(Bonding.TokenNotTrading.selector);
        bonding.buy(100 ether, tokenAddr, 0, trader);
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
        Token(tokenAddr).approve(address(curveRouter), tokensOut);
        vm.expectRevert(Bonding.TokenNotTrading.selector);
        bonding.sell(tokensOut, tokenAddr, 0, trader);
        vm.stopPrank();
    }

    function test_graduation_emitsTokenGraduating() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, 5000 ether);
        lt.setExchangeRate(3 ether);

        lt.mintDirect(trader2, 100 ether);
        vm.startPrank(trader2);
        lt.approve(address(curveRouter), 100 ether);

        // Phase 1 of graduation now fires inline on the threshold-crossing buy
        // — `TokenGraduating` is the new event for that boundary.
        vm.expectEmit(true, false, false, false);
        emit Bonding.TokenGraduating(tokenAddr, 0, 0, 0, 0);
        bonding.buy(100 ether, tokenAddr, 0, trader2);
        vm.stopPrank();
    }

    function test_graduation_emitsTokenGraduated() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, 5000 ether);
        lt.setExchangeRate(3 ether);

        lt.mintDirect(trader2, 100 ether);
        vm.startPrank(trader2);
        lt.approve(address(curveRouter), 100 ether);
        bonding.buy(100 ether, tokenAddr, 0, trader2);
        vm.stopPrank();

        // Phase 2: anyone can call `finalizeGraduation` to seed the HyperSwap LP.
        vm.expectEmit(true, false, false, false);
        emit Bonding.TokenGraduated(tokenAddr, address(0), 0, 0, 0, 0);
        bonding.finalizeGraduation(tokenAddr);
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
        IPair pair = IPair(pairAddr2);

        uint256 kBefore = pair.kLast();
        _buyTokens(tokenAddr, trader, 500 ether);
        uint256 kAfter = pair.kLast();

        assertEq(kBefore, kAfter, "k should not change after trades");
    }

    function test_amm_reservesUpdateCorrectly() public {
        (address tokenAddr, address pairAddr) = _launchToken();
        IPair pair = IPair(pairAddr);

        (uint256 r0Before, uint256 r1Before) = pair.getReserves();

        _buyTokens(tokenAddr, trader, 500 ether);

        (uint256 r0After, uint256 r1After) = pair.getReserves();

        assertTrue(r0After < r0Before, "Token reserve should decrease on buy");
        assertTrue(r1After > r1Before, "Asset reserve should increase on buy");
    }

    function test_amm_getAmountOut_buyAndSell() public {
        (address tokenAddr,) = _launchTokenNoSeed();

        uint256 netBuyIn = 100 ether;
        uint256 tokensOut = curveRouter.getAmountOut(tokenAddr, true, netBuyIn);
        assertTrue(tokensOut > 0, "getAmountOut should return > 0 for buy");

        uint256 assetBack = curveRouter.getAmountOut(tokenAddr, false, tokensOut);
        assertApproxEqRel(assetBack, netBuyIn, 0.1e18, "Sell should approximately return what was put in");
    }

    // ─── Token Tests ────────────────────────────────────────────────────

    function test_token_hasCorrectSupply() public {
        (address tokenAddr,) = _launchToken();
        assertEq(Token(tokenAddr).totalSupply(), 1_000_000_000 ether);
    }

    function test_token_nameMatchesInput() public {
        (address tokenAddr,) = _launchToken();
        assertEq(Token(tokenAddr).name(), "TestToken");
    }

    function test_token_ownerIsBonding() public {
        (address tokenAddr,) = _launchToken();
        assertEq(Token(tokenAddr).owner(), address(bonding));
    }

    // ─── Fuzz Tests ──────────────────────────────────────────────────────

    function testFuzz_buy_doesNotRevert(
        uint256 buyAmount
    ) public {
        buyAmount = bound(buyAmount, 1 ether, 10_000 ether);
        (address tokenAddr,) = _launchToken();

        lt.mintDirect(trader, buyAmount);
        vm.startPrank(trader);
        lt.approve(address(curveRouter), buyAmount);
        (uint256 tokensOut,) = bonding.buy(buyAmount, tokenAddr, 0, trader);
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
        Token(tokenAddr).approve(address(curveRouter), tokensOut);
        uint256 ltBack = bonding.sell(tokensOut, tokenAddr, 0, trader);
        vm.stopPrank();

        assertTrue(ltBack <= buyAmount, "Should never profit on round trip");
    }

    // ─── Admin Tests ─────────────────────────────────────────────────────

    function test_setMaxTx_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        bonding.setMaxTx(100);
    }

    function test_setMaxTx_updatesValue() public {
        bonding.setMaxTx(50);
        assertEq(bonding.maxTx(), 50);
    }

    // ─── Graduation Threshold Admin Tests ────────────────────────────────

    function test_setGraduationThresholdUsd_initialisesToDefault() public view {
        assertEq(bonding.graduationThresholdUsd(), bonding.DEFAULT_GRADUATION_THRESHOLD_USD());
        assertEq(bonding.graduationThresholdUsd(), 12_000 ether);
    }

    function test_setGraduationThresholdUsd_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        bonding.setGraduationThresholdUsd(20_000 ether);
    }

    function test_setGraduationThresholdUsd_updatesValue() public {
        bonding.setGraduationThresholdUsd(20_000 ether);
        assertEq(bonding.graduationThresholdUsd(), 20_000 ether);
    }

    function test_setGraduationThresholdUsd_emitsEvent() public {
        uint256 oldValue = bonding.graduationThresholdUsd();
        vm.expectEmit(false, false, false, true);
        emit Bonding.GraduationThresholdUpdated(oldValue, 25_000 ether);
        bonding.setGraduationThresholdUsd(25_000 ether);
    }

    function test_setGraduationThresholdUsd_revertsBelowFloor() public {
        // Floor pegged to VIRTUAL_LIQUIDITY_USD ($4K) — anything below would
        // let an admin pre-graduate freshly-launched curves.
        // Cache the floor before `vm.expectRevert` so it isn't the
        // intercepted "next call".
        uint256 floor = bonding.MIN_GRADUATION_THRESHOLD_USD();
        vm.expectRevert(Bonding.InvalidThreshold.selector);
        bonding.setGraduationThresholdUsd(floor - 1);
    }

    function test_setGraduationThresholdUsd_acceptsExactFloor() public {
        uint256 floor = bonding.MIN_GRADUATION_THRESHOLD_USD();
        bonding.setGraduationThresholdUsd(floor);
        assertEq(bonding.graduationThresholdUsd(), floor);
    }

    function test_setGraduationThresholdUsd_revertsAboveCeiling() public {
        uint256 ceiling = bonding.MAX_GRADUATION_THRESHOLD_USD();
        vm.expectRevert(Bonding.InvalidThreshold.selector);
        bonding.setGraduationThresholdUsd(ceiling + 1);
    }

    function test_setGraduationThresholdUsd_acceptsExactCeiling() public {
        uint256 ceiling = bonding.MAX_GRADUATION_THRESHOLD_USD();
        bonding.setGraduationThresholdUsd(ceiling);
        assertEq(bonding.graduationThresholdUsd(), ceiling);
    }

    /// @notice Lowering the threshold mid-flight makes a token whose real LT
    ///         reserve already exceeds the new value graduate on its next
    ///         trade. This is the explicit design choice (see `Bonding.sol`
    ///         natspec on `graduationThresholdUsd`) — the simplest semantic
    ///         for an admin tuning the dial. Verified by parking a token at
    ///         ~$8K of value and dropping the threshold to $5K.
    function test_loweringThreshold_graduatesOnNextTrade() public {
        (address tokenAddr,) = _launchToken();

        // Park real LT reserve at ~$7K (well below the $12K default but
        // comfortably above the $5K threshold we'll lower to). Note `_buyTokens`
        // gross-input gets 0.5% taxed before settling, so we buy a bit more
        // than the target net.
        _buyTokens(tokenAddr, trader, 7000 ether);
        assertFalse(bonding.canGraduate(tokenAddr), "Should not be graduatable at default $12K threshold");

        // Lower threshold below current value → next-trade graduation arms.
        bonding.setGraduationThresholdUsd(5000 ether);
        assertTrue(bonding.canGraduate(tokenAddr), "Lowering the threshold below current value arms graduation");

        // The next buy — even a tiny one — actually fires `_graduate`.
        _buyTokens(tokenAddr, trader2, 50 ether);
        assertTrue(bonding.isGraduated(tokenAddr), "Next trade after lowering threshold should graduate");
    }

    /// @notice Raising the threshold above a token's current real LT value
    ///         disarms graduation — the token continues trading, no funds
    ///         at risk, just needs more buys. Mirror of the lowering test.
    function test_raisingThreshold_defersGraduation() public {
        (address tokenAddr,) = _launchToken();

        // Get the token close to graduating: real LT * rate above default
        // $12K but below a hypothetical $30K.
        _buyTokens(tokenAddr, trader, 5000 ether);
        lt.setExchangeRate(3 ether); // ~$15K of LT value, would graduate
        assertTrue(bonding.canGraduate(tokenAddr), "Should be at-threshold under default $12K");

        // Owner raises the bar — graduation disarms.
        bonding.setGraduationThresholdUsd(30_000 ether);
        assertFalse(bonding.canGraduate(tokenAddr), "Raising above current value should disarm graduation");

        // Confirm the next buy doesn't fire graduation.
        _buyTokens(tokenAddr, trader2, 100 ether);
        assertFalse(bonding.isGraduated(tokenAddr), "Token should still be trading after a buy under the higher bar");
    }
}
