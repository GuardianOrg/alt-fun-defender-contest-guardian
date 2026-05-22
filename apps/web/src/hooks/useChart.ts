import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import { createChart, CandlestickSeries, ColorType } from "lightweight-charts";

import { COLORS, rgba } from "../config/colors";
import { getChartModeConfig } from "../services/api";
import { formatMcapUsd, formatPriceUsd } from "../utils/format";

import type { ChartMode, ChartUnit } from "../services/api";
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
  WhitespaceData,
  Time,
  AutoscaleInfoProvider,
} from "lightweight-charts";

// Tiny autoscale floor for brand-new tokens with near-flat first candles.
export const MIN_AUTOSCALE_SPAN_FRACTION = 0.005;

// Exported for unit testing.
export const minSpanAutoscaleProvider: AutoscaleInfoProvider = (original) => {
  const info = original();
  if (!info || !info.priceRange) return info;
  const { minValue, maxValue } = info.priceRange;
  const midpoint = (minValue + maxValue) / 2;
  if (midpoint <= 0) return info;
  const minSpan = midpoint * MIN_AUTOSCALE_SPAN_FRACTION;
  if (maxValue - minValue >= minSpan) return info;
  return {
    ...info,
    priceRange: {
      minValue: midpoint - minSpan / 2,
      maxValue: midpoint + minSpan / 2,
    },
  };
};

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
  // Distinguish cheap live ticks from full resyncs.
  const lastCandlesRef = useRef<CandlestickData[] | null>(null);
  const lastModeKeyRef = useRef<string | null>(null);
  // Unit changes preserve time keys but require full data replacement.
  const lastUnitRef = useRef<ChartUnit | null>(null);
  // First data load anchors viewport; later reconnect resyncs preserve user zoom/scroll.
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
      rightPriceScale: {
        borderColor: rgba(COLORS.mint, 0.1),
        // Padding around the autoscaled band keeps candles from feeling cramped.
        scaleMargins: { top: 0.2, bottom: 0.2 },
      },
      timeScale: {
        borderColor: rgba(COLORS.mint, 0.1),
        timeVisible: true,
        // Needed for sub-minute intervals; larger intervals auto-fall back to HH:MM.
        secondsVisible: true,
      },
      handleScale: {
        mouseWheel: false,
      },
      handleScroll: {
        vertTouchDrag: false,
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
      autoscaleInfoProvider: minSpanAutoscaleProvider,
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
      // TokenDetailView reuses this Chart instance across `:address` changes.
      hasAnchoredRef.current = false;
      lastModeKeyRef.current = null;
      lastUnitRef.current = null;
      return;
    }

    seriesRef.current.applyOptions({
      priceFormat: {
        type: "custom",
        // Price mode needs significant digits; mcap mode stays whole-dollar.
        formatter: unit === "price" ? formatPriceUsd : formatMcapUsd,
        minMove: unit === "price" ? 1e-12 : 1,
      },
    });

    const prev = lastCandlesRef.current;
    const prevModeKey = lastModeKeyRef.current;
    const prevUnit = lastUnitRef.current;
    // Mode/unit swaps require full resync; reconnects preserve the viewport.
    const modeChanged = prevModeKey !== null && prevModeKey !== modeKey;
    const unitChanged = prevUnit !== null && prevUnit !== unit;
    const isFirstAnchor = !hasAnchoredRef.current;
    lastModeKeyRef.current = modeKey;
    lastUnitRef.current = unit;

    // Live ticks can use `series.update`; mode/unit/initial loads need `setData`.
    const nowSec = Math.floor(Date.now() / 1000);
    const isLiveTick =
      !modeChanged &&
      !unitChanged &&
      prev !== null &&
      prev.length > 0 &&
      candles.length >= prev.length &&
      (candles[0]?.time as number) === (prev[0]?.time as number);

    if (isLiveTick && seriesRef.current) {
      // No right-padding in `setData`; otherwise updating oldLastTime can throw.
      const startIdx = Math.max(0, (prev as CandlestickData[]).length - 1);
      for (let i = startIdx; i < candles.length; i++) {
        seriesRef.current.update(candles[i]);
      }
      lastCandlesRef.current = candles;
      return;
    }

    const viewportFrom =
      Math.floor((nowSec - windowSec) / candleSec) * candleSec;

    // Left-pad fresh tokens only; never right-pad or live `update()` can target older data.
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

    // Logical ranges give stable bar density without right-padding whitespace.
    if (isFirstAnchor || modeChanged) {
      const barCount = Math.max(1, Math.ceil(windowSec / candleSec));
      const totalBars = padded.length;
      // Slight right margin keeps the latest bar off the price axis.
      chartRef.current.timeScale().setVisibleLogicalRange({
        from: totalBars - barCount,
        to: totalBars - 1 + 2,
      });
      hasAnchoredRef.current = true;
    }
  }, [candles, modeKey, windowSec, candleSec, loading, unit]);
}
