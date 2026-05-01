// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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

        (uint256 tokensForLP, uint256 ltFromPair, uint256 lpBurned, uint256 unsoldBurned, uint64 pendingSince) =
            bonding.pendingGraduation(tokenAddr);

        assertTrue(tokensForLP > 0, "tokensForLP must be cached for phase 2");
        assertTrue(ltFromPair > 0, "ltFromPair must be cached");
        assertTrue(unsoldBurned + lpBurned > 0, "at least one of unsold/lpBurned must be > 0");
        assertEq(pendingSince, uint64(block.timestamp));
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

        (uint256 tokensForLP, uint256 ltFromPair,,, uint64 pendingSince) = bonding.pendingGraduation(tokenAddr);
        assertEq(tokensForLP, 0);
        assertEq(ltFromPair, 0);
        assertEq(pendingSince, 0);
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

        (uint256 tokensForLP, uint256 ltFromPair,,,) = bonding.pendingGraduation(tokenAddr);
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
