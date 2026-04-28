import { describe, it, expect } from "vitest";

import {
  VIRTUAL_LIQUIDITY_USD,
  seedBuyStats,
  usdcForSupplyPct,
} from "./seedBuyMath";

const THRESHOLD = 12_000;
const BUY_FEE = 0.005; // 0.5% — must match seedBuyMath.ts BUY_FEE_BPS

/// Closed-form inverse of `seedBuyStats` for `supplyPct → usdcAmount`,
/// mirroring `usdcForSupplyPct` exactly. Re-derived in the test so we can
/// assert the implementation's output against an independent calculation
/// using the *current* `VIRTUAL_LIQUIDITY_USD`. If the on-chain virtual
/// liquidity dial moves, both this and the implementation move together
/// and the assertion stays meaningful.
function expectedUsdcForSupplyPct(pct: number): number {
  const usdcAfterFee = (VIRTUAL_LIQUIDITY_USD * pct) / (100 - pct);
  return usdcAfterFee / (1 - BUY_FEE);
}

describe("seedBuyStats", () => {
  it("returns zeros for zero input", () => {
    const stats = seedBuyStats(0, THRESHOLD);
    expect(stats.tokensReceived).toBe(0);
    expect(stats.supplyPct).toBe(0);
    expect(stats.curveFilled).toBe(0);
  });

  it("returns zeros for negative input", () => {
    const stats = seedBuyStats(-10, THRESHOLD);
    expect(stats.tokensReceived).toBe(0);
    expect(stats.supplyPct).toBe(0);
    expect(stats.curveFilled).toBe(0);
  });

  it("computes correct stats for a small buy", () => {
    // Re-derive expectations from `VIRTUAL_LIQUIDITY_USD` so the assertions
    // track on-chain config retunes (a hardcoded `4000` here silently
    // breaks the moment we drop virtual liquidity for tighter curves).
    //
    //   usdcAfterFee = usdcIn * (1 - feeBps)
    //   rawTokens    = TOTAL_SUPPLY * usdcAfterFee / (virtualLiquidity + usdcAfterFee)
    //
    // The `usdcIn` here is intentionally *much* smaller than virtual
    // liquidity so the curve stays in its near-linear region. We pick 1%
    // of virtual liquidity as the reference point — invariant to the
    // exact dial value.
    const usdcIn = VIRTUAL_LIQUIDITY_USD / 100;
    const usdcAfterFee = usdcIn * (1 - BUY_FEE);
    const expectedTokens =
      (1_000_000_000 * usdcAfterFee) /
      (VIRTUAL_LIQUIDITY_USD + usdcAfterFee);
    const expectedSupplyPct = (expectedTokens / 1_000_000_000) * 100;
    const expectedCurveFilled = (usdcAfterFee / THRESHOLD) * 100;

    const stats = seedBuyStats(usdcIn, THRESHOLD);
    expect(stats.tokensReceived).toBeCloseTo(expectedTokens, -2);
    expect(stats.supplyPct).toBeCloseTo(expectedSupplyPct, 4);
    expect(stats.curveFilled).toBeCloseTo(expectedCurveFilled, 4);
  });

  it("round-trips with usdcForSupplyPct", () => {
    for (const pct of [0.5, 1, 2, 3, 5, 10, 25, 50]) {
      const usdc = usdcForSupplyPct(pct);
      const stats = seedBuyStats(usdc, THRESHOLD);
      expect(stats.supplyPct).toBeCloseTo(pct, 6);
    }
  });

  it("caps at 75% (CURVE_SUPPLY) for very large amounts — matches on-chain cap", () => {
    // The uncapped parabola approaches 100% (TOTAL_SUPPLY) asymptotically, but the
    // on-chain `Router.buy` caps `tokensOut` at the pair's real balance (CURVE_SUPPLY),
    // so the UI mirrors that.
    const stats = seedBuyStats(1_000_000, THRESHOLD);
    expect(stats.supplyPct).toBeLessThanOrEqual(75);
    expect(stats.supplyPct).toBeGreaterThan(74);
  });

  it("curve filled is proportional to after-fee USDC vs graduation threshold", () => {
    const stats = seedBuyStats(THRESHOLD / 0.995, THRESHOLD); // after fee = $12,000
    expect(stats.curveFilled).toBeCloseTo(100, 4);
  });

  it("scales curve-filled with a tuned graduation threshold", () => {
    // Doubling the threshold halves curve-filled for the same buy.
    const baseline = seedBuyStats(100, THRESHOLD);
    const doubled = seedBuyStats(100, THRESHOLD * 2);
    expect(doubled.curveFilled).toBeCloseTo(baseline.curveFilled / 2, 6);
    // Token-side math is unaffected (independent of threshold).
    expect(doubled.tokensReceived).toBeCloseTo(baseline.tokensReceived, 6);
    expect(doubled.supplyPct).toBeCloseTo(baseline.supplyPct, 6);
  });

  it("returns 0 curve-filled when threshold is 0 (defensive)", () => {
    const stats = seedBuyStats(100, 0);
    expect(stats.curveFilled).toBe(0);
  });
});

describe("usdcForSupplyPct", () => {
  it("returns 0 for zero percent", () => {
    expect(usdcForSupplyPct(0)).toBe(0);
  });

  it("returns 0 for negative percent", () => {
    expect(usdcForSupplyPct(-1)).toBe(0);
  });

  it("returns 0 for >= 75% (cannot buy more than curve supply)", () => {
    expect(usdcForSupplyPct(75)).toBe(0);
    expect(usdcForSupplyPct(80)).toBe(0);
  });

  it("computes correct USDC for 1% of supply", () => {
    // Re-derive against `VIRTUAL_LIQUIDITY_USD` instead of hardcoding so
    // the test survives on-chain virtual-liquidity retunes:
    //   usdcAfterFee = virtualLiquidity * pct / (100 - pct)
    //   usdcAmount   = usdcAfterFee / (1 - buyFee)
    expect(usdcForSupplyPct(1)).toBeCloseTo(expectedUsdcForSupplyPct(1), 4);
  });

  it("computes correct USDC for 5% of supply", () => {
    expect(usdcForSupplyPct(5)).toBeCloseTo(expectedUsdcForSupplyPct(5), 4);
  });

  it("returns increasing USDC for increasing percentages (non-linear)", () => {
    const pcts = [0.5, 1, 2, 3, 5, 10, 20, 50];
    const usdcValues = pcts.map(usdcForSupplyPct);
    for (let i = 1; i < usdcValues.length; i++) {
      expect(usdcValues[i]).toBeGreaterThan(usdcValues[i - 1]);
    }

    // Verify non-linearity: going from 1% → 2% costs less than 2% → 4%
    const cost1to2 = usdcForSupplyPct(2) - usdcForSupplyPct(1);
    const cost2to4 = usdcForSupplyPct(4) - usdcForSupplyPct(2);
    expect(cost2to4).toBeGreaterThan(cost1to2);
  });
});
