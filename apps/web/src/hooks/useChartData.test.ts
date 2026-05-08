import { describe, it, expect } from "vitest";

import { mergePriceIntoCandles } from "./useChartData";

import type { CandlestickData, Time } from "lightweight-charts";

const CANDLE_SEC = 300;

function candle(time: number, o: number, h: number, l: number, c: number): CandlestickData {
  return {
    time: time as unknown as Time,
    open: o,
    high: h,
    low: l,
    close: c,
  };
}

describe("mergePriceIntoCandles", () => {
  it("seeds a live candle when no history exists", () => {
    const now = 1_700_000_123;
    const result = mergePriceIntoCandles([], 42_000, now, CANDLE_SEC);
    expect(result).toHaveLength(1);
    expect(result[0].open).toBe(42_000);
    expect(result[0].close).toBe(42_000);
    expect(result[0].high).toBe(42_000);
    expect(result[0].low).toBe(42_000);
    expect(result[0].time).toBe(1_700_000_100);
  });

  it("merges into the in-progress candle when bucketTs matches", () => {
    const bucketTs = 1_700_000_100;
    const nowInBucket = bucketTs + 50;
    const prev = [candle(bucketTs, 100, 110, 95, 105)];

    const result = mergePriceIntoCandles(prev, 120, nowInBucket, CANDLE_SEC);

    expect(result).toHaveLength(1);
    expect(result[0].time).toBe(bucketTs);
    expect(result[0].open).toBe(100);
    expect(result[0].high).toBe(120);
    expect(result[0].low).toBe(95);
    expect(result[0].close).toBe(120);
  });

  it("widens low when new price is below prior low", () => {
    const bucketTs = 1_700_000_100;
    const prev = [candle(bucketTs, 100, 110, 95, 105)];

    const result = mergePriceIntoCandles(prev, 80, bucketTs + 10, CANDLE_SEC);

    expect(result[0].low).toBe(80);
    expect(result[0].high).toBe(110);
    expect(result[0].close).toBe(80);
    expect(result[0].open).toBe(100);
  });

  it("opens a new candle at bucket boundary", () => {
    const bucketA = 1_700_000_100;
    const bucketB = bucketA + CANDLE_SEC;
    const prev = [candle(bucketA, 100, 110, 95, 105)];

    const result = mergePriceIntoCandles(prev, 115, bucketB + 5, CANDLE_SEC);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(prev[0]);
    expect(result[1].time).toBe(bucketB);
    expect(result[1].open).toBe(115);
    expect(result[1].high).toBe(115);
    expect(result[1].low).toBe(115);
    expect(result[1].close).toBe(115);
  });

  it("rolls forward multiple buckets when ticks are skipped", () => {
    const bucketA = 1_700_000_100;
    const bucketC = bucketA + CANDLE_SEC * 3;
    const prev = [candle(bucketA, 100, 110, 95, 105)];

    const result = mergePriceIntoCandles(prev, 200, bucketC + 5, CANDLE_SEC);

    // Only two entries: the original candle plus a new bucket at bucketC.
    // Intermediate buckets are skipped — the chart pads them with whitespace.
    expect(result).toHaveLength(2);
    expect(result[1].time).toBe(bucketC);
    expect(result[1].open).toBe(200);
    expect(result[1].close).toBe(200);
  });

  it("is pure — does not mutate input", () => {
    const bucketTs = 1_700_000_100;
    const prev = [candle(bucketTs, 100, 110, 95, 105)];
    const snapshot = JSON.parse(JSON.stringify(prev));

    mergePriceIntoCandles(prev, 120, bucketTs + 10, CANDLE_SEC);

    expect(prev).toEqual(snapshot);
  });

  // Regression for issue #445: a buy candle would visually "vanish" a few
  // seconds after the trade landed. Root cause was a snapshot resync (mode
  // change or WS reconnect) replacing the in-progress live candle with the
  // indexer's pre-buy candle. The fix overlays the latest live mcap onto
  // the snapshot's tail before handing it to the chart — this test pins that
  // the overlay restores the buy's high/close when the snapshot lags.
  it("overlay preserves the live buy candle when the snapshot tail is stale", () => {
    const bucketTs = 1_700_000_100;
    // What the indexer returned in the snapshot — the buy hasn't landed there
    // yet, so the "latest" candle is still pre-buy and almost flat.
    const stale = [candle(bucketTs, 100, 101, 99, 100)];
    // What the WS already reflects locally — a chunky buy spiking close to 150.
    const liveMcap = 150;

    const overlaid = mergePriceIntoCandles(
      stale,
      liveMcap,
      bucketTs + 30,
      CANDLE_SEC,
    );

    expect(overlaid).toHaveLength(1);
    expect(overlaid[0].time).toBe(bucketTs);
    expect(overlaid[0].open).toBe(100);
    expect(overlaid[0].high).toBe(150);
    expect(overlaid[0].low).toBe(99);
    expect(overlaid[0].close).toBe(150);
  });
});
