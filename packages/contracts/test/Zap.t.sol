// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Bonding} from "../src/Bonding.sol";
import {Token} from "../src/Token.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {Zap} from "../src/Zap.sol";
import {IBounceLeveragedToken} from "../src/interfaces/IBounceLeveragedToken.sol";
import {IPair} from "../src/interfaces/IPair.sol";
import {MockLeveragedToken} from "./mocks/MockLeveragedToken.sol";
import {DeployHelper} from "./DeployHelper.sol";

contract ZapV2 is Zap {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract ZapTest is DeployHelper {
    Zap public zap;

    address public referrer = makeAddr("referrer");

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
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    /// @dev Default-seed launch helper. Seed buys are now mandatory via
    ///      `Zap.MIN_SEED_USDC`; a `seedUsdc == 0` argument is interpreted
    ///      as "use the default seed sized for these mock-USDC decimals"
    ///      so existing call sites that didn't care about the seed amount
    ///      keep working without churn. Auto-rolls past the
    ///      `Bonding.LAUNCH_TRADING_DELAY_BLOCKS` gate so post-launch
    ///      buys land — anti-snipe-specific tests bypass this helper and
    ///      drive `zap.createToken` directly so they can observe the gate.
    function _createToken(
        uint256 seedUsdc
    ) internal returns (address tokenAddr) {
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "TestToken",
            ticker: "TEST",
            description: "A test token",
            image: "https://img.test/logo.png",
            urls: ["https://x.com/test", "", "https://test.com"],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator, "TestToken", "TEST")
        });

        uint256 amount = seedUsdc == 0 ? _defaultSeedUsdc() : seedUsdc;
        usdc.mint(creator, amount);
        vm.startPrank(creator);
        usdc.approve(address(zap), amount);
        tokenAddr = zap.createToken(params, amount);
        vm.stopPrank();

        _skipLaunchDelay();
    }

    function _skipLaunchDelay() internal {
        vm.roll(block.number + bonding.LAUNCH_TRADING_DELAY_BLOCKS() + 1);
    }

    function _buyViaRouter(
        address tokenAddr,
        address buyer,
        uint256 usdcAmount
    ) internal returns (uint256 tokensOut) {
        usdc.mint(buyer, usdcAmount);
        vm.startPrank(buyer);
        usdc.approve(address(zap), usdcAmount);
        tokensOut = zap.buy(tokenAddr, usdcAmount, 0, address(0));
        vm.stopPrank();

        // Mirror the production keeper: if the buy crossed the threshold, drive
        // phase 2 inline. Tests that want to observe the `Graduating` window
        // explicitly can drive the buy + finalize themselves.
        if (bonding.isGraduating(tokenAddr)) bonding.finalizeGraduation(tokenAddr);
    }

    /// @dev Drives a token through phase-1 + phase-2 graduation using
    ///      USD-sized stages so it stays valid as the threshold/virtual
    ///      liquidity dial moves. `_buyViaRouter` auto-finalizes whenever a
    ///      buy crosses the graduation trigger.
    function _graduateToken(
        address tokenAddr
    ) internal {
        _buyViaRouter(tokenAddr, trader, _usdcStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        _buyViaRouter(tokenAddr, trader2, _usdcGraduationTrigger());
        assertTrue(bonding.isGraduated(tokenAddr), "Token should be graduated");
    }

    // ─── createToken Tests ───────────────────────────────────────────────

    function test_createToken_landsLifecycleCurve() public {
        address tokenAddr = _createToken(_defaultSeedUsdc());
        assertTrue(tokenAddr != address(0));

        Bonding.TokenInfo memory info = bonding.getTokenInfo(tokenAddr);
        assertEq(info.creator, creator);
        assertTrue(info.lifecycle == Bonding.Lifecycle.Curve);
    }

    function test_createToken_withSeedBuy() public {
        address tokenAddr = _createToken(_defaultSeedUsdc());
        assertTrue(tokenAddr != address(0));

        uint256 creatorBalance = Token(tokenAddr).balanceOf(creator);
        assertTrue(creatorBalance > 0, "Creator should have tokens from seed buy");
    }

    function test_createToken_emitsTokenCreated() public {
        uint256 seedUsdc = _defaultSeedUsdc();
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "EventToken",
            ticker: "EVT",
            description: "",
            image: "",
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator, "EventToken", "EVT")
        });

        usdc.mint(creator, seedUsdc);
        vm.startPrank(creator);
        usdc.approve(address(zap), seedUsdc);
        vm.expectEmit(false, true, false, false);
        emit Zap.TokenCreated(address(0), creator, address(lt));
        zap.createToken(params, seedUsdc);
        vm.stopPrank();
    }

    function test_createToken_revertsZeroLt() public {
        // Pre-resolve the seed amount before the prank — `_defaultSeedUsdc`
        // makes an external call into Bonding, which would otherwise consume
        // the single prank we want sitting on `zap.createToken`.
        uint256 seed = _defaultSeedUsdc();

        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "Bad",
            ticker: "BAD",
            description: "",
            image: "",
            urls: ["", "", ""],
            ltAddress: address(0),
            salt: _mineVanitySalt(creator, "Bad", "BAD")
        });

        vm.prank(creator);
        vm.expectRevert(Zap.InvalidInput.selector);
        zap.createToken(params, seed);
    }

    function test_createToken_revertsBelowMinSeed() public {
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "TooSmall",
            ticker: "TS",
            description: "",
            image: "",
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator, "TooSmall", "TS")
        });

        // `MIN_SEED_USDC = 20e6` (real USDC, 6dp). `1` is well below that
        // even on the mock 18-dp USDC tests use, so this exercises the
        // anti-snipe seed-buy floor without depending on USDC decimals.
        vm.prank(creator);
        vm.expectRevert(Zap.BelowMinSeed.selector);
        zap.createToken(params, 1);
    }

    function test_createToken_revertsZeroSeed() public {
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "ZeroSeed",
            ticker: "ZS",
            description: "",
            image: "",
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator, "ZeroSeed", "ZS")
        });

        vm.prank(creator);
        vm.expectRevert(Zap.BelowMinSeed.selector);
        zap.createToken(params, 0);
    }

    // ─── Anti-snipe Tests ────────────────────────────────────────────────

    /// @dev Drives `zap.createToken` directly (bypassing `_createToken`
    ///      which auto-rolls past the delay) so the launch-delay window is
    ///      observable. Returns the freshly-launched token at its true
    ///      `launchBlock` so tests can roll forward as needed.
    function _createTokenAtCurrentBlock() internal returns (address tokenAddr) {
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "AntiSnipe",
            ticker: "AS",
            description: "",
            image: "",
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator, "AntiSnipe", "AS")
        });
        uint256 amount = _defaultSeedUsdc();
        usdc.mint(creator, amount);
        vm.startPrank(creator);
        usdc.approve(address(zap), amount);
        tokenAddr = zap.createToken(params, amount);
        vm.stopPrank();
    }

    function test_buy_blockedDuringLaunchDelay() public {
        address tokenAddr = _createTokenAtCurrentBlock();

        // Same block as launch — only the in-tx seed buy from `createToken`
        // is allowed, and it has already consumed the transient bypass. A
        // separate-tx buy here mirrors a same-block sniper bundle.
        uint256 buyAmount = _smallBuyUsdc();
        usdc.mint(trader, buyAmount);
        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);
        vm.expectRevert(Bonding.TradingNotOpen.selector);
        zap.buy(tokenAddr, buyAmount, 0, address(0));
        vm.stopPrank();
    }

    function test_buy_blockedAtLastDelayBlock() public {
        address tokenAddr = _createTokenAtCurrentBlock();
        // `LAUNCH_TRADING_DELAY_BLOCKS = 3` → trading opens at
        // `launchBlock + 4`. At `launchBlock + 3` (the last gated block) a
        // buy must still revert.
        vm.roll(block.number + bonding.LAUNCH_TRADING_DELAY_BLOCKS());

        uint256 buyAmount = _smallBuyUsdc();
        usdc.mint(trader, buyAmount);
        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);
        vm.expectRevert(Bonding.TradingNotOpen.selector);
        zap.buy(tokenAddr, buyAmount, 0, address(0));
        vm.stopPrank();
    }

    function test_buy_succeedsOnceDelayElapses() public {
        address tokenAddr = _createTokenAtCurrentBlock();
        vm.roll(block.number + bonding.LAUNCH_TRADING_DELAY_BLOCKS() + 1);

        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, _smallBuyUsdc());
        assertTrue(tokensOut > 0, "Should receive tokens after delay elapses");
    }

    function test_launchBlock_recorded() public {
        uint256 expected = block.number;
        address tokenAddr = _createTokenAtCurrentBlock();
        assertEq(uint256(bonding.launchBlock(tokenAddr)), expected, "launchBlock should equal block.number at launch");
    }

    // ─── Buy Tests (Curve) ───────────────────────────────────────────────

    function test_buy_curvePath_givesTokens() public {
        address tokenAddr = _createToken(0);
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, _smallBuyUsdc());

        assertEq(Token(tokenAddr).balanceOf(trader), tokensOut);
        assertTrue(tokensOut > 0);
    }

    function test_buy_curvePath_deductsUsdc() public {
        address tokenAddr = _createToken(0);
        uint256 buyAmount = _smallBuyUsdc();
        usdc.mint(trader, buyAmount);

        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);
        zap.buy(tokenAddr, buyAmount, 0, address(0));
        vm.stopPrank();

        assertEq(usdc.balanceOf(trader), 0, "All USDC should be spent");
    }

    function test_buy_emitsBuyEvent() public {
        address tokenAddr = _createToken(0);
        uint256 buyAmount = _smallBuyUsdc();
        usdc.mint(trader, buyAmount);

        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);

        vm.expectEmit(true, true, false, false);
        emit Zap.Buy(tokenAddr, trader, buyAmount, 0);
        zap.buy(tokenAddr, buyAmount, 0, address(0));
        vm.stopPrank();
    }

    function test_buy_revertsOnZeroAmount() public {
        address tokenAddr = _createToken(0);

        vm.prank(trader);
        vm.expectRevert(Zap.InvalidInput.selector);
        zap.buy(tokenAddr, 0, 0, address(0));
    }

    function test_buy_revertsOnZeroTokenAddress() public {
        uint256 buyAmount = _smallBuyUsdc();
        usdc.mint(trader, buyAmount);

        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);
        vm.expectRevert(Zap.InvalidInput.selector);
        zap.buy(address(0), buyAmount, 0, address(0));
        vm.stopPrank();

        assertEq(usdc.balanceOf(trader), buyAmount, "USDC should not have moved");
    }

    function test_buy_revertsOnUnknownToken() public {
        address bogus = makeAddr("not-a-launched-token");
        uint256 buyAmount = _smallBuyUsdc();
        usdc.mint(trader, buyAmount);

        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);
        vm.expectRevert(Zap.TokenNotTrading.selector);
        zap.buy(bogus, buyAmount, 0, address(0));
        vm.stopPrank();

        assertEq(usdc.balanceOf(trader), buyAmount, "USDC should not have moved");
    }

    function test_buy_revertsBelowMinAmount() public {
        address tokenAddr = _createToken(0);

        // Mock USDC is 18-dp, so MIN_USDC_AMOUNT (10e6) sits in the
        // sub-cent range for the test token. Anything below 10e6 wei
        // triggers the on-chain pre-check.
        uint256 belowMin = zap.MIN_USDC_AMOUNT() - 1;

        vm.prank(trader);
        vm.expectRevert(Zap.BelowMinAmount.selector);
        zap.buy(tokenAddr, belowMin, 0, address(0));
    }

    /// @dev Regression for the post-fee floor leak. `_buyInternal` checks the
    ///      gross `usdcAmount` against `MIN_USDC_AMOUNT`, but the LT mint
    ///      consumes `netUsdc = usdcAmount − feeOnGross`. With `buyFeeBps = 50`
    ///      a gross of `10e6` yields `netUsdc = 9_950_000 < MIN_USDC_AMOUNT`,
    ///      so without the post-fee guard the LT reverts with the undecodable
    ///      `0x05eb05ac` selector instead of `BelowMinAmount`.
    function test_buy_revertsInPostFeeDirtyBand() public {
        address tokenAddr = _createToken(0);
        uint256 dirtyBandInput = zap.MIN_USDC_AMOUNT();
        usdc.mint(trader, dirtyBandInput);

        vm.startPrank(trader);
        usdc.approve(address(zap), dirtyBandInput);
        vm.expectRevert(Zap.BelowMinAmount.selector);
        zap.buy(tokenAddr, dirtyBandInput, 0, address(0));
        vm.stopPrank();

        assertEq(usdc.balanceOf(trader), dirtyBandInput, "USDC should not have moved");
    }

    function test_buy_revertsOnSlippage() public {
        address tokenAddr = _createToken(0);
        uint256 buyAmount = _smallBuyUsdc();
        usdc.mint(trader, buyAmount);

        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);
        vm.expectRevert(Zap.SlippageExceeded.selector);
        zap.buy(tokenAddr, buyAmount, type(uint256).max, address(0));
        vm.stopPrank();
    }

    // ─── Referral Tests ──────────────────────────────────────────────────

    function test_buy_emitsReferralEvent() public {
        address tokenAddr = _createToken(0);
        uint256 buyAmount = _smallBuyUsdc();
        usdc.mint(trader, buyAmount);

        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);

        vm.expectEmit(true, true, true, true);
        emit Zap.Referred(tokenAddr, trader, referrer, buyAmount);
        zap.buy(tokenAddr, buyAmount, 0, referrer);
        vm.stopPrank();
    }

    function test_buy_noReferralEventForZeroAddress() public {
        address tokenAddr = _createToken(0);
        uint256 buyAmount = _smallBuyUsdc();
        usdc.mint(trader, buyAmount);

        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);

        vm.recordLogs();
        zap.buy(tokenAddr, buyAmount, 0, address(0));
        vm.stopPrank();

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 referredSig = keccak256("Referred(address,address,address,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != referredSig, "Should not emit Referred for zero referrer");
        }
    }

    function test_buy_noReferralForSelfReferral() public {
        address tokenAddr = _createToken(0);
        uint256 buyAmount = _smallBuyUsdc();
        usdc.mint(trader, buyAmount);

        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);

        vm.recordLogs();
        zap.buy(tokenAddr, buyAmount, 0, trader);
        vm.stopPrank();

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 referredSig = keccak256("Referred(address,address,address,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != referredSig, "Should not emit Referred for self-referral");
        }
    }

    // ─── Sell Tests (Curve) ──────────────────────────────────────────────

    function test_sell_curvePath_returnsUsdc() public {
        address tokenAddr = _createToken(0);
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, _smallBuyUsdc());

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(zap), tokensOut);
        uint256 usdcOut = zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();

        assertTrue(usdcOut > 0, "Should receive USDC back");
        assertEq(usdc.balanceOf(trader), usdcOut);
    }

    function test_sell_curvePath_burnsTokens() public {
        address tokenAddr = _createToken(0);
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, _smallBuyUsdc());

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(zap), tokensOut);
        zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();

        assertEq(Token(tokenAddr).balanceOf(trader), 0, "All tokens should be sold");
    }

    function test_sell_emitsSellEvent() public {
        address tokenAddr = _createToken(0);
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, _smallBuyUsdc());

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(zap), tokensOut);

        vm.expectEmit(true, true, false, false);
        emit Zap.Sell(tokenAddr, trader, tokensOut, 0);
        zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();
    }

    function test_sell_revertsOnZeroAmount() public {
        address tokenAddr = _createToken(0);

        vm.prank(trader);
        vm.expectRevert(Zap.InvalidInput.selector);
        zap.sell(tokenAddr, 0, 0);
    }

    function test_sell_revertsOnZeroTokenAddress() public {
        vm.prank(trader);
        vm.expectRevert(Zap.InvalidInput.selector);
        zap.sell(address(0), 1 ether, 0);
    }

    function test_sell_revertsOnUnknownToken() public {
        address bogus = makeAddr("not-a-launched-token");
        vm.prank(trader);
        vm.expectRevert(Zap.TokenNotTrading.selector);
        zap.sell(bogus, 1 ether, 0);
    }

    function test_sell_revertsBelowMinAmount() public {
        address tokenAddr = _createToken(0);
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, _smallBuyUsdc());

        // Crash the LT exchange rate so the curve sell yields LT worth
        // ~zero USDC, well below `MIN_USDC_AMOUNT`. The Zap must catch
        // this before forwarding to `LT.redeem` (which would revert with
        // the cryptic `0x05eb05ac` selector).
        lt.setExchangeRate(1);

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(zap), tokensOut);
        vm.expectRevert(Zap.BelowMinAmount.selector);
        zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();
    }

    /// @dev Regression for issue #313. The sell-side guard compares an
    ///      18-dp gross USD estimate to the 6-dp `MIN_USDC_AMOUNT`, so it
    ///      must normalise scales before comparing. Without normalisation,
    ///      sells whose 18-dp estimate sits between `1e7` (the raw
    ///      `MIN_USDC_AMOUNT` literal) and `1e19` ($10 in 18dp) bypass the
    ///      guard on mainnet, and the LT then reverts with the undecodable
    ///      `0x05eb05ac` selector instead.
    function test_sell_belowMinAmount_normalisesDecimalScale() public {
        address tokenAddr = _createToken(0);
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, _smallBuyUsdc());

        // Sell a tiny slice (~0.1% of holdings). At default exchangeRate
        // (1e18 = $1/LT), this yields well under $10 worth of LT. With
        // 18-dp mock USDC, `grossUsdcEstimate` lands in the dead zone the
        // un-normalised guard misses (>> 1e7, but < 1e19). The fix divides
        // by 1e12 first, so the sub-`$10` sell is rejected up front.
        uint256 sellAmount = tokensOut / 1000;

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(zap), sellAmount);
        vm.expectRevert(Zap.BelowMinAmount.selector);
        zap.sell(tokenAddr, sellAmount, 0);
        vm.stopPrank();
    }

    /// @dev The cap-binding buy must not round-trip leftover LT through
    ///      `redeem`. With `LT.redeem` mocked to revert, the graduating
    ///      buy must still succeed.
    function test_buy_capPath_doesNotInvokeLTRedeem() public {
        address tokenAddr = _createToken(0);

        uint256 buyAmount = bonding.graduationThresholdUsd() * 2;
        usdc.mint(trader, buyAmount);

        vm.mockCallRevert(address(lt), abi.encodeWithSelector(IBounceLeveragedToken.redeem.selector), "");

        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);
        zap.buy(tokenAddr, buyAmount, 0, address(0));
        vm.stopPrank();

        // Sub-wei rounding residue from `_computeBuy`'s round-up of
        // `amountInUsed` is now refunded to `msg.sender` rather than
        // sitting in the Zap. Same dust either way — well below the LT
        // mint/redeem floor — and this matches the production refund
        // path for the floor-bump branch.
        assertLt(lt.balanceOf(trader), 1e6, "Trader LT residue must be dust");
        assertLt(lt.balanceOf(address(zap)), 1e6, "Zap LT residue must be dust");
        assertTrue(bonding.isGraduated(tokenAddr) || bonding.isGraduating(tokenAddr));
    }

    function test_buy_capPath_refundsUnusedUsdcDirectly() public {
        address tokenAddr = _createToken(0);

        uint256 buyAmount = bonding.graduationThresholdUsd() * 2;
        usdc.mint(trader, buyAmount);
        uint256 traderUsdcBefore = usdc.balanceOf(trader);

        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);
        zap.buy(tokenAddr, buyAmount, 0, address(0));
        vm.stopPrank();

        uint256 usdcSpent = traderUsdcBefore - usdc.balanceOf(trader);
        assertLt(usdcSpent, buyAmount, "Cap-binding buy must refund unused USDC");
        assertGt(usdc.balanceOf(trader), 0, "Trader must hold the refunded USDC");
    }

    function test_buy_nonCapPath_spendsFullUsdc() public {
        address tokenAddr = _createToken(0);
        uint256 buyAmount = _smallBuyUsdc();
        usdc.mint(trader, buyAmount);

        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);
        zap.buy(tokenAddr, buyAmount, 0, address(0));
        vm.stopPrank();

        assertEq(usdc.balanceOf(trader), 0, "Non-cap buy should spend full USDC");
    }

    // ─── Floor-bump tests (structural-stuck case) ────────────────────────
    // When LT appreciation pushes a near-sellout curve past the USD
    // graduation threshold, the next cap-binding buy can size a sub-
    // `MIN_USDC_AMOUNT` LT mint. BounceTech LTs reject such mints with
    // `BelowMinTransactionSize` (selector `0x05eb05ac`). Without the
    // Zap floor-bump these tokens would be permanently un-graduatable
    // via `Zap.buy`. The fix bumps `baseToConvert` up to
    // `MIN_USDC_AMOUNT` and refunds the LT overshoot to `msg.sender`.

    /// @dev Drains the curve via direct `bonding.buy` calls (bypassing
    ///      Zap, fees, and the LT mint floor) to set up a tightly-capped
    ///      closing-buy state. Uses `mintDirect` so it works regardless
    ///      of any configured `minTransactionSize` on the mock LT.
    function _drainCurveDirectly(
        address tokenAddr,
        uint256 ltAmount
    ) internal {
        address drainer = makeAddr("curveDrainer");
        lt.mintDirect(drainer, ltAmount);
        if (!bonding.isRouter(drainer)) bonding.addRouter(drainer);
        vm.startPrank(drainer);
        lt.approve(address(curveRouter), ltAmount);
        bonding.buy(ltAmount, tokenAddr, 0, drainer);
        vm.stopPrank();
    }

    /// @dev Computes the LT amount needed to push the pair's `reserveAsset`
    ///      to within `headroomWei` of the overflow cap (i.e. the next
    ///      cap-binding buy will size `amountInUsed = headroomWei`).
    function _drainAmountForCapHeadroom(
        address tokenAddr,
        uint256 headroomWei
    ) internal view returns (uint256) {
        address pairAddr = bonding.getTokenInfo(tokenAddr).pair;
        IPair pair = IPair(pairAddr);
        (uint256 reserveToken, uint256 reserveAsset) = pair.getReserves();
        uint256 realBalance = pair.tokenBalance();
        uint256 cappedReserveToken = reserveToken - realBalance;
        uint256 capCeiling = (pair.k() + cappedReserveToken - 1) / cappedReserveToken;
        return capCeiling - reserveAsset - headroomWei;
    }

    function test_buy_capPath_floorBump_succeeds() public {
        address tokenAddr = _createToken(0);

        // Drain the curve to leave a tiny gap (5e6 wei LT) below the
        // overflow cap, so the next cap-binding buy sizes `amountInUsed
        // = 5e6 wei`. With rate `1` and the floor at `MIN_USDC_AMOUNT
        // = 10e6` wei, the cap-implied `baseToConvert = 5e6` wei is
        // half the floor — squarely in the structural-stuck band.
        uint256 drainHeadroom = 5e6;
        uint256 drainAmount = _drainAmountForCapHeadroom(tokenAddr, drainHeadroom);
        _drainCurveDirectly(tokenAddr, drainAmount);

        // Pump the rate so `canGraduate` flips true via the USD trigger
        // without an additional buy. 10% bump puts the LT raised
        // comfortably over the threshold.
        lt.setExchangeRate((LT_EXCHANGE_RATE * 11) / 10);
        assertTrue(bonding.canGraduate(tokenAddr), "Curve should be graduatable post rate pump");

        // Activate the BounceTech-style mint floor that mirrors
        // `Zap.MIN_USDC_AMOUNT`. Without the floor-bump, the closing buy
        // would call `lt.mint(baseToConvert < MIN_USDC_AMOUNT)` and
        // revert with `BelowMinTransactionSize`.
        lt.setMinTransactionSize(zap.MIN_USDC_AMOUNT());

        uint256 buyAmount = bonding.graduationThresholdUsd() * 2;
        usdc.mint(trader, buyAmount);
        uint256 traderLtBefore = lt.balanceOf(trader);

        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);
        uint256 tokensOut = zap.buy(tokenAddr, buyAmount, 0, address(0));
        vm.stopPrank();

        // Buy completed instead of reverting — the floor-bump branch
        // bypassed the BounceTech mint floor.
        assertGt(tokensOut, 0, "Closing buy should consume the dust supply");
        assertGt(lt.balanceOf(trader) - traderLtBefore, 0, "Floor-bump LT excess must refund to trader");
        assertTrue(
            bonding.isGraduating(tokenAddr) || bonding.isGraduated(tokenAddr), "Closing buy should arm graduation"
        );
    }

    function test_buy_capPath_floorBump_refundsLtToCaller() public {
        address tokenAddr = _createToken(0);

        // Same drain as the success test, but verify the LT excess
        // matches `ltMinted - amountInUsed`. With base = MIN_USDC_AMOUNT
        // and rate `1.1`, ltMinted = MIN_USDC_AMOUNT * 1e18 / 1.1e18 ≈
        // 9.09e6 wei; amountInUsed = 5e6 wei; ltExcess ≈ 4.09e6 wei.
        uint256 drainHeadroom = 5e6;
        _drainCurveDirectly(tokenAddr, _drainAmountForCapHeadroom(tokenAddr, drainHeadroom));

        uint256 newRate = (LT_EXCHANGE_RATE * 11) / 10;
        lt.setExchangeRate(newRate);
        lt.setMinTransactionSize(zap.MIN_USDC_AMOUNT());

        uint256 buyAmount = bonding.graduationThresholdUsd() * 2;
        usdc.mint(trader, buyAmount);
        uint256 traderLtBefore = lt.balanceOf(trader);

        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);
        zap.buy(tokenAddr, buyAmount, 0, address(0));
        vm.stopPrank();

        uint256 ltMinted = (zap.MIN_USDC_AMOUNT() * 1e18) / newRate;
        uint256 ltExcessExpected = ltMinted - drainHeadroom;
        assertApproxEqAbs(lt.balanceOf(trader) - traderLtBefore, ltExcessExpected, 1, "LT excess refund");
    }

    function test_buy_capPath_floorBump_proratesFee() public {
        address tokenAddr = _createToken(0);

        uint256 drainHeadroom = 5e6;
        _drainCurveDirectly(tokenAddr, _drainAmountForCapHeadroom(tokenAddr, drainHeadroom));

        lt.setExchangeRate((LT_EXCHANGE_RATE * 11) / 10);
        lt.setMinTransactionSize(zap.MIN_USDC_AMOUNT());

        uint256 buyAmount = bonding.graduationThresholdUsd() * 2;
        usdc.mint(trader, buyAmount);
        uint256 vaultBefore = usdc.balanceOf(address(feeVault));

        vm.startPrank(trader);
        usdc.approve(address(zap), buyAmount);
        zap.buy(tokenAddr, buyAmount, 0, address(0));
        vm.stopPrank();

        // Floor-bump branch overshoots the mint past what the curve
        // consumes; fee is prorated against LT actually consumed
        // (sub-MIN_USDC_AMOUNT here), not against the minted amount.
        // `feeOnGross` would be (buyAmount * 50) / 10000 ≈ 6e18;
        // actualFee on a few-wei curve consumption is a tiny fraction
        // of that.
        uint256 feeOnGross = (buyAmount * zap.buyFeeBps()) / zap.BPS_DENOM();
        uint256 actualFee = usdc.balanceOf(address(feeVault)) - vaultBefore;
        assertLt(actualFee, feeOnGross, "Fee must be prorated below the gross fee");
        assertGt(actualFee, 0, "Some fee should still accrue from the dust consumption");
    }

    // ─── Round Trip Tests ────────────────────────────────────────────────

    function test_roundTrip_traderLosesToFees() public {
        address tokenAddr = _createToken(0);
        uint256 usdcIn = _smallBuyUsdc();
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, usdcIn);

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(zap), tokensOut);
        uint256 usdcOut = zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();

        assertTrue(usdcOut < usdcIn, "Round trip should cost fees");
    }

    // ─── Post-Graduation Buy/Sell Tests ──────────────────────────────────

    function test_buy_postGrad_routesThroughHyperswap() public {
        address tokenAddr = _createToken(0);
        _graduateToken(tokenAddr);

        uint256 tokensOut = _buyViaRouter(tokenAddr, makeAddr("postGradBuyer"), _smallBuyUsdc());
        assertTrue(tokensOut > 0, "Post-grad buy should return tokens");
    }

    function test_sell_postGrad_routesThroughHyperswap() public {
        address tokenAddr = _createToken(0);
        _graduateToken(tokenAddr);

        address seller = makeAddr("postGradSeller");
        uint256 tokensOut = _buyViaRouter(tokenAddr, seller, _smallBuyUsdc());

        vm.startPrank(seller);
        Token(tokenAddr).approve(address(zap), tokensOut);
        uint256 usdcOut = zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();

        assertTrue(usdcOut > 0, "Post-grad sell should return USDC");
    }

    // ─── Admin Tests ─────────────────────────────────────────────────────

    function test_setBonding_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        zap.setBonding(address(1));
    }

    function test_setBonding_updatesValue() public {
        Bonding freshBonding = _deployFreshBonding();
        freshBonding.addRouter(address(zap));

        zap.setBonding(address(freshBonding));
        assertEq(address(zap.bonding()), address(freshBonding));
    }

    function test_setBonding_revertsZeroAddress() public {
        vm.expectRevert(Zap.ZeroAddress.selector);
        zap.setBonding(address(0));
    }

    function test_setBonding_revertsIfZapNotRouter() public {
        Bonding freshBonding = _deployFreshBonding();

        vm.expectRevert(Zap.BondingNotConfigured.selector);
        zap.setBonding(address(freshBonding));
    }

    function _deployFreshBonding() internal returns (Bonding) {
        Bonding bondingImpl = new Bonding();
        bytes memory bondingInit = abi.encodeCall(
            Bonding.initialize,
            (
                address(factory),
                address(curveRouter),
                address(hyperswapFactory),
                address(hyperswapRouter),
                address(lpLockContract),
                address(tokenImpl),
                TEST_GRADUATION_THRESHOLD_USD,
                address(bounceGlobalStorage)
            )
        );
        return Bonding(address(new ERC1967Proxy(address(bondingImpl), bondingInit)));
    }

    // `uniswapV2Router` is set once at `initialize` and has no live setter —
    // see the natspec on the storage slot in `Zap.sol`. Migrating to a
    // different HyperSwap fork requires a UUPS upgrade.
    function test_uniswapV2Router_hasNoLiveSetter() public {
        // Owner `call` (not `staticcall`) with non-zero args: a missing
        // selector hits the empty fallback and returns no revert data, while
        // a reintroduced setter would revert with a typed error or a 4-byte
        // selector and trip the `revertData.length` assertion.
        bytes4 selector = bytes4(keccak256("setUniswapV2Router(address)"));
        (bool ok, bytes memory revertData) = address(zap).call(abi.encodeWithSelector(selector, address(1)));
        assertFalse(ok, "setUniswapV2Router must not exist on Zap");
        assertEq(revertData.length, 0, "setUniswapV2Router reverted with data -- selector still routes");
    }

    // ─── UUPS Upgrade ────────────────────────────────────────────────────

    function test_upgrade_ownerCanUpgrade() public {
        ZapV2 newImpl = new ZapV2();
        zap.upgradeToAndCall(address(newImpl), "");
        assertEq(ZapV2(address(zap)).version(), 2);
    }

    function test_upgrade_nonOwnerCannotUpgrade() public {
        ZapV2 newImpl = new ZapV2();

        vm.prank(trader);
        vm.expectRevert();
        zap.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgrade_preservesState() public {
        address tokenAddr = _createToken(0);
        _buyViaRouter(tokenAddr, trader, _smallBuyUsdc());

        ZapV2 newImpl = new ZapV2();
        zap.upgradeToAndCall(address(newImpl), "");

        assertEq(address(zap.bonding()), address(bonding));
        assertEq(address(zap.usdc()), address(usdc));
        assertEq(zap.owner(), owner);
    }

    // ─── Fee Tests ───────────────────────────────────────────────────────

    function test_buy_feeAccruesToVault() public {
        address tokenAddr = _createToken(0);
        // Sized so all USDC clears the curve without refund (else fees would
        // accrue only on the consumed portion and the equality check fails).
        uint256 usdcIn = _smallBuyUsdc();
        // Snapshot **after** `_createToken` so we measure only the
        // trader's buy fee — the mandatory seed buy already accrued its own
        // fee that we don't want to double-count here.
        uint256 vaultBefore = usdc.balanceOf(address(feeVault));
        uint256 creatorBalanceBefore = feeVault.creatorBalance(creator);
        uint256 protocolBalanceBefore = feeVault.protocolBalance();

        _buyViaRouter(tokenAddr, trader, usdcIn);

        uint256 expectedFee = (usdcIn * 50) / 10_000; // 0.5%
        uint256 vaultAfter = usdc.balanceOf(address(feeVault));
        assertEq(vaultAfter - vaultBefore, expectedFee, "FeeVault should hold the buy fee");

        uint256 creatorDelta = feeVault.creatorBalance(creator) - creatorBalanceBefore;
        uint256 expectedCreator = (expectedFee * 2000) / 10_000; // 20% of fee
        assertEq(creatorDelta, expectedCreator, "Creator share should be 20% of fee");
        assertEq(
            feeVault.protocolBalance() - protocolBalanceBefore,
            expectedFee - expectedCreator,
            "Protocol share should be the remainder"
        );
    }

    function test_sell_feeAccruesToVault() public {
        address tokenAddr = _createToken(0);
        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, _smallBuyUsdc());

        uint256 vaultBefore = usdc.balanceOf(address(feeVault));

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(zap), tokensOut);
        uint256 usdcOut = zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();

        // Fee is 0.5% of grossUsdc. usdcOut = grossUsdc - fee → fee = usdcOut * 50 / 9950.
        uint256 fee = (usdcOut * 50) / 9950;
        assertApproxEqAbs(usdc.balanceOf(address(feeVault)) - vaultBefore, fee, 1, "FeeVault should receive sell fee");
    }

    function test_createToken_seedBuy_feeAccruesToCreator() public {
        // Must be small enough that the seed buy consumes all USDC on the
        // curve (no refund), otherwise the fee assertions miscount.
        uint256 seedUsdc = _defaultSeedUsdc();
        address tokenAddr = _createToken(seedUsdc);

        // Creator gets their own creator-share of the seed-buy fee back.
        uint256 expectedFee = (seedUsdc * 50) / 10_000;
        uint256 expectedCreator = (expectedFee * 2000) / 10_000;
        assertEq(feeVault.creatorBalance(creator), expectedCreator, "Seed buy should accrue creator-share to creator");
        assertEq(feeVault.lifetimeCreatorEarned(creator), expectedCreator, "Lifetime should match");
        assertEq(usdc.balanceOf(address(feeVault)), expectedFee, "Vault should hold full seed buy fee");
        assertTrue(tokenAddr != address(0));
    }

    function test_buy_postGrad_feeAccrues() public {
        address tokenAddr = _createToken(0);
        _graduateToken(tokenAddr);

        uint256 vaultBefore = usdc.balanceOf(address(feeVault));
        uint256 usdcIn = _smallBuyUsdc();
        _buyViaRouter(tokenAddr, makeAddr("postGradBuyer"), usdcIn);

        uint256 expectedFee = (usdcIn * 50) / 10_000;
        assertEq(
            usdc.balanceOf(address(feeVault)) - vaultBefore,
            expectedFee,
            "Post-grad buys must still accrue the same fee"
        );
    }

    function test_sell_postGrad_feeAccrues() public {
        address tokenAddr = _createToken(0);
        _graduateToken(tokenAddr);

        address seller = makeAddr("postGradSeller");
        uint256 tokensOut = _buyViaRouter(tokenAddr, seller, _smallBuyUsdc());
        uint256 vaultBefore = usdc.balanceOf(address(feeVault));

        vm.startPrank(seller);
        Token(tokenAddr).approve(address(zap), tokensOut);
        uint256 usdcOut = zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();

        uint256 fee = (usdcOut * 50) / 9950;
        assertApproxEqAbs(
            usdc.balanceOf(address(feeVault)) - vaultBefore, fee, 1, "Post-grad sells must still accrue the same fee"
        );
    }

    function test_setFees_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        zap.setFees(100, 100, 3000);
    }

    function test_setFees_updatesValues() public {
        zap.setFees(30, 70, 1500);
        assertEq(zap.buyFeeBps(), 30);
        assertEq(zap.sellFeeBps(), 70);
        assertEq(zap.creatorFeeBps(), 1500);
    }

    function test_setFees_revertsAboveCap() public {
        vm.expectRevert(Zap.InvalidFee.selector);
        zap.setFees(201, 50, 2000);
    }

    function test_setFees_revertsCreatorAboveDenom() public {
        vm.expectRevert(Zap.InvalidFee.selector);
        zap.setFees(50, 50, 10_001);
    }

    function test_setFeeVault_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        zap.setFeeVault(makeAddr("new"));
    }

    function test_setFeeVault_revertsZeroAddress() public {
        vm.expectRevert(Zap.ZeroAddress.selector);
        zap.setFeeVault(address(0));
    }

    function test_setFeeVault_revertsIfRouterNotDepositor() public {
        FeeVault impl = new FeeVault();
        bytes memory init = abi.encodeCall(FeeVault.initialize, (address(usdc), feeReceiver));
        FeeVault freshVault = FeeVault(address(new ERC1967Proxy(address(impl), init)));

        vm.expectRevert(Zap.VaultNotConfigured.selector);
        zap.setFeeVault(address(freshVault));
    }

    function test_setFeeVault_succeedsWhenDepositorAllowlisted() public {
        FeeVault impl = new FeeVault();
        bytes memory init = abi.encodeCall(FeeVault.initialize, (address(usdc), feeReceiver));
        FeeVault freshVault = FeeVault(address(new ERC1967Proxy(address(impl), init)));
        freshVault.addDepositor(address(zap));

        zap.setFeeVault(address(freshVault));
        assertEq(address(zap.feeVault()), address(freshVault));
    }

    // ─── Fuzz Tests ──────────────────────────────────────────────────────

    function testFuzz_buy_curvePath(
        uint256 usdcAmount
    ) public {
        // Bound below the graduation threshold so all USDC clears the curve
        // without a refund — `_buyViaRouter` would otherwise swallow the
        // refund and the assertion still holds, but bounding keeps the
        // intent of the test ("ordinary curve buy") clear.
        usdcAmount = bound(usdcAmount, 1 ether, _mediumBuyUsdc());
        address tokenAddr = _createToken(0);

        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, usdcAmount);
        assertTrue(tokensOut > 0, "Should always receive tokens");
    }

    function testFuzz_roundTrip_neverProfits(
        uint256 usdcAmount
    ) public {
        // Lower bound clears the `$10` `MIN_USDC_AMOUNT` floor on both the
        // buy AND the sell side — the round-trip nets ~`$0.50` to fees +
        // slippage, so `$11` in is enough to keep the sell-side gross
        // estimate above the floor.
        usdcAmount = bound(usdcAmount, 11 ether, _mediumBuyUsdc());
        address tokenAddr = _createToken(0);

        uint256 tokensOut = _buyViaRouter(tokenAddr, trader, usdcAmount);

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(zap), tokensOut);
        uint256 usdcOut = zap.sell(tokenAddr, tokensOut, 0);
        vm.stopPrank();

        assertTrue(usdcOut <= usdcAmount, "Should never profit on round trip through router");
    }
}
