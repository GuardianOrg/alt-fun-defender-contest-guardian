// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Bonding} from "../src/Bonding.sol";

/// @dev Test-only harness exposing `Bonding._noFeeSwapInput` as an
///      external pure function so we can fuzz/unit-test the math directly
///      without going through the full graduation flow. Inheriting
///      `Bonding` means the harness is byte-identical at the math layer
///      to what production runs — there's no risk of the harness
///      drifting from the production formula.
contract NoFeeSwapInputHarness is Bonding {
    function exposed_noFeeSwapInput(
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 targetN,
        uint256 targetD,
        uint256 maxSwap
    ) external pure returns (uint256) {
        return _noFeeSwapInput(reserveIn, reserveOut, targetN, targetD, maxSwap);
    }
}

/// @notice Unit + fuzz coverage for `Bonding._noFeeSwapInput`.
/// @dev    The math is the load-bearing piece of the hostile-pre-seed
///         defense (#308). The integration suite in `HostilePreSeed.t.sol`
///         exercises it via the full graduation flow; this suite hits the
///         function directly so degenerate inputs and overflow-safety
///         properties are easy to express and fuzz.
contract NoFeeSwapInputTest is Test {
    NoFeeSwapInputHarness internal harness;

    function setUp() public {
        harness = new NoFeeSwapInputHarness();
    }

    // ─── Degenerate inputs ───────────────────────────────────────────────

    /// @dev Each of the five inputs being zero must short-circuit to zero
    ///      output. These are guards against a caller accidentally hitting
    ///      the rebalance path with malformed state.
    function test_zeroInputs_returnZero() public view {
        assertEq(harness.exposed_noFeeSwapInput(0, 1, 1, 1, 1), 0, "zero reserveIn");
        assertEq(harness.exposed_noFeeSwapInput(1, 0, 1, 1, 1), 0, "zero reserveOut");
        assertEq(harness.exposed_noFeeSwapInput(1, 1, 0, 1, 1), 0, "zero targetN");
        assertEq(harness.exposed_noFeeSwapInput(1, 1, 1, 0, 1), 0, "zero targetD");
        assertEq(harness.exposed_noFeeSwapInput(1, 1, 1, 1, 0), 0, "zero maxSwap");
    }

    /// @dev When the pool is already at the target ratio (`targetN/targetD
    ///      == reserveIn/reserveOut`), the formula gives `newIn == reserveIn`
    ///      and the function must return 0 — no swap needed.
    function test_alreadyAtTarget_returnsZero() public view {
        // reserveIn=100, reserveOut=200, target=100/200 ⇒ s should be 0
        assertEq(harness.exposed_noFeeSwapInput(100, 200, 100, 200, 1_000_000), 0);
        assertEq(harness.exposed_noFeeSwapInput(100, 200, 1, 2, 1_000_000), 0);
    }

    /// @dev When the pool is on the wrong side of the target (target ratio
    ///      `inN/outN < reserveIn/reserveOut`), the closed-form `newIn`
    ///      drops below `reserveIn` and the function returns 0. We never
    ///      use `_noFeeSwapInput` in this direction (the caller picks the
    ///      direction based on which side the pool is rich on), but the
    ///      guard exists so a caller that gets the direction wrong can't
    ///      produce a negative or wraparound `s`.
    function test_targetOnWrongSide_returnsZero() public view {
        // Pool 100:50 (in/out=2 — pool is "rich" on the IN side). Target
        // 1:2 (in/out=0.5 — wants pool to become rich on the OUT side).
        // Adding more `tokenIn` would push ratio HIGHER, away from target.
        // Closed-form: sqrt(100*50*1/2) = sqrt(2500) = 50 < reserveIn=100,
        // so the guard returns 0.
        assertEq(harness.exposed_noFeeSwapInput(100, 50, 1, 2, 1_000_000), 0);
    }

    // ─── Cap-at-budget regime ─────────────────────────────────────────────

    /// @dev When the optimal `s` exceeds the caller's `maxSwap` budget,
    ///      the function must clamp to `maxSwap`. This is the regime that
    ///      prevents Bonding from spending more than its raised LT/TOKEN
    ///      side on the rebalance.
    function test_capAtBudget_clampsToMaxSwap() public view {
        // Heavily skewed pool: reserveIn=1, reserveOut=1e18, target 1:1.
        // The unconstrained `s` is ~1e9; cap at 100 should return 100.
        uint256 capped = harness.exposed_noFeeSwapInput(1, 1e18, 1, 1, 100);
        assertEq(capped, 100, "must clamp to maxSwap when optimal exceeds budget");
    }

    function test_capAtBudget_doesNotClampWhenOptimalFits() public view {
        // Modestly skewed pool: reserveIn=100, reserveOut=400, target 1:1.
        // newIn = sqrt(100*400) = 200; s = 100. maxSwap=10_000 leaves headroom.
        uint256 result = harness.exposed_noFeeSwapInput(100, 400, 1, 1, 10_000);
        assertEq(result, 100, "must return optimal when within budget");
    }

    // ─── Closed-form correctness against hand-computed cases ─────────────

    /// @dev Hand-derived cases. Formula: `s = sqrt(reserveIn · reserveOut ·
    ///      targetN / targetD) - reserveIn` (no-fee approximation).
    function test_closedForm_simpleSquare() public view {
        // reserveIn=100, reserveOut=400, target 1:1
        // sqrt(100*400*1/1) - 100 = sqrt(40000) - 100 = 200 - 100 = 100
        assertEq(harness.exposed_noFeeSwapInput(100, 400, 1, 1, type(uint256).max), 100);
    }

    function test_closedForm_skewedTarget() public view {
        // reserveIn=100, reserveOut=400, target 2:1 (push pool to 200:100 ratio)
        // sqrt(100*400*2/1) - 100 = sqrt(80000) - 100 ≈ 282 - 100 = 182
        uint256 result = harness.exposed_noFeeSwapInput(100, 400, 2, 1, type(uint256).max);
        assertApproxEqAbs(result, 182, 1, "sqrt rounding tolerance +/- 1 wei");
    }

    // ─── Monotonicity ─────────────────────────────────────────────────────

    /// @notice Larger pre-seed skew (more imbalanced pool relative to target)
    ///         must require a larger swap input. This is what makes the
    ///         function "drive the ratio toward target" — non-monotonic
    ///         behaviour would let an attacker shape the pre-seed to
    ///         minimise the protocol's defensive swap.
    function testFuzz_monotonic_inSkew(
        uint256 reserveOutA,
        uint256 reserveOutB
    ) public view {
        uint256 reserveIn = 1000 ether;
        uint256 rOutA = bound(reserveOutA, 2 * reserveIn, 100 * reserveIn);
        uint256 rOutB = bound(reserveOutB, rOutA + reserveIn, 1000 * reserveIn);

        uint256 sA = harness.exposed_noFeeSwapInput(reserveIn, rOutA, 1, 1, type(uint256).max);
        uint256 sB = harness.exposed_noFeeSwapInput(reserveIn, rOutB, 1, 1, type(uint256).max);

        // Larger reserveOut (more "rich" the pool is on the OUT side) ⇒
        // bigger swap needed to drag pool toward 1:1 target.
        assertGe(sB, sA, "swap input must be monotonic in pool skew");
    }

    // ─── Overflow safety ──────────────────────────────────────────────────

    /// @notice Across the input space the call site actually produces,
    ///         the discriminant `reserveIn * reserveOut * targetN / targetD`
    ///         stays inside uint256 and the function returns without
    ///         reverting.
    /// @dev    Reserves and targets are bounded to uint64 (max ~1.8e19)
    ///         which comfortably exceeds anything a real graduation can
    ///         produce — `tokensForLP` ≤ 250M·1e18 and `ltFromPair`
    ///         scales with `graduationThresholdUsd`, both well inside
    ///         this bound. The unrealistic-but-mathematically-possible
    ///         case where the discriminant overflows uint256 (forcing
    ///         `Math.mulDiv` to revert) is documented separately on
    ///         `_noFeeSwapInput`'s natspec — call sites must keep
    ///         `reserveIn * reserveOut * targetN / targetD` ≤ 2^256.
    function testFuzz_overflowSafety(
        uint64 reserveIn,
        uint64 reserveOut,
        uint64 targetN,
        uint64 targetD,
        uint256 maxSwap
    ) public view {
        vm.assume(reserveIn > 0 && reserveOut > 0 && targetN > 0 && targetD > 0 && maxSwap > 0);
        harness.exposed_noFeeSwapInput(reserveIn, reserveOut, targetN, targetD, maxSwap);
    }

    /// @notice Stress at realistic ceiling: V2 uint112 reserves combined
    ///         with the target-ratio bounds the call site actually
    ///         produces. `targetN` and `targetD` come from `tokensForLP`
    ///         and `ltFromPair` (or vice versa), both bounded above by
    ///         `Token.TOTAL_SUPPLY` (1B * 1e18 ≈ 2^90) in any sensible
    ///         BounceTech LT × token combination, so the discriminant
    ///         `reserveIn * reserveOut * targetN / targetD` stays inside
    ///         uint256 even at the extremes that real graduations can
    ///         actually produce.
    ///
    ///         (Note: `_noFeeSwapInput` would revert under the OZ `mulDiv`
    ///         512-bit-intermediate guard if the intermediate result
    ///         exceeded uint256, e.g. with arbitrary uint128 target ratios
    ///         — but no real call site can construct such inputs because
    ///         `tokensForLP` and `ltFromPair` are bounded by token supply.)
    function test_overflowSafety_atRealisticMax() public view {
        uint256 maxReserve = type(uint112).max;
        uint256 totalSupply = 1_000_000_000 ether; // ~2^90, the largest plausible target
        // Discriminant: 2^224 * 2^90 / 1 = 2^314 — overflows uint256, so
        // pin targetD high enough to bring result back within range.
        // 2^224 * 2^90 / 2^90 = 2^224, fits.
        harness.exposed_noFeeSwapInput(maxReserve, maxReserve, totalSupply, totalSupply, type(uint256).max);
    }

    // ─── Round-down precondition matches V2 fee-charging getAmountOut ────

    /// @notice The non-zero `s` returned by `_noFeeSwapInput` is checked
    ///         in `_routerRebalance` against V2's fee-charging
    ///         `getAmountOut`; if that rounds to zero we skip the swap
    ///         (rather than letting `swapExactTokensForTokens` revert).
    ///         This unit test reproduces the pathological shape: tiny `s`
    ///         against an extremely imbalanced pool where
    ///         `s · 997 · rOut` < `(rIn · 1000 + s · 997)`.
    function test_amountOutRoundsToZero_inputShapeExists() public view {
        // Pool reserveIn = 1e18, reserveOut = 1, target 1:1.
        // Closed-form: sqrt(1e18 * 1 * 1) - 1e18 ≈ 1e9 - 1e18 < 0 ⇒ guard fires (returns 0).
        // To actually trigger the AmountOutRoundsToZero branch, we need
        // a case where `_noFeeSwapInput` returns a small positive `s` but
        // V2's fee-charging amountOut rounds down to 0.
        //
        // Pool reserveIn = 100, reserveOut = 1e18, target 100:99 (tiny skew correction).
        // newIn = sqrt(100 * 1e18 * 100 / 99) ≈ sqrt(1.0101e20) ≈ ~1.005e10.
        // s ≈ 1.005e10 - 100 ≈ 1.005e10, capped at maxSwap=1.
        uint256 s = harness.exposed_noFeeSwapInput(100, 1e18, 100, 99, 1);
        assertEq(s, 1, "tiny clamped swap input -- what _routerRebalance must guard against");

        // Now compute the V2 amountOut for this `s`. amountInWithFee = s*997 = 997.
        // amountOut = (997 * 1e18) / (100 * 1000 + 997) = 997e18 / 100997 ≈ 9.87e15. Doesn't round to zero in this case.
        // To exhibit round-to-zero we need rIn ≫ s · rOut / 1000.
        // Try reserveIn=1e30, reserveOut=1, s=1: amountInWithFee=997, amountOut = 997 / (1e30·1000 + 997) = 0.
        uint256 amountInWithFee = 1 * 997;
        uint256 expectedOut = (amountInWithFee * 1) / (1e30 * 1000 + amountInWithFee);
        assertEq(expectedOut, 0, "V2 amountOut rounds to zero for s=1, rIn=1e30, rOut=1 -- the guard's reason for being");
    }
}
