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

        // 1 LT and 3x the curve-close-ratio of token: meaningfully token-rich,
        // so the rebalance swap fires with a non-trivial input and output.
        uint256 reserveLt = 1 ether;
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
