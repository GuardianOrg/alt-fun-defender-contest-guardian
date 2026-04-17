import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import {
  createChart,
  CandlestickSeries,
  ColorType,
} from "lightweight-charts";

import { COLORS, rgba } from "../config/colors";
import { formatUsd } from "../utils/format";

import type { ChartTimeframe } from "../services/api";
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
  WhitespaceData,
  Time,
} from "lightweight-charts";

const TIMEFRAME_SECONDS: Record<ChartTimeframe, number> = {
  "1d": 86_400,
  "5d": 432_000,
  "1m": 2_592_000,
};

// Must match DEFAULT_CANDLE_SECONDS in apps/api/src/routes/chart.ts so
// whitespace slots align with real candle buckets returned by the API.
const CANDLE_SECONDS: Record<ChartTimeframe, number> = {
  "1d": 300,
  "5d": 1_800,
  "1m": 14_400,
};

interface UseChartOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  candles: CandlestickData[];
  timeframe: ChartTimeframe;
  loading: boolean;
}

export function useChart({
  containerRef,
  candles,
  timeframe,
  loading,
}: UseChartOptions): void {
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // Track the last candle array we applied so we can distinguish a live tick
  // (last element mutated) from a full resync (timeframe change / refetch).
  // Live ticks use `series.update()` which is an OHLC merge — dramatically
  // cheaper than `setData()` on every 2s price tick.
  const lastCandlesRef = useRef<CandlestickData[] | null>(null);
  const lastTimeframeRef = useRef<ChartTimeframe | null>(null);

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
        secondsVisible: false,
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
      return;
    }

    seriesRef.current.applyOptions({
      priceFormat: {
        type: "custom",
        formatter: formatUsd,
        minMove: 0.01,
      },
    });

    const prev = lastCandlesRef.current;
    const timeframeChanged = lastTimeframeRef.current !== timeframe;
    lastTimeframeRef.current = timeframe;

    // Detect whether this is a live-tick update (same anchor + non-shrinking
    // tail) vs. a full resync (timeframe change, initial load, reconnect).
    // On live ticks we call `series.update()` for cheap OHLC merges;
    // otherwise we re-pad and `setData()` from scratch.
    const isLiveTick =
      !timeframeChanged &&
      prev !== null &&
      prev.length > 0 &&
      candles.length >= prev.length &&
      (candles[0]?.time as number) === (prev[0]?.time as number);

    if (isLiveTick && seriesRef.current) {
      // Apply the last previously-known candle (may have been merged) plus
      // any new tail candles (roll-overs). `update()` is an upsert keyed by
      // time — merges if present, appends if not.
      const startIdx = Math.max(0, (prev as CandlestickData[]).length - 1);
      for (let i = startIdx; i < candles.length; i++) {
        seriesRef.current.update(candles[i]);
      }
      lastCandlesRef.current = candles;
      return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const windowSec = TIMEFRAME_SECONDS[timeframe];
    const candleSec = CANDLE_SECONDS[timeframe];
    const from = Math.floor((nowSec - windowSec) / candleSec) * candleSec;

    // Pad the series with whitespace slots spanning the full timeframe so the
    // candles stay anchored to the right with uniform width even when we have
    // less data than the selected window. Without this, lightweight-charts
    // clamps setVisibleRange to the data range and stretches the candles to
    // fill the whole chart area.
    const firstCandleTime =
      candles.length > 0 ? (candles[0].time as number) : nowSec + candleSec;
    const lastCandleTime =
      candles.length > 0
        ? (candles[candles.length - 1].time as number)
        : from - candleSec;

    const padded: (CandlestickData | WhitespaceData)[] = [];
    for (let t = from; t < firstCandleTime; t += candleSec) {
      padded.push({ time: t as unknown as Time });
    }
    padded.push(...candles);
    for (let t = lastCandleTime + candleSec; t <= nowSec; t += candleSec) {
      padded.push({ time: t as unknown as Time });
    }

    seriesRef.current.setData(padded);
    lastCandlesRef.current = candles;

    chartRef.current.timeScale().setVisibleRange({
      from: from as unknown as CandlestickData["time"],
      to: nowSec as unknown as CandlestickData["time"],
    });
  }, [candles, timeframe, loading]);
}
