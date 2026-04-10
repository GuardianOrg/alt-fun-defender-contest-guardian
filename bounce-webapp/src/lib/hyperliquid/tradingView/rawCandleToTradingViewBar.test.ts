import { describe, expect, it } from "vitest";

import {
  rawHyperliquidCandleToTradingViewBar,
  sortAndMergeBarsByTime,
} from "./rawCandleToTradingViewBar";

describe("rawHyperliquidCandleToTradingViewBar", () => {
  it("keeps HL time in ms for TradingView Bar", () => {
    const b = rawHyperliquidCandleToTradingViewBar({
      t: 1_700_000_000_000,
      o: "10",
      h: "11",
      l: "9",
      c: "10.5",
    });
    expect(b).toEqual({
      time: 1_700_000_000_000,
      open: 10,
      high: 11,
      low: 9,
      close: 10.5,
    });
  });
});

describe("sortAndMergeBarsByTime", () => {
  it("sorts ascending and keeps the last bar when times collide", () => {
    const out = sortAndMergeBarsByTime([
      { time: 3000, open: 1, high: 1, low: 1, close: 1 },
      { time: 1000, open: 2, high: 2, low: 2, close: 2 },
      { time: 1000, open: 3, high: 3, low: 3, close: 3 },
    ]);
    expect(out.map((b) => b.time)).toEqual([1000, 3000]);
    expect(out[0].close).toBe(3);
  });
});
