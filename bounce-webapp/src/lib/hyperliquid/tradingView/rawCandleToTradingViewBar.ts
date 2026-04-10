import type { Bar } from "../../../../public/charting_library/datafeed-api";
import type { RawHyperliquidCandle } from "../candleSnapshot";

/**
 * TradingView expects `Bar.time` in **UTC milliseconds** (see `datafeed-api.d.ts`).
 * Hyperliquid `t` is already candle open time in ms.
 */
export function rawHyperliquidCandleToTradingViewBar(
  raw: RawHyperliquidCandle,
): Bar {
  return {
    time: raw.t,
    open: Number(raw.o),
    high: Number(raw.h),
    low: Number(raw.l),
    close: Number(raw.c),
  };
}

/** Ascending by `time`; if the same `time` appears twice, keep the last row. */
export function sortAndMergeBarsByTime(bars: Bar[]): Bar[] {
  if (bars.length <= 1) return bars;
  const sorted = [...bars].sort((a, b) => a.time - b.time);
  const out: Bar[] = [];
  for (const b of sorted) {
    const prev = out.at(-1);
    if (prev && prev.time === b.time) {
      out[out.length - 1] = b;
    } else {
      out.push(b);
    }
  }
  return out;
}
