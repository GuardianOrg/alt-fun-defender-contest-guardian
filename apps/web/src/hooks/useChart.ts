import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import {
  createChart,
  CandlestickSeries,
  ColorType,
} from "lightweight-charts";

import { COLORS, rgba } from "../config/colors";

import type { ChartTimeframe } from "../services/api";
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
} from "lightweight-charts";

const TIMEFRAME_SECONDS: Record<ChartTimeframe, number> = {
  "24h": 86_400,
  "7d": 604_800,
  "14d": 1_209_600,
  "1m": 2_592_000,
};

interface UseChartOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  candles: CandlestickData[];
  timeframe: ChartTimeframe;
  loading: boolean;
}

function precisionForPrice(value: number): number {
  if (value === 0) return 2;
  const abs = Math.abs(value);
  if (abs >= 1) return 2;
  const leading = -Math.floor(Math.log10(abs));
  return Math.min(leading + 3, 14);
}

export function useChart({
  containerRef,
  candles,
  timeframe,
  loading,
}: UseChartOptions): void {
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

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
    if (loading || !seriesRef.current || !chartRef.current) return;

    const representative = candles.length > 0 ? candles[0].close : 0;
    const minMove = representative > 0
      ? Math.pow(10, -precisionForPrice(representative))
      : 0.01;

    seriesRef.current.applyOptions({
      priceFormat: {
        type: "price",
        precision: precisionForPrice(representative),
        minMove,
      },
    });

    seriesRef.current.setData(candles);

    const nowSec = Math.floor(Date.now() / 1000);
    const windowSec = TIMEFRAME_SECONDS[timeframe];
    const from = nowSec - windowSec;

    chartRef.current.timeScale().setVisibleRange({
      from: from as unknown as CandlestickData["time"],
      to: nowSec as unknown as CandlestickData["time"],
    });
  }, [candles, timeframe, loading]);
}
