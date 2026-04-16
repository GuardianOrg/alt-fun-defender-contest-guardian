import { describe, it, expect } from "vitest";

import { seedBuyStats, usdcForSupplyPct } from "./seedBuyMath";

describe("seedBuyStats", () => {
  it("returns zeros for zero input", () => {
    const stats = seedBuyStats(0);
    expect(stats.tokensReceived).toBe(0);
    expect(stats.supplyPct).toBe(0);
    expect(stats.curveFilled).toBe(0);
  });

  it("returns zeros for negative input", () => {
    const stats = seedBuyStats(-10);
    expect(stats.tokensReceived).toBe(0);
    expect(stats.supplyPct).toBe(0);
    expect(stats.curveFilled).toBe(0);
  });

  it("computes correct stats for a small buy", () => {
    // $100 USDC input
    // usdcAfterFee = 100 * 0.995 = 99.5
    // tokensOut = 750_000_000 * 99.5 / (3000 + 99.5) = 74_625_000_000 / 3099.5
    // supplyPct = tokensOut / 1_000_000_000 * 100
    const stats = seedBuyStats(100);
    expect(stats.tokensReceived).toBeCloseTo(24_076_464, -2);
    expect(stats.supplyPct).toBeCloseTo(2.408, 2);
    expect(stats.curveFilled).toBeCloseTo(0.829, 2);
  });

  it("round-trips with usdcForSupplyPct", () => {
    for (const pct of [0.5, 1, 2, 3, 5, 10, 25, 50]) {
      const usdc = usdcForSupplyPct(pct);
      const stats = seedBuyStats(usdc);
      expect(stats.supplyPct).toBeCloseTo(pct, 6);
    }
  });

  it("approaches 75% asymptotically for very large amounts", () => {
    const stats = seedBuyStats(1_000_000);
    expect(stats.supplyPct).toBeLessThan(75);
    expect(stats.supplyPct).toBeGreaterThan(74);
  });

  it("curve filled is proportional to after-fee USDC vs graduation threshold", () => {
    const stats = seedBuyStats(12000 / 0.995); // after fee = $12,000
    expect(stats.curveFilled).toBeCloseTo(100, 4);
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
    // usdcAfterFee = 3000 * 1 / (75 - 1) = 3000/74 ≈ 40.54
    // usdcAmount = 40.54 / 0.995 ≈ 40.74
    const usdc = usdcForSupplyPct(1);
    expect(usdc).toBeCloseTo(40.74, 1);
  });

  it("computes correct USDC for 5% of supply", () => {
    // usdcAfterFee = 3000 * 5 / (75 - 5) = 15000/70 ≈ 214.29
    // usdcAmount = 214.29 / 0.995 ≈ 215.36
    const usdc = usdcForSupplyPct(5);
    expect(usdc).toBeCloseTo(215.36, 1);
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
