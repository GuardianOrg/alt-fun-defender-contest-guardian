import { describe, it, expect } from "vitest";

import { computeChange24h, formatPrice } from "./assetService";

describe("computeChange24h", () => {
  it("computes positive change", () => {
    expect(computeChange24h(100, 105)).toBe(5);
  });

  it("computes negative change", () => {
    expect(computeChange24h(100, 92)).toBe(-8);
  });

  it("returns 0 for no change", () => {
    expect(computeChange24h(100, 100)).toBe(0);
  });

  it("rounds to two decimals", () => {
    expect(computeChange24h(3, 3.1)).toBe(3.33);
  });

  it("returns undefined when open price is zero", () => {
    expect(computeChange24h(0, 100)).toBeUndefined();
  });

  it("returns undefined when open price is negative", () => {
    expect(computeChange24h(-5, 100)).toBeUndefined();
  });

  it("handles real Hyperliquid-style values", () => {
    const open = 40.848;
    const current = 43.092;
    const result = computeChange24h(open, current);
    expect(result).toBeTypeOf("number");
    expect(result).toBeGreaterThan(0);
    expect(result).toBeCloseTo(5.49, 1);
  });
});

describe("formatPrice", () => {
  it("formats large prices with comma separator", () => {
    expect(formatPrice(74105.5)).toBe("$74,106");
  });

  it("formats mid-range prices as whole numbers", () => {
    expect(formatPrice(321.5)).toBe("$322");
  });

  it("formats small prices with 2 decimals", () => {
    expect(formatPrice(43.09)).toBe("$43.09");
  });

  it("formats sub-dollar prices with 4 decimals", () => {
    expect(formatPrice(0.0042)).toBe("$0.0042");
  });
});
