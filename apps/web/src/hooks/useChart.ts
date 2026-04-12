import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import {
  createChart,
  CandlestickSeries,
  LineSeries,
  ColorType,
} from "lightweight-charts";

import { COLORS, rgba } from "../config/colors";

import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
} from "lightweight-charts";

interface UseChartOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  candles: CandlestickData[];
  overlayData: LineData[];
  loading: boolean;
}

export function useChart({
  containerRef,
  candles,
  overlayData,
  loading,
}: UseChartOptions): void {
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  // Initialize chart
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

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.mint,
      downColor: COLORS.red,
      borderUpColor: COLORS.mint,
      borderDownColor: COLORS.red,
      wickUpColor: COLORS.mint,
      wickDownColor: COLORS.red,
    });
    candleSeriesRef.current = candleSeries;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
    };
  }, [containerRef]);

  // Update candle data
  useEffect(() => {
    if (loading || !candleSeriesRef.current || !chartRef.current) return;
    candleSeriesRef.current.setData(candles);
    chartRef.current.timeScale().fitContent();
  }, [candles, loading]);

  // Update overlay
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (overlayData.length > 0) {
      if (!lineSeriesRef.current) {
        lineSeriesRef.current = chart.addSeries(LineSeries, {
          color: rgba(COLORS.amber, 0.5),
          lineWidth: 1,
          priceScaleId: "overlay",
        });
      }
      lineSeriesRef.current.setData(overlayData);
    } else if (lineSeriesRef.current) {
      chart.removeSeries(lineSeriesRef.current);
      lineSeriesRef.current = null;
    }
  }, [overlayData]);
}
