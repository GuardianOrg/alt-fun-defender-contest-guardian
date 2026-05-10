import { describe, expect, it } from "vitest";

import {
  MIN_AUTOSCALE_SPAN_FRACTION,
  minSpanAutoscaleProvider,
} from "./useChart";

import type { AutoscaleInfo } from "lightweight-charts";

function makeInfo(minValue: number, maxValue: number): AutoscaleInfo {
  return { priceRange: { minValue, maxValue } };
}

describe("minSpanAutoscaleProvider", () => {
  it("widens the price range to the floor when the natural span is too tight", () => {
    // Fresh-token edge case: range is ~$1k around a $20k mcap (5% span).
    // The floor (30% of midpoint) should kick in and widen the range to
    // ±15% around the midpoint.
    const result = minSpanAutoscaleProvider(() =>
      makeInfo(19_500, 20_500),
    );
    expect(result?.priceRange).toBeDefined();
    const span = result!.priceRange!.maxValue - result!.priceRange!.minValue;
    const midpoint = 20_000;
    expect(span).toBeCloseTo(midpoint * MIN_AUTOSCALE_SPAN_FRACTION, 6);
    // Range should be centred on the midpoint.
    expect(
      (result!.priceRange!.maxValue + result!.priceRange!.minValue) / 2,
    ).toBeCloseTo(midpoint, 6);
  });

  it("returns the original info when the natural span exceeds the floor", () => {
    // Pumped token: 50% span around $20k mcap is well above the 30% floor,
    // so autoscale should be left alone.
    const original = makeInfo(15_000, 25_000);
    const result = minSpanAutoscaleProvider(() => original);
    expect(result).toBe(original);
  });

  it("returns null when the base implementation has no info", () => {
    const result = minSpanAutoscaleProvider(() => null);
    expect(result).toBeNull();
  });

  it("leaves the info untouched when the midpoint is non-positive", () => {
    // Defensive guard: a zero/negative midpoint can't be percent-scaled
    // sensibly. Skip the floor in that case.
    const original = makeInfo(-1, 1);
    const result = minSpanAutoscaleProvider(() => original);
    expect(result).toBe(original);
  });

  it("scales the floor with the underlying value (works for sub-cent prices too)", () => {
    // Same shape as above but in per-token USD price scale (Price toggle).
    // The fraction-based floor should produce a 30% span around the
    // midpoint regardless of magnitude.
    const result = minSpanAutoscaleProvider(() =>
      makeInfo(0.0000195, 0.0000205),
    );
    const midpoint = 0.00002;
    const span = result!.priceRange!.maxValue - result!.priceRange!.minValue;
    expect(span).toBeCloseTo(midpoint * MIN_AUTOSCALE_SPAN_FRACTION, 12);
  });
});
