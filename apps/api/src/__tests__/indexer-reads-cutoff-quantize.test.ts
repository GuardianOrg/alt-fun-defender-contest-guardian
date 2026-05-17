import { describe, expect, it } from "vitest";

import { quantizeTrailing24hCutoffSec } from "../lib/indexer-reads.js";

// Issue #1035: the helper backs the trailing-24h cutoff used by
// `fetchHistoricalCurveSnapshots` and `fetchRouterTradeActivity`. The DB
// win is that the parameter stays constant for the full 30s bucket, so
// these tests pin the exact bucket math — drift here regresses the
// prepared-plan reuse the change exists to deliver.

const BUCKET = 30;
// `1_700_000_010` is divisible by 30, so `nowSec - 86_400 = 1_699_913_610`
// is already 30s-aligned and the floor is a no-op.
const NOW_ON_BUCKET = 1_700_000_010;
const CUTOFF_ON_BUCKET = NOW_ON_BUCKET - 86_400;

describe("quantizeTrailing24hCutoffSec", () => {
  it("subtracts 86400 then floors to the 30s bucket", () => {
    expect(quantizeTrailing24hCutoffSec(NOW_ON_BUCKET)).toBe(CUTOFF_ON_BUCKET);
    // The raw value is itself a bucket boundary in this case — confirms
    // the assertion above is using genuinely aligned arithmetic and not
    // an off-by-one coincidence.
    expect(CUTOFF_ON_BUCKET % BUCKET).toBe(0);
  });

  it("floors mid-bucket inputs to the bucket start (drift never exceeds 30s)", () => {
    // 1s into the bucket — still floors to the bucket start.
    expect(quantizeTrailing24hCutoffSec(NOW_ON_BUCKET + 1)).toBe(CUTOFF_ON_BUCKET);
    // 29s into the bucket — still floors to the bucket start.
    expect(quantizeTrailing24hCutoffSec(NOW_ON_BUCKET + 29)).toBe(CUTOFF_ON_BUCKET);
    // 30s in — bucket flips.
    expect(quantizeTrailing24hCutoffSec(NOW_ON_BUCKET + 30)).toBe(
      CUTOFF_ON_BUCKET + BUCKET,
    );
  });

  it("returns the same cutoff for every input inside the same 30s bucket", () => {
    // Property: any two inputs whose `floor(t / 30)` matches must produce
    // the same cutoff. That's the whole point of the change.
    const cutoff = quantizeTrailing24hCutoffSec(NOW_ON_BUCKET);
    for (let offset = 0; offset < BUCKET; offset++) {
      expect(quantizeTrailing24hCutoffSec(NOW_ON_BUCKET + offset)).toBe(cutoff);
    }
    // First input of the next bucket must differ.
    expect(quantizeTrailing24hCutoffSec(NOW_ON_BUCKET + BUCKET)).not.toBe(cutoff);
  });

  it("never exceeds nowSec - 86_400 (window is always ≥24h, never <24h)", () => {
    // Front-end labels this "24h"; the window can be 24h..24h+30s but
    // must never be narrower than 24h. Floor guarantees `result ≤ raw`.
    for (let nowSec = NOW_ON_BUCKET; nowSec < NOW_ON_BUCKET + 120; nowSec += 7) {
      const raw = nowSec - 86_400;
      const quantised = quantizeTrailing24hCutoffSec(nowSec);
      expect(quantised).toBeLessThanOrEqual(raw);
      expect(raw - quantised).toBeLessThan(BUCKET);
    }
  });
});
