import { describe, it, expect } from "vitest";

import { seedBuyStats, usdcForSupplyPct } from "./seedBuyMath";

const THRESHOLD = 12_000;

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
    // $100 USDC input
    // usdcAfterFee = 100 * 0.995 = 99.5
    // rawTokens  = 1_000_000_000 * 99.5 / (4000 + 99.5) = 99_500_000_000 / 4099.5 ≈ 24_271_252
    // (well below the 750M real-balance cap)
    // supplyPct  = rawTokens / 1_000_000_000 * 100
    const stats = seedBuyStats(100, THRESHOLD);
    expect(stats.tokensReceived).toBeCloseTo(24_271_252, -2);
    expect(stats.supplyPct).toBeCloseTo(2.427, 2);
    expect(stats.curveFilled).toBeCloseTo(0.829, 2);
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
    // usdcAfterFee = 4000 * 1 / (100 - 1) = 4000/99 ≈ 40.40
    // usdcAmount = 40.40 / 0.995 ≈ 40.61
    const usdc = usdcForSupplyPct(1);
    expect(usdc).toBeCloseTo(40.61, 1);
  });

  it("computes correct USDC for 5% of supply", () => {
    // usdcAfterFee = 4000 * 5 / (100 - 5) = 20000/95 ≈ 210.53
    // usdcAmount = 210.53 / 0.995 ≈ 211.58
    const usdc = usdcForSupplyPct(5);
    expect(usdc).toBeCloseTo(211.58, 1);
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
