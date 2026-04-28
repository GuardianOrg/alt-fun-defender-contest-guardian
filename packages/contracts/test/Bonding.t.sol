// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
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
        // Keep `graduationThresholdUsd` at a constant multiple of
        // `VIRTUAL_LIQUIDITY_USD` so the curve dynamics tested below stay
        // valid as the production config is retuned. See
        // `DeployHelper._alignThresholdToVirtualLiquidity`.
        _alignThresholdToVirtualLiquidity();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _launchToken() internal returns (address tokenAddr, address pairAddr) {
        return _launchToken(_defaultSeedLt());
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

    // ─── Description / Image / URL Length Validation ────────────────────
    //
    // These caps exist as DoS guards. A misbehaving caller could otherwise
    // pack a multi-MB string into the launch tx and bloat block space and
    // the indexer. The numbers here mirror the public constants and must
    // stay in sync with the off-chain validation in the API.

    function _launchParamsBase() internal returns (Bonding.LaunchParams memory) {
        return Bonding.LaunchParams({
            name: "Valid",
            ticker: "VLD",
            description: "",
            image: "",
            urls: ["", "", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator)
        });
    }

    function test_launch_revertsOnDescriptionTooLong() public {
        vm.startPrank(creator);
        Bonding.LaunchParams memory params = _launchParamsBase();
        params.description = _repeat("A", 8001);
        vm.expectRevert(Bonding.InvalidDescriptionLength.selector);
        bonding.launch(params, creator);
        vm.stopPrank();
    }

    function test_launch_acceptsDescriptionAtMaxLength() public {
        vm.startPrank(creator);
        Bonding.LaunchParams memory params = _launchParamsBase();
        params.description = _repeat("A", 8000);
        (address tokenAddr,,) = bonding.launch(params, creator);
        vm.stopPrank();
        assertTrue(tokenAddr != address(0));
    }

    function test_launch_revertsOnImageTooLong() public {
        vm.startPrank(creator);
        Bonding.LaunchParams memory params = _launchParamsBase();
        params.image = _repeat("A", 513);
        vm.expectRevert(Bonding.InvalidImageLength.selector);
        bonding.launch(params, creator);
        vm.stopPrank();
    }

    function test_launch_acceptsImageAtMaxLength() public {
        vm.startPrank(creator);
        Bonding.LaunchParams memory params = _launchParamsBase();
        params.image = _repeat("A", 512);
        (address tokenAddr,,) = bonding.launch(params, creator);
        vm.stopPrank();
        assertTrue(tokenAddr != address(0));
    }

    function test_launch_revertsOnAnyUrlTooLong() public {
        // Verify the per-slot loop catches an oversize URL in a non-zero
        // index, not just the first one. Easy off-by-one to introduce.
        vm.startPrank(creator);
        Bonding.LaunchParams memory params = _launchParamsBase();
        params.urls[2] = _repeat("A", 513);
        vm.expectRevert(Bonding.InvalidUrlLength.selector);
        bonding.launch(params, creator);
        vm.stopPrank();
    }

    function test_launch_acceptsUrlsAtMaxLength() public {
        vm.startPrank(creator);
        Bonding.LaunchParams memory params = _launchParamsBase();
        for (uint256 i = 0; i < 4; i++) {
            params.urls[i] = _repeat("A", 512);
        }
        (address tokenAddr,,) = bonding.launch(params, creator);
        vm.stopPrank();
        assertTrue(tokenAddr != address(0));
    }

    function _repeat(
        string memory s,
        uint256 n
    ) internal pure returns (string memory) {
        bytes memory unit = bytes(s);
        bytes memory out = new bytes(unit.length * n);
        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = 0; j < unit.length; j++) {
                out[i * unit.length + j] = unit[j];
            }
        }
        return string(out);
    }

    // ─── Buy Tests ───────────────────────────────────────────────────────

    function test_buy_givesTokensToTrader() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = _smallBuyLt();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, buyAmount);

        assertEq(Token(tokenAddr).balanceOf(trader), tokensOut);
        assertTrue(tokensOut > 0, "Should receive tokens");
    }

    function test_buy_deductsLtFromTrader() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = _smallBuyLt();
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

        _buyTokens(tokenAddr, trader, _smallBuyLt());

        // Fees have moved to Zap + FeeVault — Bonding no longer
        // retains any LT from trade fees.
        assertEq(lt.balanceOf(address(bonding)), bondingBalBefore, "Bonding should not accumulate trade fees");
    }

    function test_buy_priceIncreasesWithSuccessiveBuys() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = _smallBuyLt();
        uint256 tokensOut1 = _buyTokens(tokenAddr, trader, buyAmount);
        uint256 tokensOut2 = _buyTokens(tokenAddr, trader2, buyAmount);

        assertTrue(tokensOut2 < tokensOut1, "Second buy should get fewer tokens (price increased)");
    }

    function test_buy_emitsTradeEvent() public {
        (address tokenAddr,) = _launchToken();

        uint256 buyAmount = _smallBuyLt();
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

        uint256 buyAmount = _smallBuyLt();
        lt.mintDirect(trader, buyAmount);
        vm.startPrank(trader);
        lt.approve(address(curveRouter), buyAmount);
        vm.expectRevert(Bonding.SlippageExceeded.selector);
        bonding.buy(buyAmount, tokenAddr, type(uint256).max, trader);
        vm.stopPrank();
    }

    // ─── Sell Tests ──────────────────────────────────────────────────────

    function test_sell_returnsLtToTrader() public {
        (address tokenAddr,) = _launchToken();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, _smallBuyLt());

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(curveRouter), tokensOut);
        uint256 ltBack = bonding.sell(tokensOut, tokenAddr, 0, trader);
        vm.stopPrank();

        assertEq(lt.balanceOf(trader), ltBack);
        assertTrue(ltBack > 0, "Should receive LT back");
    }

    function test_sell_burnsTokensFromTrader() public {
        (address tokenAddr,) = _launchToken();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, _smallBuyLt());

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(curveRouter), tokensOut);
        bonding.sell(tokensOut, tokenAddr, 0, trader);
        vm.stopPrank();

        assertEq(Token(tokenAddr).balanceOf(trader), 0, "All tokens should be sold");
    }

    function test_sell_revertsOnSlippage() public {
        (address tokenAddr,) = _launchToken();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, _smallBuyLt());

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

        uint256 buyAmount = _mediumBuyLt();
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

        // Stage real LT below threshold at the current exchange rate.
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        assertFalse(bonding.canGraduate(tokenAddr), "Should not graduate yet at base rate");

        // Pump the rate so the staged LT value crosses the threshold —
        // graduation should now be armed without any further trade.
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        assertTrue(bonding.canGraduate(tokenAddr), "Should be graduatable after exchange rate increase");
    }

    // ─── Post-Graduation Tests ───────────────────────────────────────────

    function test_postGraduation_buyReverts() public {
        (address tokenAddr,) = _launchToken();

        // Stage just below threshold, then pump rate to arm graduation.
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        assertFalse(bonding.isGraduated(tokenAddr));

        lt.setExchangeRate(_ratePumpForStagedGraduation());
        assertTrue(bonding.canGraduate(tokenAddr));

        // The next buy — even a tiny one — fires `_graduate`.
        _buyTokens(tokenAddr, trader2, _ltGraduationTrigger());
        assertTrue(bonding.isGraduated(tokenAddr));

        // Buying on graduated token should revert
        uint256 attemptedBuy = _smallBuyLt();
        lt.mintDirect(trader, attemptedBuy);
        vm.startPrank(trader);
        lt.approve(address(curveRouter), attemptedBuy);
        vm.expectRevert(Bonding.TokenNotTrading.selector);
        bonding.buy(attemptedBuy, tokenAddr, 0, trader);
        vm.stopPrank();
    }

    // ─── Graduation Integration Tests ──────────────────────────────────────

    function test_graduation_setsGraduatedFlag() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        _buyTokens(tokenAddr, trader2, _ltGraduationTrigger());

        assertTrue(bonding.isGraduated(tokenAddr));
        assertFalse(bonding.isTrading(tokenAddr));
    }

    function test_graduation_sellAlsoReverts() public {
        (address tokenAddr,) = _launchToken();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        _buyTokens(tokenAddr, trader2, _ltGraduationTrigger());
        assertTrue(bonding.isGraduated(tokenAddr));

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(curveRouter), tokensOut);
        vm.expectRevert(Bonding.TokenNotTrading.selector);
        bonding.sell(tokensOut, tokenAddr, 0, trader);
        vm.stopPrank();
    }

    function test_graduation_emitsTokenGraduating() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());

        uint256 trigger = _ltGraduationTrigger();
        lt.mintDirect(trader2, trigger);
        vm.startPrank(trader2);
        lt.approve(address(curveRouter), trigger);

        // Phase 1 of graduation now fires inline on the threshold-crossing buy
        // — `TokenGraduating` is the new event for that boundary.
        vm.expectEmit(true, false, false, false);
        emit Bonding.TokenGraduating(tokenAddr, 0, 0, 0, 0);
        bonding.buy(trigger, tokenAddr, 0, trader2);
        vm.stopPrank();
    }

    function test_graduation_emitsTokenGraduated() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());

        uint256 trigger = _ltGraduationTrigger();
        lt.mintDirect(trader2, trigger);
        vm.startPrank(trader2);
        lt.approve(address(curveRouter), trigger);
        bonding.buy(trigger, tokenAddr, 0, trader2);
        vm.stopPrank();

        // Phase 2: anyone can call `finalizeGraduation` to seed the HyperSwap LP.
        vm.expectEmit(true, false, false, false);
        emit Bonding.TokenGraduated(tokenAddr, address(0), 0, 0, 0, 0);
        bonding.finalizeGraduation(tokenAddr);
    }

    function test_graduation_createsLpLock() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        _buyTokens(tokenAddr, trader2, _ltGraduationTrigger());

        (address lpPair, uint256 lockedAmount, uint256 lockedAt) = lpLockContract.getLock(tokenAddr);
        assertTrue(lpPair != address(0), "LP pair should be recorded");
        assertTrue(lockedAmount > 0, "Locked LP amount should be > 0");
        assertTrue(lockedAt > 0, "Lock timestamp should be set");
    }

    function test_graduation_setsGraduatedPair() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        _buyTokens(tokenAddr, trader2, _ltGraduationTrigger());

        address hyperPair = bonding.graduatedPair(tokenAddr);
        assertTrue(hyperPair != address(0), "HyperSwap pair should be set");
    }

    function test_graduation_lpReserveCleared() public {
        (address tokenAddr,) = _launchToken();
        uint256 lpBefore = bonding.lpReserve(tokenAddr);
        assertTrue(lpBefore > 0, "LP reserve should be set before graduation");

        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        _buyTokens(tokenAddr, trader2, _ltGraduationTrigger());

        assertEq(bonding.lpReserve(tokenAddr), 0, "LP reserve should be cleared after graduation");
    }

    function test_graduation_lpTokensSentToLpLock() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        _buyTokens(tokenAddr, trader2, _ltGraduationTrigger());

        address hyperPair = bonding.graduatedPair(tokenAddr);
        uint256 lpBalance = IERC20(hyperPair).balanceOf(address(lpLockContract));
        assertTrue(lpBalance > 0, "LPLock should hold LP tokens");
    }

    // ─── Multiple Tokens Test ────────────────────────────────────────────

    function test_multipleTokens_independentCurves() public {
        (address token1,) = _launchToken();
        vm.warp(block.timestamp + 1);
        (address token2,) = _launchToken();

        uint256 buyAmount = _smallBuyLt();
        uint256 tokensOut1 = _buyTokens(token1, trader, buyAmount);
        uint256 tokensOut2 = _buyTokens(token2, trader, buyAmount);

        assertApproxEqRel(tokensOut1, tokensOut2, 0.01e18, "Same buy amount should give similar tokens on fresh curves");
    }

    // ─── AMM Math Tests ─────────────────────────────────────────────────

    function test_amm_kRemainsConstant() public {
        (address tokenAddr, address pairAddr2) = _launchToken();
        IPair pair = IPair(pairAddr2);

        uint256 kBefore = pair.kLast();
        _buyTokens(tokenAddr, trader, _smallBuyLt());
        uint256 kAfter = pair.kLast();

        assertEq(kBefore, kAfter, "k should not change after trades");
    }

    function test_amm_reservesUpdateCorrectly() public {
        (address tokenAddr, address pairAddr) = _launchToken();
        IPair pair = IPair(pairAddr);

        (uint256 r0Before, uint256 r1Before) = pair.getReserves();

        _buyTokens(tokenAddr, trader, _smallBuyLt());

        (uint256 r0After, uint256 r1After) = pair.getReserves();

        assertTrue(r0After < r0Before, "Token reserve should decrease on buy");
        assertTrue(r1After > r1Before, "Asset reserve should increase on buy");
    }

    function test_amm_getAmountOut_buyAndSell() public {
        (address tokenAddr,) = _launchTokenNoSeed();

        // `getAmountOut` is a *stateless* quote — calling it twice in opposite
        // directions doesn't actually move the curve, so the round-trip
        // asymmetry scales with `tradeSize / virtualLiquidity`. Keep the test
        // trade tiny relative to the opening virtual liquidity so the
        // mathematical asymmetry stays well inside the 10% tolerance below
        // regardless of the configured `VIRTUAL_LIQUIDITY_USD`.
        uint256 netBuyIn = _initialVirtualLt() / 100; // 1% of virtual liquidity
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
        // Bound the fuzz range to LT amounts that always succeed regardless
        // of the configured `VIRTUAL_LIQUIDITY_USD`. A buy capped at one
        // initial-virtual-LT-worth (post-seed) is well shy of both the supply
        // trigger and the (aligned) USD trigger.
        buyAmount = bound(buyAmount, 1, _initialVirtualLt());
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
        // Same bound rationale as `testFuzz_buy_doesNotRevert`: keep the buy
        // small enough that the curve doesn't graduate (which would block
        // the follow-up sell).
        buyAmount = bound(buyAmount, _ltForUsd(0.1 ether), _initialVirtualLt());
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

    function test_setGraduationThresholdUsd_initialisesToDefault() public {
        // Re-deploy a fresh Bonding proxy so the threshold reflects the
        // initialise-time default — the suite-level `setUp` aligns the
        // running proxy to a virt-liquidity-pegged value, masking the default.
        Bonding freshImpl = new Bonding();
        bytes memory init = abi.encodeCall(
            Bonding.initialize,
            (
                address(factory),
                address(curveRouter),
                MAX_TX,
                address(hyperswapRouter),
                address(lpLockContract),
                address(tokenImpl)
            )
        );
        Bonding fresh = Bonding(address(new ERC1967Proxy(address(freshImpl), init)));

        assertEq(fresh.graduationThresholdUsd(), fresh.DEFAULT_GRADUATION_THRESHOLD_USD());
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
    ///         ~70% of threshold and dropping the threshold below it.
    function test_loweringThreshold_graduatesOnNextTrade() public {
        (address tokenAddr,) = _launchToken();
        uint256 originalThreshold = bonding.graduationThresholdUsd();

        // Park real LT value at ~70% of the current threshold — comfortably
        // below it, so graduation isn't yet armed. The exact LT amount
        // scales with `lt.exchangeRate()` so this works regardless of the
        // configured `VIRTUAL_LIQUIDITY_USD`.
        uint256 stageLt = _ltForUsd((originalThreshold * 70) / 100);
        _buyTokens(tokenAddr, trader, stageLt);
        assertFalse(bonding.canGraduate(tokenAddr), "Should not be graduatable at original threshold");

        // Lower threshold below current real-LT-value → next-trade graduation arms.
        // Use 50% of original (well below the 70% we staked) and clamp to the
        // protocol's `MIN_GRADUATION_THRESHOLD_USD` floor in case original/2
        // would underflow it.
        uint256 newThreshold = originalThreshold / 2;
        uint256 floor = bonding.MIN_GRADUATION_THRESHOLD_USD();
        if (newThreshold < floor) newThreshold = floor;
        bonding.setGraduationThresholdUsd(newThreshold);
        assertTrue(bonding.canGraduate(tokenAddr), "Lowering the threshold below current value arms graduation");

        // The next buy — even a tiny one — actually fires `_graduate`.
        _buyTokens(tokenAddr, trader2, _ltGraduationTrigger());
        assertTrue(bonding.isGraduated(tokenAddr), "Next trade after lowering threshold should graduate");
    }

    /// @notice Raising the threshold above a token's current real LT value
    ///         disarms graduation — the token continues trading, no funds
    ///         at risk, just needs more buys. Mirror of the lowering test.
    function test_raisingThreshold_defersGraduation() public {
        (address tokenAddr,) = _launchToken();
        uint256 originalThreshold = bonding.graduationThresholdUsd();

        // Get the token close to graduating via the standard rate-pump
        // pattern (stage 80% of threshold + 2× rate bump = 160% threshold).
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        assertTrue(bonding.canGraduate(tokenAddr), "Should be at-threshold under original");

        // Owner raises the bar — graduation disarms. We need a value above
        // the current real-LT-value (≈ 1.6× original) but below the
        // protocol ceiling. 3× original is comfortable on both sides.
        uint256 newThreshold = originalThreshold * 3;
        uint256 ceiling = bonding.MAX_GRADUATION_THRESHOLD_USD();
        if (newThreshold > ceiling) newThreshold = ceiling;
        bonding.setGraduationThresholdUsd(newThreshold);
        assertFalse(bonding.canGraduate(tokenAddr), "Raising above current value should disarm graduation");

        // Confirm the next buy doesn't fire graduation. Use a tiny trigger
        // so we don't accidentally drain the curve via the supply trigger
        // when the staged 80% has already consumed most of it.
        _buyTokens(tokenAddr, trader2, _ltGraduationTrigger());
        assertFalse(bonding.isGraduated(tokenAddr), "Token should still be trading after a buy under the higher bar");
    }
}
