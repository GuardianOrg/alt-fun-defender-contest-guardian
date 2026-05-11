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
    // Brand-new-token edge case: candles span ~$20 around a $20k mcap
    // (0.1% — essentially zero movement). The 0.5% floor should kick in
    // and widen the range to ±0.25% around the midpoint so the candles
    // don't render as a single flat line glued to the price axis.
    const result = minSpanAutoscaleProvider(() =>
      makeInfo(19_990, 20_010),
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
    // Typical token: a 5% span ($1k around $20k mcap) is well above the
    // 0.5% floor, so the provider passes the original range through and
    // lets lightweight-charts autoscale fill ~80% of the chart height.
    // Regression guard against the previous 30% floor, which would have
    // padded this case out to a 30% band and compressed the real 5%
    // movement into a small squiggle in the middle of the canvas.
    const original = makeInfo(19_500, 20_500);
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
    // Same shape as the brand-new-token case but in per-token USD price
    // scale (Price toggle). The fraction-based floor should produce a
    // 0.5% span around the midpoint regardless of magnitude.
    const result = minSpanAutoscaleProvider(() =>
      makeInfo(0.00001999, 0.00002001),
    );
    const midpoint = 0.00002;
    const span = result!.priceRange!.maxValue - result!.priceRange!.minValue;
    expect(span).toBeCloseTo(midpoint * MIN_AUTOSCALE_SPAN_FRACTION, 12);
  });
});
