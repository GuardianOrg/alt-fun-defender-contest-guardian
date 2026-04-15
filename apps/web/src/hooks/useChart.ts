import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import {
  createChart,
  LineSeries,
  ColorType,
} from "lightweight-charts";

import { COLORS, rgba } from "../config/colors";

import type {
  IChartApi,
  ISeriesApi,
  LineData,
} from "lightweight-charts";

interface UseChartOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  prices: LineData[];
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
  prices,
  loading,
}: UseChartOptions): void {
  const chartRef = useRef<IChartApi | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

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
      timeScale: { borderColor: rgba(COLORS.mint, 0.1) },
    });

    chartRef.current = chart;

    const lineSeries = chart.addSeries(LineSeries, {
      color: COLORS.mint,
      lineWidth: 2,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: COLORS.mint,
      crosshairMarkerBackgroundColor: "rgba(0,0,0,0.8)",
    });
    lineSeriesRef.current = lineSeries;

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
      lineSeriesRef.current = null;
    };
  }, [containerRef]);

  useEffect(() => {
    if (loading || !lineSeriesRef.current || !chartRef.current) return;

    const representative = prices.length > 0 ? prices[0].value : 0;
    const minMove = representative > 0
      ? Math.pow(10, -precisionForPrice(representative))
      : 0.01;

    lineSeriesRef.current.applyOptions({
      priceFormat: {
        type: "price",
        precision: precisionForPrice(representative),
        minMove,
      },
    });

    lineSeriesRef.current.setData(prices);
    chartRef.current.timeScale().fitContent();
  }, [prices, loading]);
}
