// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
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
            urls: ["https://x.com/test", "", "https://test.com"],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator, "TestToken", "TEST")
        });
        vm.prank(creator);
        (tokenAddr, pairAddr) = bonding.launch(params, creator);

        // Seed buys no longer happen inside `Bonding.launch` — they're now a
        // post-launch step in the Zap. The unit tests drive Bonding directly
        // (each `vm.prank` + external call is its own tx, so the seed-buy
        // transient bypass set inside `launch()` is cleared before the
        // follow-up buy). Skip past the launch trading delay so the
        // simulated "seed buy" lands without tripping `TradingNotOpen`.
        if (seedLtAmount > 0) {
            _skipLaunchDelay();
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
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator, "NoSeed", "NOSEED")
        });
        (tokenAddr, pairAddr) = bonding.launch(params, creator);
        vm.stopPrank();
    }

    /// @dev Roll past `LAUNCH_TRADING_DELAY_BLOCKS` so direct-Bonding tests
    ///      can buy without the seed-buy transient bypass.
    function _skipLaunchDelay() internal {
        vm.roll(block.number + bonding.LAUNCH_TRADING_DELAY_BLOCKS() + 1);
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
        assertEq(factory.pairCount(), 1);
    }

    function test_launch_setsTokenInfo() public {
        (address tokenAddr,) = _launchToken();

        Bonding.TokenInfo memory info = bonding.getTokenInfo(tokenAddr);

        assertEq(info.creator, creator);
        assertEq(info.ltAddress, address(lt));
        assertTrue(info.lifecycle == Bonding.Lifecycle.Curve);
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
        uint256 k = pair.k();

        assertTrue(reserveToken > 0, "Token reserve should be > 0");
        assertTrue(reserveAsset > 0, "Asset reserve should be > 0 (virtual)");
        // k should be close to the product (not exact due to seed buy adjusting reserves)
        assertTrue(k > 0, "k should be > 0");

        uint256 realAssetBalance = pair.assetBalance();
        assertTrue(realAssetBalance < reserveAsset, "Real balance < virtual reserve (virtual liquidity)");
    }

    function test_launch_tracksMultipleTokens() public {
        (address first,) = _launchToken();
        vm.warp(block.timestamp + 1);
        (address second,) = _launchToken();
        assertTrue(first != address(0));
        assertTrue(second != address(0));
        assertTrue(first != second);
        assertEq(bonding.getTokenInfo(first).creator, creator);
        assertEq(bonding.getTokenInfo(second).creator, creator);
    }

    function test_launch_emitsEvent() public {
        vm.startPrank(creator);

        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "EventTest",
            ticker: "EVT",
            description: "",
            image: "",
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator, "EventTest", "EVT")
        });

        vm.expectEmit(false, true, false, false);
        emit Bonding.TokenLaunched(address(0), creator, address(lt), "EventTest", "EVT", 0);
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
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator, name_, ticker_)
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
        (address tokenAddr,) = bonding.launch(params, creator);
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
        (address tokenAddr,) = bonding.launch(params, creator);
        vm.stopPrank();
        assertTrue(tokenAddr != address(0));
        assertEq(Token(tokenAddr).symbol(), "AAAAAAAAAA");
    }

    function test_launch_acceptsMinLengthNameAndTicker() public {
        vm.startPrank(creator);
        Bonding.LaunchParams memory params = _launchParamsWithNameTicker("A", "B");
        (address tokenAddr,) = bonding.launch(params, creator);
        vm.stopPrank();
        assertTrue(tokenAddr != address(0));
    }

    // ─── Exchange-Rate Bounds ───────────────────────────────────────────
    //
    // The curve's raised LT reserve peaks at `3 * virtualLtReserve` and is
    // deposited into a HyperSwap V2 pair (uint112 reserves) at graduation.
    // `_deployAndSeed` rejects launches whose `virtualLtReserve` exceeds
    // `type(uint112).max / 4`, so a fitting reserve is guaranteed for the
    // life of the token. `virtualLtReserve = VIRTUAL_LIQUIDITY_USD * 1e18 / rate`.

    function test_launch_revertsWhenExchangeRateTooLow() public {
        uint256 maxVirtualLt = uint256(type(uint112).max) / 4;
        uint256 numerator = bonding.VIRTUAL_LIQUIDITY_USD() * 1e18;
        // Largest rate that still pushes virtualLtReserve over the bound.
        uint256 tooLowRate = numerator / (maxVirtualLt + 1);
        lt.setExchangeRate(tooLowRate);

        vm.startPrank(creator);
        Bonding.LaunchParams memory params = _launchParamsWithNameTicker("LowRate", "LOW");
        vm.expectRevert(Bonding.ExchangeRateTooLow.selector);
        bonding.launch(params, creator);
        vm.stopPrank();
    }

    function test_launch_succeedsAtExchangeRateBoundary() public {
        uint256 maxVirtualLt = uint256(type(uint112).max) / 4;
        uint256 numerator = bonding.VIRTUAL_LIQUIDITY_USD() * 1e18;
        // First passing rate: one tick above the largest rejected rate.
        uint256 okRate = numerator / (maxVirtualLt + 1) + 1;
        lt.setExchangeRate(okRate);

        vm.startPrank(creator);
        Bonding.LaunchParams memory params = _launchParamsWithNameTicker("OkRate", "OK");
        (address tokenAddr,) = bonding.launch(params, creator);
        vm.stopPrank();
        assertTrue(tokenAddr != address(0));
    }

    function test_launch_allowsLowButViableExchangeRate() public {
        lt.setExchangeRate(0.0001 ether); // $0.0001 / LT — far from the bound

        vm.startPrank(creator);
        Bonding.LaunchParams memory params = _launchParamsWithNameTicker("Cheap", "CHEAP");
        (address tokenAddr,) = bonding.launch(params, creator);
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
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator, "Valid", "VLD")
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
        (address tokenAddr,) = bonding.launch(params, creator);
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
        (address tokenAddr,) = bonding.launch(params, creator);
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
        for (uint256 i = 0; i < 3; i++) {
            params.urls[i] = _repeat("A", 512);
        }
        (address tokenAddr,) = bonding.launch(params, creator);
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

    /// @notice A curve sell on an already-graduatable token is rejected so it
    ///         can't drag the raised reserve back below the threshold. The
    ///         user-facing router triggers graduation up front; this guards
    ///         any router that reaches `sell` without doing so.
    function test_sell_revertsWhenGraduatable() public {
        (address tokenAddr,) = _launchToken();
        uint256 tokensOut = _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());

        // LT appreciation flips `canGraduate` true with no further buy.
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        assertTrue(bonding.canGraduate(tokenAddr), "setup: token must be graduatable");

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(curveRouter), tokensOut);
        vm.expectRevert(Bonding.TokenIsGraduating.selector);
        bonding.sell(tokensOut, tokenAddr, 0, trader);
        vm.stopPrank();

        // The rejected sell leaves the token on the curve and still ripe.
        assertTrue(bonding.isTrading(tokenAddr), "token must remain on the curve");
        assertTrue(bonding.canGraduate(tokenAddr), "token must stay graduatable");
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

        assertEq(bonding.getTokenInfo(tokenAddr).creator, trader);
    }

    function test_transferCreator_onlyCreator() public {
        (address tokenAddr,) = _launchToken();

        vm.prank(trader);
        vm.expectRevert(Bonding.NotCreator.selector);
        bonding.transferCreator(tokenAddr, trader);
    }

    /// @dev The takeover path: the outgoing creator never signs, so the owner
    ///      must be able to move the role over their head.
    function test_adminTransferCreator() public {
        (address tokenAddr,) = _launchToken();

        vm.expectEmit(true, true, true, false, address(bonding));
        emit Bonding.CreatorReassigned(tokenAddr, creator, trader);
        bonding.adminTransferCreator(tokenAddr, trader);

        assertEq(bonding.creatorOf(tokenAddr), trader);
    }

    function test_adminTransferCreator_onlyOwner() public {
        (address tokenAddr,) = _launchToken();

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, creator));
        bonding.adminTransferCreator(tokenAddr, trader);
    }

    /// @dev Guards against writing a creator into an unwritten slot, which
    ///      would fabricate a token that passes every `creator != 0`
    ///      existence check.
    function test_adminTransferCreator_unknownToken() public {
        vm.expectRevert(Bonding.TokenNotTrading.selector);
        bonding.adminTransferCreator(address(0xdead), trader);

        assertFalse(bonding.isTrading(address(0xdead)));
    }

    /// @dev Zeroing the creator would invert the `creator != 0` existence
    ///      sentinel and un-launch a live token.
    function test_adminTransferCreator_rejectsZeroAddress() public {
        (address tokenAddr,) = _launchToken();

        vm.expectRevert(Bonding.ZeroAddress.selector);
        bonding.adminTransferCreator(tokenAddr, address(0));

        assertEq(bonding.creatorOf(tokenAddr), creator, "Creator must be untouched");
        assertTrue(bonding.isTrading(tokenAddr), "Token must still be trading");
    }

    function test_adminTransferCreator_rejectsNoOp() public {
        (address tokenAddr,) = _launchToken();

        vm.expectRevert(Bonding.InvalidInput.selector);
        bonding.adminTransferCreator(tokenAddr, creator);
    }

    /// @dev Fees keep accruing after graduation, so a graduated token stays a
    ///      valid takeover target — there is deliberately no lifecycle gate.
    function test_adminTransferCreator_worksAfterGraduation() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        bonding.triggerGraduation(tokenAddr);
        bonding.finalizeGraduation(tokenAddr);
        assertTrue(bonding.isGraduated(tokenAddr), "Token should be graduated");

        bonding.adminTransferCreator(tokenAddr, trader);

        assertEq(bonding.creatorOf(tokenAddr), trader);
    }

    /// @dev The `Graduating` window freezes trading but must not freeze a
    ///      takeover, and must not disturb the cached phase-1 state that
    ///      `finalizeGraduation` depends on.
    function test_adminTransferCreator_duringGraduatingDoesNotBrickPhaseTwo() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        bonding.triggerGraduation(tokenAddr);
        assertTrue(bonding.isGraduating(tokenAddr), "Token should be mid-graduation");

        bonding.adminTransferCreator(tokenAddr, trader);
        assertEq(bonding.creatorOf(tokenAddr), trader);

        bonding.finalizeGraduation(tokenAddr);
        assertTrue(bonding.isGraduated(tokenAddr), "Phase 2 must still complete");
    }

    // ─── Graduation Tests ────────────────────────────────────────────────
    // Note: Full graduation with HyperSwap seeding requires mock UniV2 Router.
    // These tests verify the canGraduate check and pre-graduation state.

    function test_canGraduate_returnsFalseInitially() public {
        (address tokenAddr,) = _launchToken();
        assertFalse(bonding.canGraduate(tokenAddr), "Should not be graduatable initially");
    }

    function test_viewHelpers_returnFalseForUnknownToken() public view {
        address unknown = address(0xdead);
        assertFalse(bonding.isTrading(unknown), "isTrading should be false for unknown");
        assertFalse(bonding.isGraduating(unknown), "isGraduating should be false for unknown");
        assertFalse(bonding.isGraduated(unknown), "isGraduated should be false for unknown");
        assertFalse(bonding.canGraduate(unknown), "canGraduate should be false for unknown");
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

    // ─── triggerGraduation Tests ─────────────────────────────────────────
    // Permissionless phase-1 entry point. Used by the auto-buy keeper to
    // unstick tokens whose `canGraduate` flips to true via LT
    // appreciation alone (no buy in the loop) and which would otherwise
    // require a sub-mint-floor closing buy through `Zap.buy`.

    function test_triggerGraduation_succeedsWhenCanGraduate() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        assertTrue(bonding.canGraduate(tokenAddr));

        // Permissionless caller — no router/owner role required.
        address randomCaller = makeAddr("randomCaller");
        vm.prank(randomCaller);
        bonding.triggerGraduation(tokenAddr);

        assertTrue(bonding.isGraduating(tokenAddr));
        assertFalse(bonding.canGraduate(tokenAddr));
    }

    function test_triggerGraduation_emitsTokenGraduating() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());

        vm.expectEmit(true, false, false, false);
        emit Bonding.TokenGraduating(tokenAddr, 0, 0, 0, 0);
        bonding.triggerGraduation(tokenAddr);
    }

    function test_triggerGraduation_advancesToGraduatedAfterFinalize() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());

        bonding.triggerGraduation(tokenAddr);
        bonding.finalizeGraduation(tokenAddr);

        assertTrue(bonding.isGraduated(tokenAddr));
    }

    function test_triggerGraduation_revertsWhenCanGraduateFalse() public {
        (address tokenAddr,) = _launchToken();
        // Fresh-ish curve; nowhere near the USD threshold.
        assertFalse(bonding.canGraduate(tokenAddr));

        vm.expectRevert(Bonding.NotGraduatable.selector);
        bonding.triggerGraduation(tokenAddr);
    }

    function test_triggerGraduation_revertsWhenAlreadyGraduating() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());

        bonding.triggerGraduation(tokenAddr);

        vm.expectRevert(Bonding.TokenIsGraduating.selector);
        bonding.triggerGraduation(tokenAddr);
    }

    function test_triggerGraduation_revertsWhenAlreadyGraduated() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        // `_buyTokens` finalises inline if the trade flips the lifecycle.
        _buyTokens(tokenAddr, trader2, _ltGraduationTrigger());
        assertTrue(bonding.isGraduated(tokenAddr));

        vm.expectRevert(Bonding.TokenNotTrading.selector);
        bonding.triggerGraduation(tokenAddr);
    }

    function test_triggerGraduation_revertsForUnknownToken() public {
        address unknown = address(0xdead);
        vm.expectRevert(Bonding.TokenNotTrading.selector);
        bonding.triggerGraduation(unknown);
    }

    function test_triggerGraduation_isPermissionless() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());

        // Caller has no router role, no creator privilege, no ownership.
        address rando = makeAddr("rando");
        assertFalse(bonding.isRouter(rando));
        assertTrue(bonding.owner() != rando);

        vm.prank(rando);
        bonding.triggerGraduation(tokenAddr);
        assertTrue(bonding.isGraduating(tokenAddr));
    }

    // ─── previewLtUntilGraduation Tests ──────────────────────────────────
    // Single source of truth for `Zap._executeBuy`'s pre-sizing. Returns
    // `min(supply-leg, USD-leg)` of `canGraduate`, or `0` when the
    // token is already graduatable / not in `Lifecycle.Curve`.

    function test_previewLtUntilGraduation_unknown_returnsZero() public view {
        assertEq(bonding.previewLtUntilGraduation(address(0xdead)), 0);
    }

    function test_previewLtUntilGraduation_graduated_returnsZero() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        // `_buyTokens` finalises inline once `canGraduate` flips true,
        // so no separate `finalizeGraduation` is needed.
        _buyTokens(tokenAddr, trader2, _ltGraduationTrigger());
        assertTrue(bonding.isGraduated(tokenAddr));
        assertEq(bonding.previewLtUntilGraduation(tokenAddr), 0);
    }

    function test_previewLtUntilGraduation_graduating_returnsZero() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        bonding.triggerGraduation(tokenAddr);
        assertTrue(bonding.isGraduating(tokenAddr));
        assertEq(bonding.previewLtUntilGraduation(tokenAddr), 0);
    }

    function test_previewLtUntilGraduation_alreadyGraduatable_returnsZero() public {
        (address tokenAddr,) = _launchToken();
        _buyTokens(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        // LT appreciation flipped `canGraduate` true without a buy in
        // the loop — the only state the keeper picks up.
        assertTrue(bonding.canGraduate(tokenAddr));
        assertEq(bonding.previewLtUntilGraduation(tokenAddr), 0);
    }

    function test_previewLtUntilGraduation_freshCurve_returnsThresholdLeg() public {
        (address tokenAddr,) = _launchToken();
        // At launch with rate = 1, USD-leg ≡ supply-leg (test-suite
        // threshold = `3× virtual`). Verify the cap equals the
        // threshold-needed real-LT raised.
        uint256 cap = bonding.previewLtUntilGraduation(tokenAddr);
        uint256 expectedThresholdRealLt = (bonding.graduationThresholdUsd() * 1e18) / lt.exchangeRate();
        // Account for the seed buy that already raised some real LT.
        address pair = bonding.getTokenInfo(tokenAddr).pair;
        (, uint256 reserveAsset) = IPair(pair).getReserves();
        uint256 virtualLt = IPair(pair).k() / Token(tokenAddr).TOTAL_SUPPLY();
        uint256 alreadyRaised = reserveAsset - virtualLt;
        assertApproxEqAbs(cap, expectedThresholdRealLt - alreadyRaised, 2, "Cap aligns with threshold-needed delta");
    }

    function test_previewLtUntilGraduation_thresholdLegBindsAtElevatedRate() public {
        (address tokenAddr,) = _launchToken();
        // 2× rate halves threshold in LT-units. USD-leg (1.5× virtual)
        // is now well below supply-leg (3× virtual). Verify the cap
        // tracks the USD-leg.
        lt.setExchangeRate(LT_EXCHANGE_RATE * 2);

        uint256 cap = bonding.previewLtUntilGraduation(tokenAddr);

        // USD-leg: ceil(threshold × 1e18 / rate) - alreadyRaised
        uint256 expectedThresholdRealLt =
            (bonding.graduationThresholdUsd() * 1e18 + lt.exchangeRate() - 1) / lt.exchangeRate();
        address pair = bonding.getTokenInfo(tokenAddr).pair;
        (, uint256 reserveAsset) = IPair(pair).getReserves();
        uint256 virtualLt = IPair(pair).k() / Token(tokenAddr).TOTAL_SUPPLY();
        uint256 alreadyRaised = reserveAsset - virtualLt;
        uint256 expectedUsdLeg = expectedThresholdRealLt - alreadyRaised;

        assertEq(cap, expectedUsdLeg, "USD-leg binds at elevated rate");
    }

    function test_previewLtUntilGraduation_consumesIntoSupplyLegAfterRateDrop() public {
        (address tokenAddr,) = _launchToken();
        // Lower the rate so the USD-leg requires more real LT than the
        // supply-leg — flips the binding leg to supply.
        lt.setExchangeRate(LT_EXCHANGE_RATE / 2);

        uint256 cap = bonding.previewLtUntilGraduation(tokenAddr);

        // Supply-leg = LT to drain `realBalance`. Mirrors
        // `Router._computeBuy`'s cap math.
        address pair = bonding.getTokenInfo(tokenAddr).pair;
        IPair p = IPair(pair);
        (uint256 reserveToken, uint256 reserveAsset) = p.getReserves();
        uint256 realBalance = p.tokenBalance();
        uint256 cappedReserveToken = reserveToken - realBalance;
        uint256 cappedReserveAsset = (p.k() + cappedReserveToken - 1) / cappedReserveToken;
        uint256 expectedSupplyLeg = cappedReserveAsset - reserveAsset;

        assertEq(cap, expectedSupplyLeg, "Supply-leg binds at half rate");
    }

    function test_previewLtUntilGraduation_capBindingBuy_graduatesInline() public {
        (address tokenAddr,) = _launchToken();
        lt.setExchangeRate(LT_EXCHANGE_RATE * 2);

        uint256 cap = bonding.previewLtUntilGraduation(tokenAddr);
        assertGt(cap, 0, "Pre-condition: cap is non-zero");

        // Pre-mint exactly `cap` LT and buy through the curve. The
        // contract's post-buy inline trigger should fire `_enterGraduating`.
        address bumper = makeAddr("capBuy");
        lt.mintDirect(bumper, cap);
        if (!bonding.isRouter(bumper)) bonding.addRouter(bumper);
        vm.startPrank(bumper);
        lt.approve(address(curveRouter), cap);
        bonding.buy(cap, tokenAddr, 0, bumper);
        vm.stopPrank();

        assertTrue(bonding.isGraduating(tokenAddr), "Cap-binding buy flips lifecycle to Graduating");
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

    function test_lpReserveConstant() public view {
        // LP_RESERVE = LP_RESERVE_BPS / BPS_DENOM of the fixed 1B per-token supply.
        assertEq(bonding.LP_RESERVE(), 250_000_000 ether, "LP_RESERVE should equal 25% of 1B supply");
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

        uint256 kBefore = pair.k();
        _buyTokens(tokenAddr, trader, _smallBuyLt());
        uint256 kAfter = pair.k();

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

    // ─── Initialize Zero-Address Validation ─────────────────────────────
    //
    // `Bonding.initialize` rejects any zero address among its dependency
    // parameters. A misconfigured deploy would otherwise land in production
    // with `factory` / `router` / `uniswapV2Factory` / `uniswapV2Router` /
    // `lpLock` / token implementation set to zero, bricking core paths
    // with cryptic low-level reverts deep in delegate calls.

    function _bondingInitCall(
        address factory_,
        address router_,
        address uniswapV2Factory_,
        address uniswapV2Router_,
        address lpLock_,
        address tokenImpl_
    ) internal view returns (bytes memory) {
        return abi.encodeCall(
            Bonding.initialize,
            (
                factory_,
                router_,
                uniswapV2Factory_,
                uniswapV2Router_,
                lpLock_,
                tokenImpl_,
                TEST_GRADUATION_THRESHOLD_USD,
                address(bounceGlobalStorage)
            )
        );
    }

    function test_initialize_revertsOnZeroFactory() public {
        Bonding freshImpl = new Bonding();
        bytes memory init = _bondingInitCall(
            address(0),
            address(curveRouter),
            address(hyperswapFactory),
            address(hyperswapRouter),
            address(lpLockContract),
            address(tokenImpl)
        );
        vm.expectRevert(Bonding.ZeroAddress.selector);
        new ERC1967Proxy(address(freshImpl), init);
    }

    function test_initialize_revertsOnZeroRouter() public {
        Bonding freshImpl = new Bonding();
        bytes memory init = _bondingInitCall(
            address(factory),
            address(0),
            address(hyperswapFactory),
            address(hyperswapRouter),
            address(lpLockContract),
            address(tokenImpl)
        );
        vm.expectRevert(Bonding.ZeroAddress.selector);
        new ERC1967Proxy(address(freshImpl), init);
    }

    function test_initialize_revertsOnZeroUniswapV2Factory() public {
        Bonding freshImpl = new Bonding();
        bytes memory init = _bondingInitCall(
            address(factory),
            address(curveRouter),
            address(0),
            address(hyperswapRouter),
            address(lpLockContract),
            address(tokenImpl)
        );
        vm.expectRevert(Bonding.ZeroAddress.selector);
        new ERC1967Proxy(address(freshImpl), init);
    }

    function test_initialize_revertsOnZeroUniswapV2Router() public {
        Bonding freshImpl = new Bonding();
        bytes memory init = _bondingInitCall(
            address(factory),
            address(curveRouter),
            address(hyperswapFactory),
            address(0),
            address(lpLockContract),
            address(tokenImpl)
        );
        vm.expectRevert(Bonding.ZeroAddress.selector);
        new ERC1967Proxy(address(freshImpl), init);
    }

    function test_initialize_revertsOnZeroLpLock() public {
        Bonding freshImpl = new Bonding();
        bytes memory init = _bondingInitCall(
            address(factory),
            address(curveRouter),
            address(hyperswapFactory),
            address(hyperswapRouter),
            address(0),
            address(tokenImpl)
        );
        vm.expectRevert(Bonding.ZeroAddress.selector);
        new ERC1967Proxy(address(freshImpl), init);
    }

    function test_initialize_revertsOnZeroTokenImplementation() public {
        Bonding freshImpl = new Bonding();
        bytes memory init = _bondingInitCall(
            address(factory),
            address(curveRouter),
            address(hyperswapFactory),
            address(hyperswapRouter),
            address(lpLockContract),
            address(0)
        );
        vm.expectRevert(Bonding.ZeroAddress.selector);
        new ERC1967Proxy(address(freshImpl), init);
    }

    function test_initialize_revertsOnZeroBounceGlobalStorage() public {
        Bonding freshImpl = new Bonding();
        bytes memory init = abi.encodeCall(
            Bonding.initialize,
            (
                address(factory),
                address(curveRouter),
                address(hyperswapFactory),
                address(hyperswapRouter),
                address(lpLockContract),
                address(tokenImpl),
                TEST_GRADUATION_THRESHOLD_USD,
                address(0)
            )
        );
        vm.expectRevert(Bonding.ZeroAddress.selector);
        new ERC1967Proxy(address(freshImpl), init);
    }

    function test_initialize_persistsUniswapV2Router() public view {
        // `uniswapV2Router` is wired at `initialize` time and immutable
        // thereafter (no setter, no upgrade-without-reinit path).
        // Sanity-check the live wiring matches `DeployHelper`.
        assertEq(bonding.uniswapV2Router(), address(hyperswapRouter));
    }

    // ─── HyperSwap config immutability ──────────────────────────────────
    //
    // `uniswapV2Factory`, `uniswapV2Router`, and `lpLock` are set once at
    // `initialize` and have no live setter — see the natspec on those
    // storage slots in `Bonding.sol`. Migrating to a different HyperSwap
    // fork or LP lock requires a UUPS upgrade so the change is visible
    // on-chain ahead of time and cannot brick or silently reroute any
    // in-flight graduation.

    function test_uniswapV2Factory_hasNoLiveSetter() public {
        // `setUniswapV2(address,address)` selector — must not exist on the proxy.
        // Use a normal `call` from the owner with non-zero args: `staticcall`
        // would also revert against a state-mutating setter and could mask its
        // reintroduction. A missing selector hits the empty fallback and
        // returns no revert data; a reintroduced setter would revert with a
        // typed error or a 4-byte selector, which we detect via revertData.
        bytes4 setUniswapV2Selector = bytes4(keccak256("setUniswapV2(address,address)"));
        (bool ok, bytes memory revertData) =
            address(bonding).call(abi.encodeWithSelector(setUniswapV2Selector, address(1), address(2)));
        assertFalse(ok, "setUniswapV2 must not exist on Bonding");
        assertEq(revertData.length, 0, "setUniswapV2 reverted with data -- selector still routes");
    }

    function test_uniswapV2Router_hasNoLiveSetter() public {
        // Mirror of the `setUniswapV2` immutability check for the router
        // slot. The earlier #343 design exposed `setUniswapV2Router` as a
        // one-shot post-deploy hook; that's been folded into `initialize`,
        // and re-introducing the setter would be a regression of the
        // immutability contract documented on the storage struct field.
        bytes4 setUniswapV2RouterSelector = bytes4(keccak256("setUniswapV2Router(address)"));
        (bool ok, bytes memory revertData) =
            address(bonding).call(abi.encodeWithSelector(setUniswapV2RouterSelector, address(1)));
        assertFalse(ok, "setUniswapV2Router must not exist on Bonding");
        assertEq(revertData.length, 0, "setUniswapV2Router reverted with data -- selector still routes");
    }

    // ─── Graduation Threshold Initialisation Tests ───────────────────────
    //
    // `graduationThresholdUsd` is set once at `initialize` time and has no
    // setter — see `Bonding.sol` natspec. The only on-chain validation is
    // the `>= VIRTUAL_LIQUIDITY_USD` floor enforced in `initialize`, so a
    // freshly-deployed proxy can never be pre-graduated by a too-low
    // deploy-time value.

    function test_initialize_persistsGraduationThresholdUsd() public view {
        assertEq(bonding.graduationThresholdUsd(), TEST_GRADUATION_THRESHOLD_USD);
    }

    function test_initialize_revertsOnThresholdBelowVirtualLiquidity() public {
        Bonding freshImpl = new Bonding();
        bytes memory init = abi.encodeCall(
            Bonding.initialize,
            (
                address(factory),
                address(curveRouter),
                address(hyperswapFactory),
                address(hyperswapRouter),
                address(lpLockContract),
                address(tokenImpl),
                bonding.VIRTUAL_LIQUIDITY_USD() - 1,
                address(bounceGlobalStorage)
            )
        );
        vm.expectRevert(Bonding.InvalidInput.selector);
        new ERC1967Proxy(address(freshImpl), init);
    }

    function test_initialize_acceptsThresholdAtVirtualLiquidityFloor() public {
        Bonding freshImpl = new Bonding();
        uint256 floor = bonding.VIRTUAL_LIQUIDITY_USD();
        bytes memory init = abi.encodeCall(
            Bonding.initialize,
            (
                address(factory),
                address(curveRouter),
                address(hyperswapFactory),
                address(hyperswapRouter),
                address(lpLockContract),
                address(tokenImpl),
                floor,
                address(bounceGlobalStorage)
            )
        );
        Bonding fresh = Bonding(address(new ERC1967Proxy(address(freshImpl), init)));
        assertEq(fresh.graduationThresholdUsd(), floor);
    }
}
