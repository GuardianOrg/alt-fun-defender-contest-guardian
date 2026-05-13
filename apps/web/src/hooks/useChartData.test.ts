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

  it("opens a new candle at bucket boundary carrying the prev close forward", () => {
    // A trade event whose timestamp crosses a candle boundary. The new
    // bucket's `open` must anchor to the previous bucket's `close` so
    // the trade renders as a candle body (open at pre-trade close,
    // close at post-trade price) instead of a flat doji at the
    // post-trade price with a vertical gap. Mirrors the synthetic
    // bucket-boundary tick the API's `buildPriceTimeline` injects
    // (PRs #662 / #664). Without it, the live update path produced
    // the "small horizontal lines instead of full candles" bug for
    // any trade that beat the next LtTicker WS tick across the
    // boundary — refreshing fixed it because the snapshot pass on
    // the server is already boundary-corrected.
    const bucketA = 1_700_000_100;
    const bucketB = bucketA + CANDLE_SEC;
    const prev = [candle(bucketA, 100, 110, 95, 105)];

    const result = mergePriceIntoCandles(prev, 115, bucketB + 5, CANDLE_SEC);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(prev[0]);
    expect(result[1].time).toBe(bucketB);
    expect(result[1].open).toBe(105); // prev close — carry-forward
    expect(result[1].high).toBe(115);
    expect(result[1].low).toBe(105);
    expect(result[1].close).toBe(115);
  });

  it("carries prev close as the new bucket's low when the new value is above it", () => {
    // Buy across a bucket boundary: post-trade value > pre-trade close.
    // `open === low === prev close`, `high === close === post-trade`.
    // Same litmus test the API uses in `chart.test.ts` to distinguish
    // the real fix from a cosmetic `open = prevClose` post-process
    // (the intra-candle low must reflect the pre-trade carry-forward,
    // not the post-trade price).
    const bucketA = 1_700_000_100;
    const bucketB = bucketA + CANDLE_SEC;
    const prev = [candle(bucketA, 100, 110, 95, 105)];

    const result = mergePriceIntoCandles(prev, 200, bucketB + 5, CANDLE_SEC);

    expect(result[1].open).toBe(105);
    expect(result[1].low).toBe(105);
    expect(result[1].high).toBe(200);
    expect(result[1].close).toBe(200);
  });

  it("carries prev close as the new bucket's high when the new value is below it", () => {
    // Sell across a bucket boundary: post-trade value < pre-trade close.
    // Mirror of the buy case — `open === high === prev close`,
    // `low === close === post-trade`.
    const bucketA = 1_700_000_100;
    const bucketB = bucketA + CANDLE_SEC;
    const prev = [candle(bucketA, 100, 110, 95, 105)];

    const result = mergePriceIntoCandles(prev, 80, bucketB + 5, CANDLE_SEC);

    expect(result[1].open).toBe(105);
    expect(result[1].high).toBe(105);
    expect(result[1].low).toBe(80);
    expect(result[1].close).toBe(80);
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
    // Carry-forward still applies across multi-bucket gaps: the next
    // real tick after a quiet period opens at the most recent known
    // price, then closes at the new value. A boundary-collapsed `open`
    // here would reproduce the same horizontal-line-with-no-body bug
    // for tokens that sat idle for several intervals before someone
    // traded again.
    expect(result[1].open).toBe(105);
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
  // indexer's pre-buy candle. The fix overlays the latest live price onto
  // the snapshot's tail before handing it to the chart — this test pins that
  // the overlay restores the buy's high/close when the snapshot lags.
  it("overlay preserves the live buy candle when the snapshot tail is stale", () => {
    const bucketTs = 1_700_000_100;
    // What the indexer returned in the snapshot — the buy hasn't landed there
    // yet, so the "latest" candle is still pre-buy and almost flat.
    const stale = [candle(bucketTs, 100, 101, 99, 100)];
    // What the WS already reflects locally — a chunky buy spiking close to 150.
    const livePrice = 150;

    const overlaid = mergePriceIntoCandles(
      stale,
      livePrice,
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

  // Regression for the live-mode reappearance of the issue PRs #662 / #664
  // killed on the API side: a trade WS event whose block timestamp lands
  // in a new bucket before the next ~1 s LtTicker tick crosses the
  // boundary. On 5 s / 15 s / 30 s candles the trade callback regularly
  // wins the JS-event-loop race against the rate tick, so the new bucket
  // is opened by the trade — collapsing `open` to the post-trade price
  // unless we carry forward. The user sees the prior bucket's close at
  // the pre-trade price and the new bucket as a flat horizontal segment
  // at the post-trade price, with a vertical gap between them ("small
  // horizontal lines instead of full candles"). A refresh used to mask
  // it because the server backfill is already boundary-corrected.
  it("buy WS tick crossing a 5s bucket boundary opens at pre-trade close, not post-trade price", () => {
    const SHORT_CANDLE_SEC = 5;
    const bucketA = 1_700_000_100;
    const bucketB = bucketA + SHORT_CANDLE_SEC;
    // Pre-trade candle: open/close/high/low all around 100.
    const prev = [candle(bucketA, 100, 100, 100, 100)];
    // Post-trade price (8× spike) arriving in bucketB. The live tick
    // crosses the bucket boundary first.
    const POST_TRADE = 800;

    const result = mergePriceIntoCandles(
      prev,
      POST_TRADE,
      bucketB + 1,
      SHORT_CANDLE_SEC,
    );

    expect(result).toHaveLength(2);
    expect(result[1].time).toBe(bucketB);
    // The decisive assertion: `open === low` at the pre-trade carry-
    // forward price, `high === close` at the post-trade price. A naive
    // "open = post-trade" implementation would set open === low === high
    // === close === 800, producing the flat doji the user reported.
    expect(result[1].open).toBe(100);
    expect(result[1].low).toBe(100);
    expect(result[1].high).toBe(POST_TRADE);
    expect(result[1].close).toBe(POST_TRADE);
  });

  it("sell WS tick crossing a bucket boundary opens at pre-trade close, not post-trade price", () => {
    const bucketA = 1_700_000_100;
    const bucketB = bucketA + CANDLE_SEC;
    const prev = [candle(bucketA, 100, 100, 100, 100)];
    const POST_TRADE = 50;

    const result = mergePriceIntoCandles(
      prev,
      POST_TRADE,
      bucketB + 1,
      CANDLE_SEC,
    );

    expect(result).toHaveLength(2);
    // Mirror of the buy case: `open === high` at the pre-trade carry-
    // forward price, `low === close` at the post-trade price.
    expect(result[1].open).toBe(100);
    expect(result[1].high).toBe(100);
    expect(result[1].low).toBe(POST_TRADE);
    expect(result[1].close).toBe(POST_TRADE);
  });

  it("trade WS tick exactly on a bucket boundary opens at pre-trade close, not post-trade price", () => {
    // The PR #664 exact-boundary case ported to the live aggregator.
    // `nowSec === bucketB` (an integer-second trade that happens to
    // land exactly on a candle edge — ~20% of trades on 5 s candles,
    // ~1.7% on 60 s). Without the carry-forward the trade defines the
    // new bucket's `open` outright. The chart shows the same flat
    // doji + vertical gap as the off-boundary case.
    const SHORT_CANDLE_SEC = 5;
    const bucketA = 1_700_000_100;
    const bucketB = bucketA + SHORT_CANDLE_SEC;
    const prev = [candle(bucketA, 100, 100, 100, 100)];
    const POST_TRADE = 400;

    const result = mergePriceIntoCandles(
      prev,
      POST_TRADE,
      bucketB,
      SHORT_CANDLE_SEC,
    );

    expect(result).toHaveLength(2);
    expect(result[1].time).toBe(bucketB);
    expect(result[1].open).toBe(100);
    expect(result[1].low).toBe(100);
    expect(result[1].high).toBe(POST_TRADE);
    expect(result[1].close).toBe(POST_TRADE);
  });

  it("LtTicker rate tick crossing a boundary leaves the new bucket linked to the prev close", () => {
    // The same boundary-roll path also fires for pure rate-driven ticks
    // (no trade) — the LT WebSocket pushes a refreshed exchange rate
    // every ~1 s, which `applyLivePrice` folds in as `ratio × rate`.
    // Even with a tiny rate delta the new bucket must anchor to the
    // previous close (not the post-tick value) so an immediately-
    // following intra-bucket trade widens high/low against the
    // pre-tick price, matching what `buildPriceTimeline` does on the
    // server when an LT sample is the bucket's first event.
    const bucketA = 1_700_000_100;
    const bucketB = bucketA + CANDLE_SEC;
    const prev = [candle(bucketA, 100, 100, 100, 100)];
    const TICK = 100.5;

    const result = mergePriceIntoCandles(prev, TICK, bucketB + 1, CANDLE_SEC);

    expect(result).toHaveLength(2);
    expect(result[1].open).toBe(100);
    expect(result[1].low).toBe(100);
    expect(result[1].high).toBe(TICK);
    expect(result[1].close).toBe(TICK);
  });
});
