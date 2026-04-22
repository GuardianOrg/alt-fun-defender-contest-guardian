import { describe, expect, it } from "vitest";

import { usdcRawToUsd } from "../lib/token-enrich.js";

describe("usdcRawToUsd", () => {
  it("returns null for null / undefined so callers can tell `unknown` apart from `0`", () => {
    expect(usdcRawToUsd(null)).toBeNull();
    expect(usdcRawToUsd(undefined)).toBeNull();
  });

  it("returns 0 when the indexer counter is zero", () => {
    expect(usdcRawToUsd("0")).toBe(0);
  });

  it("converts 6dp USDC fixed-point into dollars", () => {
    expect(usdcRawToUsd("1000000")).toBe(1);
    expect(usdcRawToUsd("12500000")).toBe(12.5);
    expect(usdcRawToUsd("7500123")).toBeCloseTo(7.500123, 6);
  });

  it("stays dollar-exact well past Number.MAX_SAFE_INTEGER raw (~$9T)", () => {
    // 10^19 raw = $10T — already past the naive safe boundary (≈ 9e15 = $9T).
    // Splitting the bigint into whole dollars before casting means the
    // dollar part stays exact until it itself exceeds 2^53 ≈ 9e15 dollars
    // (= ~$9 quadrillion), giving us ~1000× more headroom than the naive
    // `Number(BigInt(raw)) / 1e6` approach.
    expect(usdcRawToUsd("10000000000000000000")).toBe(10_000_000_000_000);

    // And each whole-dollar increment is still preserved in that range,
    // instead of rounding to the nearest representable double.
    expect(usdcRawToUsd("10000000000001000000")).toBe(10_000_000_000_001);
  });

  it("is monotonic across increasing raw counter values near the precision boundary", () => {
    // Regression guard: if we ever swap back to a lossy conversion, this
    // invariant breaks because adjacent increments collapse to the same
    // double. Walk a strictly-increasing ladder that straddles the $9T
    // Number.MAX_SAFE_INTEGER boundary with dollar-scale increments.
    const base = 10n ** 19n;
    const deltas = [0n, 1_000_000n, 2_000_000n, 10n ** 12n, 10n ** 15n];
    let prev: number | null = null;
    for (const delta of deltas) {
      const next = usdcRawToUsd((base + delta).toString());
      expect(next).not.toBeNull();
      if (prev !== null) {
        expect(next!).toBeGreaterThan(prev);
      }
      prev = next;
    }
  });
});
