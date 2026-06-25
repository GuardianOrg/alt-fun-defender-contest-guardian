// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Bonding} from "../src/Bonding.sol";
import {Token} from "../src/Token.sol";
import {DeployHelper} from "./DeployHelper.sol";
import {MockHyperswapPair, MockHyperswapFactory} from "./mocks/MockHyperswapRouter.sol";

/// @notice End-to-end coverage of the two-phase graduation flow.
/// @dev Phase 1 fires inline on the threshold-crossing buy; phase 2 is a
///      separate permissionless `finalizeGraduation` call. The split exists
///      because seeding HyperSwap LP via `pair.mint` exceeds HyperEVM's ~2M
///      small-block gas limit. These tests verify:
///        - phase 1 emits `TokenGraduating`, sets `Lifecycle.Graduating`, freezes trades
///        - buys/sells during the window revert with `TokenIsGraduating`
///        - `finalizeGraduation` is callable by anyone, idempotent in failure modes
///        - the brick scenario (front-runner pre-seeds the HyperSwap pair with
///          dust between phase 1 and phase 2) does NOT permanently brick finalize —
///          we use direct `pair.mint(lpLock)` for exactly this reason
contract TwoPhaseGraduationTest is DeployHelper {
    address public stranger = makeAddr("stranger");
    address public griefer = makeAddr("griefer");

    function setUp() public {
        _deployCore();
        bonding.addRouter(creator);
        bonding.addRouter(trader);
        bonding.addRouter(trader2);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _launchToken() internal returns (address tokenAddr, address pairAddr) {
        Bonding.LaunchParams memory params = Bonding.LaunchParams({
            name: "TwoPhase",
            ticker: "TP",
            description: "",
            image: "",
            urls: ["", "", ""],
            ltAddress: address(lt),
            salt: _mineVanitySalt(creator, "TwoPhase", "TP")
        });
        vm.prank(creator);
        (tokenAddr, pairAddr) = bonding.launch(params, creator);
        // Anti-snipe gate is observed in `Zap.t.sol`. These tests drive
        // Bonding directly to exercise graduation, so jump past
        // `LAUNCH_TRADING_DELAY_BLOCKS` once the token is up.
        vm.roll(block.number + bonding.LAUNCH_TRADING_DELAY_BLOCKS() + 1);
    }

    /// @dev Buy without auto-finalizing — leaves the token in `Graduating` if
    ///      this buy crossed the threshold. Used by tests that need to
    ///      observe / interact with the phase-1→2 window.
    function _buyNoFinalize(
        address tokenAddr,
        address buyer,
        uint256 ltAmount
    ) internal {
        lt.mintDirect(buyer, ltAmount);
        if (!bonding.isRouter(buyer)) bonding.addRouter(buyer);
        vm.startPrank(buyer);
        lt.approve(address(curveRouter), ltAmount);
        bonding.buy(ltAmount, tokenAddr, 0, buyer);
        vm.stopPrank();
    }

    /// @dev Drive a token to the `Graduating` state without finalizing.
    ///      Stages 80% of `graduationThresholdUsd` worth of LT, doubles the
    ///      exchange rate (→ ≥160% of threshold), then nudges with a tiny
    ///      trigger trade. Sized off live config via `DeployHelper`
    ///      helpers so this remains valid as `VIRTUAL_LIQUIDITY_USD` and
    ///      the threshold are retuned.
    function _enterGraduating(
        address tokenAddr
    ) internal {
        _buyNoFinalize(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        _buyNoFinalize(tokenAddr, trader2, _ltGraduationTrigger());
        require(bonding.isGraduating(tokenAddr), "test setup: phase 1 did not fire");
    }

    // ─── Phase 1 behaviour ───────────────────────────────────────────────

    function test_phase1_fires_TokenGraduating_event() public {
        (address tokenAddr,) = _launchToken();
        _buyNoFinalize(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());

        // Set up the prank stack manually so `vm.expectEmit` lands directly
        // before the call that should emit (an `_buyNoFinalize` wrapper does
        // transfers in between, which would match the topic-less expect).
        uint256 trigger = _ltGraduationTrigger();
        lt.mintDirect(trader2, trigger);
        vm.startPrank(trader2);
        lt.approve(address(curveRouter), trigger);

        // The buy that crosses the USD trigger emits `TokenGraduating`.
        vm.expectEmit(true, false, false, false);
        emit Bonding.TokenGraduating(tokenAddr, 0, 0, 0, 0);
        bonding.buy(trigger, tokenAddr, 0, trader2);
        vm.stopPrank();

        assertTrue(bonding.isGraduating(tokenAddr));
        assertFalse(bonding.isGraduated(tokenAddr));
        assertFalse(bonding.isTrading(tokenAddr));
    }

    function test_phase1_caches_pendingGraduation_state() public {
        (address tokenAddr,) = _launchToken();
        _enterGraduating(tokenAddr);

        (uint256 tokensForLP, uint256 ltFromPair, uint256 lpBurned, uint256 unsoldBurned) =
            bonding.pendingGraduation(tokenAddr);

        assertTrue(tokensForLP > 0, "tokensForLP must be cached for phase 2");
        assertTrue(ltFromPair > 0, "ltFromPair must be cached");
        assertTrue(unsoldBurned + lpBurned > 0, "at least one of unsold/lpBurned must be > 0");
    }

    function test_phase1_buy_during_pending_reverts() public {
        (address tokenAddr,) = _launchToken();
        _enterGraduating(tokenAddr);

        uint256 attempt = _ltGraduationTrigger();
        lt.mintDirect(trader, attempt);
        vm.startPrank(trader);
        lt.approve(address(curveRouter), attempt);
        vm.expectRevert(Bonding.TokenIsGraduating.selector);
        bonding.buy(attempt, tokenAddr, 0, trader);
        vm.stopPrank();
    }

    function test_phase1_sell_during_pending_reverts() public {
        // Seed a holder before graduating so they have something to try to sell.
        (address tokenAddr,) = _launchToken();
        _buyNoFinalize(tokenAddr, trader, _ltStageBeforeGraduation());
        uint256 holderBalance = Token(tokenAddr).balanceOf(trader);
        assertTrue(holderBalance > 0);

        // Now graduate via the standard rate-pump pattern.
        lt.setExchangeRate(_ratePumpForStagedGraduation());
        _buyNoFinalize(tokenAddr, trader2, _ltGraduationTrigger());
        assertTrue(bonding.isGraduating(tokenAddr));

        vm.startPrank(trader);
        Token(tokenAddr).approve(address(curveRouter), holderBalance);
        vm.expectRevert(Bonding.TokenIsGraduating.selector);
        bonding.sell(holderBalance, tokenAddr, 0, trader);
        vm.stopPrank();
    }

    // ─── Phase 2 behaviour ───────────────────────────────────────────────

    function test_phase2_anyone_can_finalize() public {
        (address tokenAddr,) = _launchToken();
        _enterGraduating(tokenAddr);

        // Random EOA — not the keeper, not the owner.
        vm.prank(stranger);
        bonding.finalizeGraduation(tokenAddr);

        assertTrue(bonding.isGraduated(tokenAddr));
        assertFalse(bonding.isGraduating(tokenAddr));
        assertTrue(bonding.graduatedPair(tokenAddr) != address(0), "hyperswap pair must be seeded");
    }

    function test_phase2_clears_pendingGraduation_state() public {
        (address tokenAddr,) = _launchToken();
        _enterGraduating(tokenAddr);

        bonding.finalizeGraduation(tokenAddr);

        (uint256 tokensForLP, uint256 ltFromPair, uint256 lpBurned, uint256 unsoldBurned) =
            bonding.pendingGraduation(tokenAddr);
        assertEq(tokensForLP, 0);
        assertEq(ltFromPair, 0);
        assertEq(lpBurned, 0);
        assertEq(unsoldBurned, 0);
    }

    function test_phase2_emits_TokenGraduated() public {
        (address tokenAddr,) = _launchToken();
        _enterGraduating(tokenAddr);

        vm.expectEmit(true, false, false, false);
        emit Bonding.TokenGraduated(tokenAddr, address(0), 0, 0, 0, 0);
        bonding.finalizeGraduation(tokenAddr);
    }

    function test_phase2_double_finalize_reverts() public {
        (address tokenAddr,) = _launchToken();
        _enterGraduating(tokenAddr);
        bonding.finalizeGraduation(tokenAddr);

        // Second call: token is now `Graduated`, not `Graduating`.
        vm.expectRevert(Bonding.NotGraduating.selector);
        bonding.finalizeGraduation(tokenAddr);
    }

    function test_phase2_finalize_on_curve_token_reverts() public {
        (address tokenAddr,) = _launchToken();
        // Token is in `Curve` — never entered `Graduating`.
        vm.expectRevert(Bonding.NotGraduating.selector);
        bonding.finalizeGraduation(tokenAddr);
    }

    // ─── Unknown-token defense ───────────────────────────────────────────

    /// @notice `Lifecycle.Curve` is the zero value of the enum, so without an
    ///         explicit existence check, calling `buy`/`sell` against a never-
    ///         registered address would fall through into router/pair calls
    ///         that revert deep in low-level decode errors. Both functions
    ///         must revert deterministically with `TokenNotTrading` for
    ///         unknown tokens, matching the pre-enum behaviour where
    ///         `trading == false` was the default.
    function test_unknownToken_buy_reverts_with_TokenNotTrading() public {
        address bogus = makeAddr("not-a-launched-token");
        uint256 attempt = _smallBuyLt();
        lt.mintDirect(trader, attempt);
        vm.startPrank(trader);
        lt.approve(address(curveRouter), attempt);
        vm.expectRevert(Bonding.TokenNotTrading.selector);
        bonding.buy(attempt, bogus, 0, trader);
        vm.stopPrank();
    }

    function test_unknownToken_sell_reverts_with_TokenNotTrading() public {
        address bogus = makeAddr("not-a-launched-token");
        vm.prank(trader);
        vm.expectRevert(Bonding.TokenNotTrading.selector);
        bonding.sell(1 ether, bogus, 0, trader);
    }

    // ─── Brick-resistance (the whole reason we use direct pair.mint) ─────

    /// @notice A front-runner pre-creates the HyperSwap pair AND deposits dust
    ///         to set reserves > 0, hoping to brick `finalizeGraduation`. Under
    ///         the previous `_requirePairEmpty` design this would have
    ///         permanently locked the token's LP-bound assets in `Bonding`.
    ///         With direct `pair.mint(lpLock)`, finalize must succeed.
    function test_brick_resistance_frontRun_dust_seed() public {
        (address tokenAddr,) = _launchToken();

        // Griefer buys some tokens on the curve to use as ammo for the
        // dust-seed attack later. Modest amount so they remain a holder
        // without graduating the curve themselves.
        if (!bonding.isRouter(griefer)) bonding.addRouter(griefer);
        uint256 grieferBuy = _smallBuyLt();
        lt.mintDirect(griefer, grieferBuy);
        vm.startPrank(griefer);
        lt.approve(address(curveRouter), grieferBuy);
        bonding.buy(grieferBuy, tokenAddr, 0, griefer);
        vm.stopPrank();
        uint256 grieferTokens = Token(tokenAddr).balanceOf(griefer);
        assertTrue(grieferTokens > 0);

        // Drive the curve into the `Graduating` window.
        _enterGraduating(tokenAddr);

        (uint256 tokensForLP, uint256 ltFromPair,,) = bonding.pendingGraduation(tokenAddr);
        assertTrue(tokensForLP > 0 && ltFromPair > 0);

        // Pre-create the HyperSwap pair, deposit dust from both sides, mint LP
        // to the griefer's address. The pair now has non-zero reserves at a
        // skewed (and ultimately economically-destructive-to-the-griefer)
        // price. Under the OLD `_requirePairEmpty` design this would brick
        // finalize forever.
        MockHyperswapFactory hsFactory = MockHyperswapFactory(hyperswapRouter.factory());
        address hyperPair = hsFactory.createPair(tokenAddr, address(lt));
        lt.mintDirect(griefer, 1 ether);

        vm.startPrank(griefer);
        // Use a tiny fraction of griefer's curve-bought tokens as dust.
        IERC20(tokenAddr).transfer(hyperPair, 1 ether);
        lt.transfer(hyperPair, 1 ether);
        MockHyperswapPair(hyperPair).mint(griefer);
        vm.stopPrank();

        // The protocol must still be able to finalize despite the dust.
        bonding.finalizeGraduation(tokenAddr);

        assertTrue(bonding.isGraduated(tokenAddr), "finalize must succeed despite front-run dust seed");
        assertEq(bonding.graduatedPair(tokenAddr), hyperPair, "must reuse the front-run pair");

        uint256 lockedLp = MockHyperswapPair(hyperPair).balanceOf(address(lpLockContract));
        assertTrue(lockedLp > 0, "lpLock must hold the protocol LP");
    }

    /// @notice A pre-created pair flipped to `reserves > 0 && totalSupply == 0`
    ///         via `transfer(pair, 1 wei) + sync()` must still graduate at the
    ///         cached curve-close ratio, not the attacker's synced 1:1. The
    ///         `totalSupply() == 0` regime gate routes this shape to the direct
    ///         mint; the attacker, having minted no LP, holds none.
    function test_syncDust_preseed_opensAtCurveRatio() public {
        (address tokenAddr,) = _launchToken();
        _enterGraduating(tokenAddr);

        (uint256 tokensForLP, uint256 ltFromPair,,) = bonding.pendingGraduation(tokenAddr);
        assertTrue(tokensForLP > 0 && ltFromPair > 0);
        assertNotEq(tokensForLP, ltFromPair, "test setup should have non-1:1 target ratio");

        MockHyperswapFactory hsFactory = MockHyperswapFactory(hyperswapRouter.factory());
        address hyperPair = hsFactory.createPair(tokenAddr, address(lt));

        lt.mintDirect(griefer, 1);
        deal(tokenAddr, griefer, 1);
        vm.startPrank(griefer);
        IERC20(tokenAddr).transfer(hyperPair, 1);
        lt.transfer(hyperPair, 1);
        MockHyperswapPair(hyperPair).sync();
        vm.stopPrank();

        // Sanity-check the attack precondition: reserves non-zero but no
        // LP minted — the gap the fix closes.
        (uint112 preR0, uint112 preR1,) = MockHyperswapPair(hyperPair).getReserves();
        assertGt(uint256(preR0), 0);
        assertGt(uint256(preR1), 0);
        assertEq(MockHyperswapPair(hyperPair).totalSupply(), 0);

        bonding.finalizeGraduation(tokenAddr);

        (uint112 r0, uint112 r1,) = MockHyperswapPair(hyperPair).getReserves();
        bool tokenIs0 = MockHyperswapPair(hyperPair).token0() == tokenAddr;
        (uint256 reserveToken, uint256 reserveLT) = tokenIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));

        // Pool MUST open at the curve-close ratio (`tokensForLP : ltFromPair`),
        // NOT at the attacker's synced 1:1. The 1-wei dust contributes at most
        // 1 wei of skew vs. the target reserves, well inside `1e12` (= 1e-6).
        assertApproxEqRel(
            reserveToken * ltFromPair,
            reserveLT * tokensForLP,
            1e12,
            "pool must open at curve-close ratio despite sync-dust pre-seed"
        );

        // Protocol LP is locked.
        uint256 lockedLp = MockHyperswapPair(hyperPair).balanceOf(address(lpLockContract));
        assertGt(lockedLp, 0, "lpLock must hold the protocol LP");
        // Attacker holds no LP — they gifted dust to the locked LP.
        assertEq(MockHyperswapPair(hyperPair).balanceOf(griefer), 0, "attacker must hold no LP");
    }

    /// @notice Same `sync()`-dust shape (`reserves > 0 && totalSupply == 0`)
    ///         but with a meaningfully-sized, off-ratio seed — large enough
    ///         that the rebalance swap would otherwise fire. The
    ///         `totalSupply() == 0` gate still direct-mints at the cached
    ///         ratio; since a realistic seed is negligible against the
    ///         graduation inventory, the pool opens at the curve-close ratio
    ///         and the attacker holds no LP.
    function test_syncDust_meaningfulPreseed_opensAtCurveRatio() public {
        (address tokenAddr,) = _launchToken();
        _enterGraduating(tokenAddr);

        (uint256 tokensForLP, uint256 ltFromPair,,) = bonding.pendingGraduation(tokenAddr);
        assertNotEq(tokensForLP, ltFromPair, "test setup should have non-1:1 target ratio");

        MockHyperswapFactory hsFactory = MockHyperswapFactory(hyperswapRouter.factory());
        address hyperPair = hsFactory.createPair(tokenAddr, address(lt));

        // 1 LT + 3x the curve-close ratio of TOKEN: meaningfully token-rich,
        // so the rebalance swap (had we taken it) would fire with a non-trivial
        // input/output — i.e. this is NOT the swap-rounds-to-zero fallback.
        uint256 reserveLt = 1 ether;
        uint256 reserveToken = (3 * reserveLt * tokensForLP) / ltFromPair;
        deal(tokenAddr, griefer, reserveToken);
        lt.mintDirect(griefer, reserveLt);
        vm.startPrank(griefer);
        IERC20(tokenAddr).transfer(hyperPair, reserveToken);
        lt.transfer(hyperPair, reserveLt);
        MockHyperswapPair(hyperPair).sync();
        vm.stopPrank();

        // Confirm the precondition the gate targets and that the swap path
        // would otherwise have been taken (the no-fee input is well above 0).
        (uint112 preR0, uint112 preR1,) = MockHyperswapPair(hyperPair).getReserves();
        assertGt(uint256(preR0), 0);
        assertGt(uint256(preR1), 0);
        assertEq(MockHyperswapPair(hyperPair).totalSupply(), 0, "precondition: zero supply");
        assertGt(
            _noFeeSwapInputUncapped(reserveLt, reserveToken, ltFromPair, tokensForLP),
            0,
            "setup: seed must be large enough that the rebalance swap would fire"
        );

        bonding.finalizeGraduation(tokenAddr);

        assertTrue(bonding.isGraduated(tokenAddr));
        assertEq(bonding.graduatedPair(tokenAddr), hyperPair, "must reuse the front-run pair");

        (uint112 r0, uint112 r1,) = MockHyperswapPair(hyperPair).getReserves();
        bool tokenIs0 = MockHyperswapPair(hyperPair).token0() == tokenAddr;
        (uint256 finalToken, uint256 finalLt) = tokenIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));

        // Both LP-bound sides land in full; the attacker's seed sits on top as
        // a donation that backs the locked LP, not the attacker.
        assertGe(finalToken, tokensForLP, "all tokensForLP must back the LP");
        assertGe(finalLt, ltFromPair, "all ltFromPair must back the LP");

        // Pool opens at the curve-close ratio, NOT the attacker's 3x-off
        // synced ratio. The 1-LT seed is negligible against the multi-thousand
        // LT inventory, so a 1% band comfortably absorbs the residual skew.
        uint256 priceFinal = (finalLt * 1e18) / finalToken;
        uint256 priceTarget = (ltFromPair * 1e18) / tokensForLP;
        assertApproxEqRel(
            priceFinal, priceTarget, 1e16, "pool must open at curve-close ratio despite meaningful sync-dust"
        );

        // Attacker minted no LP and gifted the dust to the locked LP holder.
        assertEq(MockHyperswapPair(hyperPair).balanceOf(griefer), 0, "attacker must hold no LP");
        assertGt(MockHyperswapPair(hyperPair).balanceOf(address(lpLockContract)), 0, "lpLock must hold the protocol LP");
    }

    /// @notice Same hostile mint pre-seed as the dust-seed case, but the pair's
    ///         fee has been moved off the default beforehand. The rebalance leg
    ///         quotes its output from the pair, so finalize must still succeed;
    ///         a hardcoded fee rate would overshoot the pair's K-check and brick
    ///         the graduation.
    function test_brick_resistance_preSeed_withRaisedPairFee() public {
        (address tokenAddr,) = _launchToken();

        if (!bonding.isRouter(griefer)) bonding.addRouter(griefer);
        uint256 grieferBuy = _smallBuyLt();
        lt.mintDirect(griefer, grieferBuy);
        vm.startPrank(griefer);
        lt.approve(address(curveRouter), grieferBuy);
        bonding.buy(grieferBuy, tokenAddr, 0, griefer);
        vm.stopPrank();
        assertTrue(Token(tokenAddr).balanceOf(griefer) > 0);

        _enterGraduating(tokenAddr);

        MockHyperswapFactory hsFactory = MockHyperswapFactory(hyperswapRouter.factory());
        address hyperPair = hsFactory.createPair(tokenAddr, address(lt));
        lt.mintDirect(griefer, 1 ether);

        vm.startPrank(griefer);
        IERC20(tokenAddr).transfer(hyperPair, 1 ether);
        lt.transfer(hyperPair, 1 ether);
        MockHyperswapPair(hyperPair).mint(griefer);
        vm.stopPrank();

        // HyperSwap raises this pair's fee to 0.9% (900 / FEE_DENOMINATOR
        // 100_000) before the protocol gets to finalize; the canonical default
        // is 0.3% (300).
        MockHyperswapPair(hyperPair).setFeePercent(900, 900);

        bonding.finalizeGraduation(tokenAddr);

        assertTrue(bonding.isGraduated(tokenAddr), "finalize must survive a non-default pair fee");
        assertEq(bonding.graduatedPair(tokenAddr), hyperPair, "must reuse the front-run pair");
        assertTrue(
            MockHyperswapPair(hyperPair).balanceOf(address(lpLockContract)) > 0, "lpLock must hold the protocol LP"
        );
    }

    /// @notice Variation: the griefer creates the pair but doesn't seed it.
    ///         Empty pre-created pair must still work (this was the only
    ///         brick-resistance path the old code handled).
    function test_brick_resistance_frontRun_empty_pair() public {
        (address tokenAddr,) = _launchToken();
        _enterGraduating(tokenAddr);

        MockHyperswapFactory hsFactory = MockHyperswapFactory(hyperswapRouter.factory());
        address hyperPair = hsFactory.createPair(tokenAddr, address(lt));

        bonding.finalizeGraduation(tokenAddr);

        assertTrue(bonding.isGraduated(tokenAddr));
        assertEq(bonding.graduatedPair(tokenAddr), hyperPair);
    }

    // ─── Hostile dust pre-seed must still open at the curve-close ratio ───
    //
    // A front-runner can mint LP into the HyperSwap pair at a hostile ratio
    // using reserves just above the V2 MINIMUM_LIQUIDITY floor. When the
    // tiny side is the rebalance swap's output, the fee-charging quote (or
    // the no-fee input) rounds to zero, so no swap can move the ratio. The
    // seeding must then overpower the dust with a direct mint and open at
    // the cached `tokensForLP : ltFromPair` ratio — depositing at the
    // attacker's ratio would mis-price the pool and strand most of one
    // side's inventory.

    /// @dev Griefer buys a little of the curve so they hold launched tokens
    ///      to fund the dust seed later.
    function _grieferAccumulate(
        address tokenAddr
    ) internal {
        if (!bonding.isRouter(griefer)) bonding.addRouter(griefer);
        uint256 grieferBuy = _smallBuyLt();
        lt.mintDirect(griefer, grieferBuy);
        vm.startPrank(griefer);
        lt.approve(address(curveRouter), grieferBuy);
        bonding.buy(grieferBuy, tokenAddr, 0, griefer);
        vm.stopPrank();
    }

    /// @dev Front-run the pair: create it, fund both reserves at the given
    ///      (hostile) ratio, and mint dust LP to the griefer.
    function _grieferMintPreSeed(
        address tokenAddr,
        uint256 reserveTokenAmt,
        uint256 reserveLtAmt
    ) internal returns (address hyperPair) {
        require(Token(tokenAddr).balanceOf(griefer) >= reserveTokenAmt, "test setup: griefer short on tokens");
        MockHyperswapFactory hsFactory = MockHyperswapFactory(hyperswapRouter.factory());
        hyperPair = hsFactory.createPair(tokenAddr, address(lt));
        lt.mintDirect(griefer, reserveLtAmt);
        vm.startPrank(griefer);
        IERC20(tokenAddr).transfer(hyperPair, reserveTokenAmt);
        lt.transfer(hyperPair, reserveLtAmt);
        MockHyperswapPair(hyperPair).mint(griefer);
        vm.stopPrank();
        assertGt(MockHyperswapPair(hyperPair).balanceOf(griefer), 0, "pre-seed must mint dust LP");
    }

    /// @dev Uncapped form of the production no-fee swap input, used only to
    ///      assert the test reserves land on the swap-skip boundary (the cap
    ///      never binds against a dust seed).
    function _noFeeSwapInputUncapped(
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 targetN,
        uint256 targetD
    ) private pure returns (uint256) {
        uint256 newIn = Math.sqrt(Math.mulDiv(reserveIn * reserveOut, targetN, targetD));
        return newIn > reserveIn ? newIn - reserveIn : 0;
    }

    function _assertOpensAtCachedRatio(
        address hyperPair,
        address tokenAddr,
        uint256 tokensForLP,
        uint256 ltFromPair
    ) internal view {
        (uint112 r0, uint112 r1,) = MockHyperswapPair(hyperPair).getReserves();
        bool tokenIs0 = MockHyperswapPair(hyperPair).token0() == tokenAddr;
        (uint256 finalToken, uint256 finalLt) = tokenIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));

        // Both LP-bound sides land in full (nothing burned / swept away),
        // plus the attacker's negligible dust.
        assertGe(finalToken, tokensForLP, "all tokensForLP must back the LP");
        assertGe(finalLt, ltFromPair, "all ltFromPair must back the LP");

        // Pool opens at the cached curve-close price; the dust skews it by
        // orders of magnitude less than this tolerance.
        uint256 priceFinal = (finalLt * 1e18) / finalToken;
        uint256 priceTarget = (ltFromPair * 1e18) / tokensForLP;
        assertApproxEqRel(priceFinal, priceTarget, 1e12, "pool must open at the curve-close ratio");

        // The attacker's pre-existing LP is dwarfed by the locked protocol LP.
        uint256 lpLockLp = MockHyperswapPair(hyperPair).balanceOf(address(lpLockContract));
        uint256 grieferLp = MockHyperswapPair(hyperPair).balanceOf(griefer);
        assertGt(lpLockLp, 0, "lpLock must hold the protocol LP");
        assertGt(lpLockLp, grieferLp * 1e9, "attacker LP capture must be negligible");
    }

    /// @notice Token-rich dust pre-seed (pool would open token-cheap) where
    ///         the no-fee rebalance input rounds to zero. Finalize must
    ///         overpower it and open at the cached ratio.
    function test_hostilePreSeed_tokenRichDust_opensAtCachedRatio() public {
        (address tokenAddr,) = _launchToken();
        _grieferAccumulate(tokenAddr);
        _enterGraduating(tokenAddr);

        (uint256 tokensForLP, uint256 ltFromPair,,) = bonding.pendingGraduation(tokenAddr);

        // Tiny LT reserve; token reserve 20% above the curve-close ratio
        // (token-rich), so the rebalance would swap LT in — but the no-fee
        // input rounds to zero against the dust LT side.
        uint256 reserveLt = 8;
        uint256 reserveToken = (reserveLt * tokensForLP * 12) / (ltFromPair * 10);
        assertEq(
            _noFeeSwapInputUncapped(reserveLt, reserveToken, ltFromPair, tokensForLP),
            0,
            "test must exercise the s==0 swap-skip path"
        );

        address hyperPair = _grieferMintPreSeed(tokenAddr, reserveToken, reserveLt);
        bonding.finalizeGraduation(tokenAddr);

        assertTrue(bonding.isGraduated(tokenAddr));
        assertEq(bonding.graduatedPair(tokenAddr), hyperPair, "must reuse the front-run pair");
        _assertOpensAtCachedRatio(hyperPair, tokenAddr, tokensForLP, ltFromPair);
    }

    /// @notice LT-rich dust pre-seed (pool would open token-expensive) where
    ///         the pair's fee-charging swap quote rounds to zero. Finalize
    ///         must overpower it and open at the cached ratio.
    function test_hostilePreSeed_ltRichDust_opensAtCachedRatio() public {
        (address tokenAddr,) = _launchToken();
        _grieferAccumulate(tokenAddr);
        _enterGraduating(tokenAddr);

        (uint256 tokensForLP, uint256 ltFromPair,,) = bonding.pendingGraduation(tokenAddr);

        // Tiny LT reserve; token reserve 15% below the curve-close ratio
        // (LT-rich), so the rebalance would swap TOKEN in. The no-fee input
        // is positive but the pair's fee-charging getAmountOut rounds to
        // zero against the dust LT output side.
        uint256 reserveLt = 10;
        uint256 reserveToken = (reserveLt * tokensForLP * 85) / (ltFromPair * 100);
        uint256 s = _noFeeSwapInputUncapped(reserveToken, reserveLt, tokensForLP, ltFromPair);
        assertGt(s, 0, "test setup: no-fee input should be positive in the LT-rich direction");

        address hyperPair = _grieferMintPreSeed(tokenAddr, reserveToken, reserveLt);
        assertEq(
            MockHyperswapPair(hyperPair).getAmountOut(s, tokenAddr),
            0,
            "test must exercise the getAmountOut==0 swap-skip path"
        );

        bonding.finalizeGraduation(tokenAddr);

        assertTrue(bonding.isGraduated(tokenAddr));
        assertEq(bonding.graduatedPair(tokenAddr), hyperPair, "must reuse the front-run pair");
        _assertOpensAtCachedRatio(hyperPair, tokenAddr, tokensForLP, ltFromPair);
    }

    /// @notice Sanity counterpart: a meaningfully-sized, off-ratio hostile
    ///         pre-seed is repaired by the rebalance swap (not the direct-mint
    ///         fallback) and still opens close to the curve-close ratio. This
    ///         guards the existing swap+router defense against regressions.
    function test_hostilePreSeed_meaningfulReserves_swapPathOpensNearRatio() public {
        (address tokenAddr,) = _launchToken();
        _grieferAccumulate(tokenAddr);
        _enterGraduating(tokenAddr);

        (uint256 tokensForLP, uint256 ltFromPair,,) = bonding.pendingGraduation(tokenAddr);

        // LT side above the direct-mint band and token side at 3x the
        // curve-close ratio: meaningfully token-rich, so the rebalance swap
        // fires with a non-trivial input and output rather than the
        // sub-band direct-mint path.
        uint256 reserveLt = (ltFromPair * (bonding.DIRECT_MINT_PRESEED_BPS() * 2)) / 10_000;
        uint256 reserveToken = (3 * reserveLt * tokensForLP) / ltFromPair;
        address hyperPair = _grieferMintPreSeed(tokenAddr, reserveToken, reserveLt);

        // Confirm we are on the swap path, not the dust fallback: both the
        // no-fee input and the pair's fee-charging quote are well above zero.
        uint256 s = _noFeeSwapInputUncapped(reserveLt, reserveToken, ltFromPair, tokensForLP);
        assertGt(s, 0, "meaningful pre-seed must take the swap path");
        assertGt(MockHyperswapPair(hyperPair).getAmountOut(s, address(lt)), 0, "swap output must be non-zero");

        bonding.finalizeGraduation(tokenAddr);

        assertTrue(bonding.isGraduated(tokenAddr));
        (uint112 r0, uint112 r1,) = MockHyperswapPair(hyperPair).getReserves();
        bool tokenIs0 = MockHyperswapPair(hyperPair).token0() == tokenAddr;
        (uint256 finalToken, uint256 finalLt) = tokenIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        uint256 priceFinal = (finalLt * 1e18) / finalToken;
        uint256 priceTarget = (ltFromPair * 1e18) / tokensForLP;
        // 1% band absorbs the V2 fee + quote rounding the router path leaves.
        assertApproxEqRel(
            priceFinal, priceTarget, 1e16, "meaningful pre-seed must still open near the curve-close ratio"
        );
        assertGt(MockHyperswapPair(hyperPair).balanceOf(address(lpLockContract)), 0, "lpLock must hold the protocol LP");
    }

    /// @notice A mint pre-seed below the direct-mint band on both sides but
    ///         large enough that the rebalance swap would still fire (non-zero
    ///         no-fee input AND non-zero fee-charging output). Finalize must
    ///         skip the coarse swap and open at the cached ratio instead of
    ///         depositing the inventory at the attacker's skewed pool ratio.
    function test_hostilePreSeed_subBandSwap_opensAtCachedRatio() public {
        (address tokenAddr,) = _launchToken();
        _grieferAccumulate(tokenAddr);
        _enterGraduating(tokenAddr);

        (uint256 tokensForLP, uint256 ltFromPair,,) = bonding.pendingGraduation(tokenAddr);

        // Tiny LT reserve; token reserve at half the curve-close ratio
        // (LT-rich), so the rebalance would swap TOKEN in for LT out.
        uint256 reserveLt = 1e6;
        uint256 reserveToken = (reserveLt * tokensForLP) / (ltFromPair * 2);

        uint256 band = bonding.DIRECT_MINT_PRESEED_BPS();
        assertLt(reserveToken * 10_000, tokensForLP * band, "token side must sit below the band");
        assertLt(reserveLt * 10_000, ltFromPair * band, "LT side must sit below the band");

        // The swap would fire on the rebalance path (this is NOT the s==0 /
        // getAmountOut==0 fallback) — the band gate is what reroutes it.
        uint256 s = _noFeeSwapInputUncapped(reserveToken, reserveLt, tokensForLP, ltFromPair);
        assertGt(s, 0, "no-fee swap input must be positive");

        address hyperPair = _grieferMintPreSeed(tokenAddr, reserveToken, reserveLt);
        assertGt(
            MockHyperswapPair(hyperPair).getAmountOut(s, tokenAddr), 0, "fee-charging swap output must be positive"
        );

        bonding.finalizeGraduation(tokenAddr);

        assertTrue(bonding.isGraduated(tokenAddr));
        assertEq(bonding.graduatedPair(tokenAddr), hyperPair, "must reuse the front-run pair");
        _assertOpensAtCachedRatio(hyperPair, tokenAddr, tokensForLP, ltFromPair);
    }

    // ─── Direct-mint subsidy band (M-01) ─────────────────────────────────
    //
    // `_seedDirectMint` against a pre-existing LP donates the over-funded
    // side of the deposit to the pre-seeder under V2's empty-mint `min()`.
    // `DIRECT_MINT_PRESEED_BPS` caps that subsidy AND gates which pre-seeds
    // reach the direct mint. These tests bracket the band: a pre-seed sitting
    // on the band still direct-mints with a subsidy bounded by the band; a
    // pre-seed above the band takes the rebalance path and cannot profit.

    /// @dev Value `lp`'s claim on `(reserveToken, reserveLt)` expressed in LT
    ///      at the pool's current price, i.e. `claimToken * price + claimLt`.
    function _lpValueInLt(
        address hyperPair,
        address tokenAddr,
        uint256 lp
    ) private view returns (uint256) {
        uint256 totalLp = MockHyperswapPair(hyperPair).totalSupply();
        if (totalLp == 0) return 0;
        (uint112 r0, uint112 r1,) = MockHyperswapPair(hyperPair).getReserves();
        bool tokenIs0 = MockHyperswapPair(hyperPair).token0() == tokenAddr;
        (uint256 reserveToken, uint256 reserveLt) = tokenIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        uint256 claimToken = (lp * reserveToken) / totalLp;
        uint256 claimLt = (lp * reserveLt) / totalLp;
        return (claimToken * reserveLt) / reserveToken + claimLt;
    }

    /// @notice M-01 regression. The documented subsidy attack pre-seeds the
    ///         pair with TOKEN at the original 0.5% band on one side and 1 wei
    ///         of LT on the other; the empty-mint `min()` then donates ~0.5%
    ///         of `ltFromPair` to the attacker's LP for free. With the
    ///         tightened band this shape exceeds the direct-mint cutoff and
    ///         takes the rebalance path, which arbs the pre-seed away — so the
    ///         pre-seeder's redeemable value can never exceed its deposit
    ///         (P&L ≤ 0).
    function test_hostilePreSeed_asymmetricSubsidy_isNotProfitable() public {
        (address tokenAddr,) = _launchToken();
        _enterGraduating(tokenAddr);

        (uint256 tokensForLP, uint256 ltFromPair,,) = bonding.pendingGraduation(tokenAddr);

        // Worst-case M-01 shape: token side at the original 0.5% band, LT side
        // at 1 wei. Under the original 50-bps band this sat on the direct-mint
        // cutoff and the empty-mint `min()` donated ~0.5% of `ltFromPair` to
        // the attacker. Under the tightened band it exceeds the cutoff and
        // takes the loss-making rebalance path. The P&L assertion below holds
        // only on the tightened band (it fails on the original 50-bps value),
        // which is what makes this a regression test for M-01.
        uint256 reserveToken = (tokensForLP * 50) / 10_000;
        uint256 reserveLt = 1;

        deal(tokenAddr, griefer, reserveToken);
        address hyperPair = _grieferMintPreSeed(tokenAddr, reserveToken, reserveLt);
        uint256 grieferLp = MockHyperswapPair(hyperPair).balanceOf(griefer);

        bonding.finalizeGraduation(tokenAddr);
        assertTrue(bonding.isGraduated(tokenAddr));

        uint256 claimValueLt = _lpValueInLt(hyperPair, tokenAddr, grieferLp);
        uint256 depositValueLt = (reserveToken * ltFromPair) / tokensForLP + reserveLt;
        assertLe(claimValueLt, depositValueLt, "pre-seeder must not profit from the direct-mint subsidy");
    }

    /// @notice The residual case: a one-sided pre-seed sitting on the tightened
    ///         band still reaches the direct mint, and the empty-mint `min()`
    ///         still donates the over-funded side to the pre-seeder. This is
    ///         the worst case for the retained direct-mint path (token on the
    ///         band, LT at 1 wei, so the whole LT side is donated). The net
    ///         subsidy must stay bounded by the band fraction of `ltFromPair`,
    ///         which at 1 bp is economically negligible — this pins both the
    ///         bound the M-01 fix relies on and the constant against drifting
    ///         back up.
    function test_hostilePreSeed_atBand_subsidyBoundedByBand() public {
        (address tokenAddr,) = _launchToken();
        _enterGraduating(tokenAddr);

        (uint256 tokensForLP, uint256 ltFromPair,,) = bonding.pendingGraduation(tokenAddr);

        uint256 band = bonding.DIRECT_MINT_PRESEED_BPS();
        uint256 reserveToken = (tokensForLP * band) / 10_000;
        uint256 reserveLt = 1;
        // Both sides sit within the band, so the gate routes this to the
        // direct mint rather than the rebalance swap.
        assertLe(reserveToken * 10_000, tokensForLP * band, "token side must sit within the band");
        assertLe(reserveLt * 10_000, ltFromPair * band, "LT side must sit within the band");

        deal(tokenAddr, griefer, reserveToken);
        address hyperPair = _grieferMintPreSeed(tokenAddr, reserveToken, reserveLt);
        uint256 grieferLp = MockHyperswapPair(hyperPair).balanceOf(griefer);

        bonding.finalizeGraduation(tokenAddr);
        assertTrue(bonding.isGraduated(tokenAddr));

        uint256 claimValueLt = _lpValueInLt(hyperPair, tokenAddr, grieferLp);
        uint256 depositValueLt = (reserveToken * ltFromPair) / tokensForLP + reserveLt;
        uint256 maxSubsidy = (ltFromPair * band) / 10_000;
        assertLe(claimValueLt, depositValueLt + maxSubsidy, "direct-mint subsidy must stay within the band");
    }

    // ─── Hostile pre-seed economic safety (M-02) ─────────────────────────
    //
    // When a mint pre-seed is lopsided enough that the bounded rebalance swap
    // cannot reach the cached curve-close ratio — the per-side budget is only
    // `tokensForLP` (TOKEN-in) or `ltFromPair` (LT-in) — `finalizeGraduation`
    // deposits at the still-skewed post-swap ratio rather than reverting.
    // Brick-resistance (a revert leaves every holder stuck in `Graduating`
    // forever) ranks above price integrity, so the residual off-curve open is
    // accepted. These tests pin the economic floor that makes it acceptable:
    // the pre-seeder is always net-negative because the over-funded side is
    // arbed out by the rebalance swap and then confiscated (swept to the owner
    // or burned), and finalize never reverts across the pre-seed shape space.

    /// @dev Value `lp`'s pool claim in LT at the curve-close (fair) price
    ///      `ltFromPair / tokensForLP`, i.e. `claimToken * price + claimLt`.
    ///      Valuing at the fair price (not the skewed pool price) is what makes
    ///      "claim <= deposit" a genuine P&L statement rather than a
    ///      pool-relative identity that holds trivially.
    function _lpValueAtCurveClose(
        address hyperPair,
        address tokenAddr,
        uint256 lp,
        uint256 tokensForLP,
        uint256 ltFromPair
    ) private view returns (uint256) {
        uint256 totalLp = MockHyperswapPair(hyperPair).totalSupply();
        if (totalLp == 0) return 0;
        (uint112 r0, uint112 r1,) = MockHyperswapPair(hyperPair).getReserves();
        bool tokenIs0 = MockHyperswapPair(hyperPair).token0() == tokenAddr;
        (uint256 reserveToken, uint256 reserveLt) = tokenIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        uint256 claimToken = (lp * reserveToken) / totalLp;
        uint256 claimLt = (lp * reserveLt) / totalLp;
        return Math.mulDiv(claimToken, ltFromPair, tokensForLP) + claimLt;
    }

    /// @dev The pre-seeder's deposit valued at the curve-close price — their
    ///      cost basis, measured the same way as the LP claim above. `deal`ing
    ///      the TOKEN side for free is conservative: a real attacker buys it on
    ///      the curve at ~this price, so charging fair value here understates
    ///      neither their cost nor the conclusion.
    function _depositValueAtCurveClose(
        uint256 reserveTokenAmt,
        uint256 reserveLtAmt,
        uint256 tokensForLP,
        uint256 ltFromPair
    ) private pure returns (uint256) {
        return Math.mulDiv(reserveTokenAmt, ltFromPair, tokensForLP) + reserveLtAmt;
    }

    /// @dev Pool's current LT-per-token price (1e18-scaled). Factored out to
    ///      keep the M-02 reproducer below under solc's no-viaIR stack ceiling.
    function _poolPriceLtPerToken(
        address hyperPair,
        address tokenAddr
    ) private view returns (uint256) {
        (uint112 r0, uint112 r1,) = MockHyperswapPair(hyperPair).getReserves();
        bool tokenIs0 = MockHyperswapPair(hyperPair).token0() == tokenAddr;
        (uint256 finalToken, uint256 finalLt) = tokenIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        return (finalLt * 1e18) / finalToken;
    }

    /// @notice M-02 reproducer. An LT-rich mint pre-seed so lopsided that the
    ///         TOKEN-side rebalance swap exhausts its full budget (~99% of
    ///         `tokensForLP`) without reaching the cached ratio, so the pool
    ///         deposits materially off curve-close. Finalize must still succeed
    ///         (no brick), the over-funded LT side must be confiscated to the
    ///         owner, and the pre-seeder must end net-negative.
    function test_hostilePreSeed_budgetCappedSwap_isNotProfitable() public {
        (address tokenAddr,) = _launchToken();
        _enterGraduating(tokenAddr);

        (uint256 tokensForLP, uint256 ltFromPair,,) = bonding.pendingGraduation(tokenAddr);

        // Extreme LT-rich shape: TOKEN side at 1% of target, LT side at 200x.
        // The optimal TOKEN-in swap to reach the cached ratio is ~1.4x
        // `tokensForLP`, so the 99%-of-`tokensForLP` budget cap binds and the
        // pool stays ~2x off curve-close after the swap.
        uint256 reserveToken = tokensForLP / 100;
        uint256 reserveLt = ltFromPair * 200;

        // M-02 precondition: the optimal swap exceeds the budget (this is the
        // budget-capped regime, distinct from the swap-rounds-to-zero fallback
        // covered by the dust tests above).
        assertGt(
            _noFeeSwapInputUncapped(reserveToken, reserveLt, tokensForLP, ltFromPair),
            (tokensForLP * 99) / 100,
            "setup: optimal rebalance swap must exceed the per-side budget (M-02 regime)"
        );

        deal(tokenAddr, griefer, reserveToken);
        address hyperPair = _grieferMintPreSeed(tokenAddr, reserveToken, reserveLt);
        uint256 grieferLp = MockHyperswapPair(hyperPair).balanceOf(griefer);
        uint256 ownerLtBefore = lt.balanceOf(bonding.owner());

        bonding.finalizeGraduation(tokenAddr);
        assertTrue(bonding.isGraduated(tokenAddr), "finalize must succeed despite an unrecoverable pre-seed");

        // The accepted residual: no bounded swap can correct a 200x LT-rich
        // pre-seed, so the pool opens materially off curve-close.
        assertGt(
            _poolPriceLtPerToken(hyperPair, tokenAddr),
            (((ltFromPair * 1e18) / tokensForLP) * 12) / 10,
            "M-02 regime: pool opens materially off curve-close"
        );

        // The over-funded LT side is arbed out by the rebalance swap and swept
        // to the owner — the pre-seeder cannot recover it.
        assertGt(
            lt.balanceOf(bonding.owner()) - ownerLtBefore,
            reserveLt / 2,
            "the over-funded LT side must be confiscated to the owner"
        );

        // P&L: the pre-seeder's residual LP, valued at the fair (curve-close)
        // price, is worth a fraction of what they deposited — the attack is
        // cost-negative.
        uint256 claimValue = _lpValueAtCurveClose(hyperPair, tokenAddr, grieferLp, tokensForLP, ltFromPair);
        uint256 depositValue = _depositValueAtCurveClose(reserveToken, reserveLt, tokensForLP, ltFromPair);
        assertLe(claimValue, depositValue, "pre-seeder must not profit (P&L <= 0)");
        assertLt(claimValue * 2, depositValue, "pre-seeder must lose materially, not merely break even");
    }

    /// @notice Across the hostile mint-pre-seed shape space — both rich
    ///         directions and magnitudes spanning the in-budget rebalance and
    ///         the budget-capped (M-02) residual — `finalizeGraduation` must
    ///         never revert (brick-resistance) and the pre-seeder's residual
    ///         LP, valued at the fair curve-close price, must never exceed what
    ///         they deposited (P&L <= 0).
    /// forge-config: default.fuzz.runs = 64
    function testFuzz_hostilePreSeed_neverProfitable_neverBricks(
        uint256 seedMultiple,
        bool ltRich
    ) public {
        seedMultiple = bound(seedMultiple, 1, 1000);

        (address tokenAddr,) = _launchToken();
        _enterGraduating(tokenAddr);
        (uint256 tokensForLP, uint256 ltFromPair,,) = bonding.pendingGraduation(tokenAddr);

        // One side held at its LP target, the other over-funded by
        // `seedMultiple`. Small multiples reach the cached ratio within budget;
        // large ones exhaust it and exercise the M-02 residual. Both rich
        // directions are covered by `ltRich`.
        (uint256 reserveToken, uint256 reserveLt) =
            ltRich ? (tokensForLP, ltFromPair * seedMultiple) : (tokensForLP * seedMultiple, ltFromPair);

        deal(tokenAddr, griefer, reserveToken);
        address hyperPair = _grieferMintPreSeed(tokenAddr, reserveToken, reserveLt);
        uint256 grieferLp = MockHyperswapPair(hyperPair).balanceOf(griefer);

        // Brick-resistance: must succeed for every shape, and lock non-zero LP.
        bonding.finalizeGraduation(tokenAddr);
        assertTrue(bonding.isGraduated(tokenAddr), "finalize must succeed for every pre-seed shape");
        assertGt(
            MockHyperswapPair(hyperPair).balanceOf(address(lpLockContract)), 0, "lpLock must hold non-zero protocol LP"
        );

        uint256 claimValue = _lpValueAtCurveClose(hyperPair, tokenAddr, grieferLp, tokensForLP, ltFromPair);
        uint256 depositValue = _depositValueAtCurveClose(reserveToken, reserveLt, tokensForLP, ltFromPair);
        // Strict P&L bound; the small absolute slack only absorbs integer
        // rounding in the LP-claim arithmetic (sub-wei-relative), far below any
        // economically-meaningful subsidy.
        assertLe(claimValue, depositValue + 1e9, "pre-seeder LP claim must not exceed deposit (P&L <= 0)");
    }

    // ─── Phase 1 gas budget ──────────────────────────────────────────────

    /// @notice The graduating buy must fit in HyperEVM's ~2M small-block gas
    ///         ceiling. This is the entire point of the two-phase split; if
    ///         this assertion ever flips, traders will randomly hit big-block
    ///         confirms (~60s) on graduation buys and the UX regression is
    ///         exactly what we shipped this feature to prevent.
    function test_phase1_fits_in_small_block() public {
        (address tokenAddr,) = _launchToken();
        _buyNoFinalize(tokenAddr, trader, _ltStageBeforeGraduation());
        lt.setExchangeRate(_ratePumpForStagedGraduation());

        // Measure JUST the graduating buy. The earlier `_buyNoFinalize` calls
        // are warm-up to put the token in graduating range.
        uint256 trigger = _ltGraduationTrigger();
        lt.mintDirect(trader2, trigger);
        vm.startPrank(trader2);
        lt.approve(address(curveRouter), trigger);
        uint256 gasBefore = gasleft();
        bonding.buy(trigger, tokenAddr, 0, trader2);
        uint256 gasUsed = gasBefore - gasleft();
        vm.stopPrank();

        assertTrue(bonding.isGraduating(tokenAddr), "test setup: should have entered graduating");

        // 1.8M leaves comfortable headroom under the ~2M small-block ceiling
        // (Foundry overhead can add 100-200k vs real chain, so this is
        // intentionally conservative).
        assertLt(gasUsed, 1_800_000, "graduating buy must fit in HyperEVM small block");
    }
}
