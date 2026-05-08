import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import {
  createChart,
  CandlestickSeries,
  ColorType,
} from "lightweight-charts";

import { COLORS, rgba } from "../config/colors";
import { getChartModeConfig } from "../services/api";
import { formatPriceUsd, formatUsd } from "../utils/format";

import type { ChartMode, ChartUnit } from "../services/api";
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
  WhitespaceData,
  Time,
} from "lightweight-charts";

interface UseChartOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  candles: CandlestickData[];
  mode: ChartMode;
  loading: boolean;
  unit: ChartUnit;
}

export function useChart({
  containerRef,
  candles,
  mode,
  loading,
  unit,
}: UseChartOptions): void {
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // Track the last candle array we applied so we can distinguish a live tick
  // (last element mutated) from a full resync (mode change / refetch).
  // Live ticks use `series.update()` which is an OHLC merge — dramatically
  // cheaper than `setData()` on every 1s price tick.
  const lastCandlesRef = useRef<CandlestickData[] | null>(null);
  const lastModeKeyRef = useRef<string | null>(null);
  // True after the first non-loading effect run for a given chart instance.
  // Distinguishes "very first time we have data" (need to anchor viewport)
  // from "WS reconnect refetch" (should preserve user's current zoom/scroll).
  const hasAnchoredRef = useRef(false);

  const { windowSec, candleSec, key: modeKey } = getChartModeConfig(mode);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(234,250,244,0.22)",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: rgba(COLORS.mint, 0.05) },
        horzLines: { color: rgba(COLORS.mint, 0.05) },
      },
      crosshair: {
        vertLine: { color: rgba(COLORS.mint, 0.25) },
        horzLine: { color: rgba(COLORS.mint, 0.25) },
      },
      rightPriceScale: { borderColor: rgba(COLORS.mint, 0.1) },
      timeScale: {
        borderColor: rgba(COLORS.mint, 0.1),
        timeVisible: true,
        // Let lightweight-charts pick the right tick-mark granularity; on
        // sub-minute intervals (5s/15s/30s) it'll surface seconds, on
        // larger ones it auto-falls back to HH:MM. Hardcoding `false`
        // hid useful precision on the new sub-minute intervals.
        secondsVisible: true,
      },
    });

    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.mint,
      downColor: COLORS.red,
      borderUpColor: COLORS.mint,
      borderDownColor: COLORS.red,
      wickUpColor: COLORS.mint,
      wickDownColor: COLORS.red,
    });
    seriesRef.current = series;

    const container = containerRef.current;
    const observer = new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [containerRef]);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    if (loading) {
      seriesRef.current.setData([]);
      lastCandlesRef.current = null;
      // Reset the anchor refs so the next non-loading run is treated as a
      // fresh viewport. `TokenDetailView` reuses the same `<Chart>` instance
      // across `:address` changes (no `key` prop on the Chart component),
      // so without this, navigating from token A → B in the same interval
      // mode would skip the `isFirstAnchor || modeChanged` branch and
      // inherit token A's pan/zoom (or appear blank if B's history doesn't
      // overlap A's old visible range).
      hasAnchoredRef.current = false;
      lastModeKeyRef.current = null;
      return;
    }

    seriesRef.current.applyOptions({
      priceFormat: {
        type: "custom",
        // `mcap` mode is dollars-and-cents; `price` mode is sub-cent USD/token
        // (1B-supply tokens) so we drop the minMove floor and switch to a
        // significant-digit formatter that doesn't collapse to `$0.00`.
        formatter: unit === "price" ? formatPriceUsd : formatUsd,
        minMove: unit === "price" ? 1e-12 : 0.01,
      },
    });

    const prev = lastCandlesRef.current;
    const prevModeKey = lastModeKeyRef.current;
    // Treat an explicit user-driven mode swap as a modeChange. The very first
    // run also has `prevModeKey === null` but we handle that separately via
    // `hasAnchoredRef` so reconnect-driven resyncs don't get classified as a
    // mode change.
    const modeChanged = prevModeKey !== null && prevModeKey !== modeKey;
    const isFirstAnchor = !hasAnchoredRef.current;
    lastModeKeyRef.current = modeKey;

    // Detect whether this is a live-tick update (same anchor + non-shrinking
    // tail) vs. a full resync (mode change, initial load, reconnect).
    // On live ticks we call `series.update()` for cheap OHLC merges;
    // otherwise we re-pad and `setData()` from scratch. We deliberately do
    // NOT trigger a periodic full resync just because wall-clock has advanced
    // past the last set viewport — lightweight-charts shifts the visible
    // range automatically as new bars arrive (`shiftVisibleRangeOnNewBar`),
    // and a periodic resync would clobber any zoom/scroll the user has done.
    const nowSec = Math.floor(Date.now() / 1000);
    const isLiveTick =
      !modeChanged &&
      prev !== null &&
      prev.length > 0 &&
      candles.length >= prev.length &&
      (candles[0]?.time as number) === (prev[0]?.time as number);

    if (isLiveTick && seriesRef.current) {
      // Apply the last previously-known candle (may have been merged) plus
      // any new tail candles (roll-overs). `update()` is an upsert keyed by
      // time — merges if present, appends if not. Crucially, this only works
      // when the series's last data point is at or before the OLD last candle
      // time — which is why we deliberately do not right-pad whitespace
      // beyond `lastCandleTime` in `setData` below. Right-pad whitespace
      // would push the series's last time forward and make
      // `series.update(oldLastTime)` throw `Cannot update oldest data`,
      // which was the root cause of the 5s-interval crash (sub-minute
      // candles roll fast enough that this fired on the very next tick).
      const startIdx = Math.max(0, (prev as CandlestickData[]).length - 1);
      for (let i = startIdx; i < candles.length; i++) {
        seriesRef.current.update(candles[i]);
      }
      lastCandlesRef.current = candles;
      return;
    }

    const viewportFrom =
      Math.floor((nowSec - windowSec) / candleSec) * candleSec;

    // The API now hydrates up to MAX_HISTORY_CANDLES of history (see
    // `apps/api/src/routes/chart.ts`), so the typical case is `candles[0]`
    // sitting at or before `viewportFrom` — no left-pad needed. Only pad
    // when the token is fresh and the visible viewport extends earlier than
    // any candle we have.
    //
    // Crucially we do NOT right-pad whitespace beyond the last candle.
    // Doing so would push the series's `lastTime` forward, and the live-tick
    // path above calls `series.update(oldLastCandle)` which lightweight-charts
    // rejects with `Cannot update oldest data` whenever `oldLastCandle.time`
    // is strictly less than the series's `lastTime`. With no right-pad, the
    // series's last data point is always a real candle (or nothing for fresh
    // tokens), so update() is always at-or-after the series tail. We anchor
    // the viewport via `setVisibleLogicalRange` below (bar-index based)
    // instead of a time-based range so the bar density stays correct
    // regardless of how far the data tail sits from `nowSec`.
    const firstCandleTime =
      candles.length > 0 ? (candles[0].time as number) : nowSec + candleSec;

    const padded: (CandlestickData | WhitespaceData)[] = [];
    if (firstCandleTime > viewportFrom) {
      for (let t = viewportFrom; t < firstCandleTime; t += candleSec) {
        padded.push({ time: t as unknown as Time });
      }
    }
    padded.push(...candles);

    seriesRef.current.setData(padded);
    lastCandlesRef.current = candles;

    // Re-anchor the viewport on the very first non-loading render and on
    // mode change. Subsequent full resyncs (e.g. WS reconnect snapshot
    // refetch) preserve whatever zoom/scroll the user has set; `setData`
    // doesn't reset the visible range so we just leave it alone.
    //
    // Use `setVisibleLogicalRange` (bar-index based) rather than
    // `setVisibleRange` (time based). With time-based ranges the chart
    // implicitly derives bar density from the time-span ÷ data-span ratio,
    // which clamps weirdly when the requested `to` extends past the last
    // candle (which it now does — we deliberately don't right-pad
    // whitespace anymore, see comment on the live-tick path above). The
    // visible result was MASSIVE candles on 5s and hairline candles on 4h.
    // Logical ranges sidestep all that: we say "show the last N bars" and
    // the chart sizes them to fill the canvas regardless of where the
    // data tail actually ends.
    if (isFirstAnchor || modeChanged) {
      const barCount = Math.max(1, Math.ceil(windowSec / candleSec));
      const totalBars = padded.length;
      // `setVisibleLogicalRange` accepts fractional indices. `to` slightly
      // past the last bar leaves a small right margin so the latest bar
      // doesn't collide with the price-scale axis.
      chartRef.current.timeScale().setVisibleLogicalRange({
        from: totalBars - barCount,
        to: totalBars - 1 + 2,
      });
      hasAnchoredRef.current = true;
    }
  }, [candles, modeKey, windowSec, candleSec, loading, unit]);
}
