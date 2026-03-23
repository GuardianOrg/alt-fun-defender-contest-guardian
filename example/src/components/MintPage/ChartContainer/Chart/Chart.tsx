import { useEffect, useMemo, useRef } from "react";

import {
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useSelector } from "react-redux";

import styles from "./Chart.module.css";
import { chartColors, getLastNCandles, utcToLocalSeconds } from "./Chart.utils";
import { createConfiguredChart } from "./useCreateChart";
import { useLiveCandles } from "./useLiveCandles";
import JellyLoader from "../../../../assets/JellyLoader";
import { intervalMsMap } from "../../../../constants/chartTimeIntervals";
import { useThemeContext } from "../../../../contexts/ThemeContextDef";
import { useHyperliquidCandles } from "../../../../hooks/Hyperliquid/useHyperliquidCandles";
import { useLiveTrades } from "../../../../hooks/useLiveTrades";
import {
  selectLeverageTokenSymbol,
  selectSelectedInterval,
  selectSelectedTargetAsset,
  selectToggleMarkers,
} from "../../../../state/mintSlice";

const Chart = ({
  setLivePrice,
}: {
  setLivePrice: (price: number | null) => void;
}) => {
  const selectedTargetAsset = useSelector(selectSelectedTargetAsset);
  const selectedInterval = useSelector(selectSelectedInterval);
  const leverageTokenSymbol = useSelector(selectLeverageTokenSymbol);
  const toggleMarkers = useSelector(selectToggleMarkers);

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const seriesMarkersRef = useRef<ReturnType<
    typeof createSeriesMarkers<Time>
  > | null>(null);
  const candleStoreRef = useRef<CandlestickData<Time>[]>([]);
  const lastCandleTimeRef = useRef<Time | null>(null);

  const { theme } = useThemeContext();
  const colors = useMemo(() => chartColors({ theme }), [theme]);

  const trades = useLiveTrades();
  const lastNCandles = getLastNCandles();

  // Fetch historical candles
  const { candles: historicalCandles, loading } = useHyperliquidCandles({
    coin: selectedTargetAsset.symbol,
    interval: selectedInterval,
  });

  // 1️⃣ Chart setup + teardown
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || !historicalCandles.length) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    // Create chart
    const { chart, candlestickSeries } = createConfiguredChart(
      container,
      colors,
    );
    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    seriesMarkersRef.current = createSeriesMarkers<Time>(candlestickSeries, []);
    candleStoreRef.current = historicalCandles;
    lastCandleTimeRef.current =
      (historicalCandles[historicalCandles.length - 1]?.time as Time) ?? null;
    const adjustedCandles = historicalCandles.map((c) => ({
      ...c,
      time: typeof c.time === "number" ? utcToLocalSeconds(c.time) : c.time,
    }));
    candlestickSeries.setData(adjustedCandles as CandlestickData<Time>[]);

    const fromIndex = Math.max(adjustedCandles.length - lastNCandles, 0);

    chart.timeScale().setVisibleRange({
      from: adjustedCandles[fromIndex].time as Time,
      to: adjustedCandles[adjustedCandles.length - 1].time as Time,
    });
    chart.timeScale().applyOptions({ rightOffset: 5 });

    // Handle chart resizing
    const handleResize = () => {
      if (!chartRef.current) return;
      chartRef.current.applyOptions({
        width: chartContainerRef.current?.clientWidth || 0,
      });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }
    };
  }, [
    theme,
    historicalCandles,
    colors,
    selectedTargetAsset.symbol,
    selectedInterval,
    lastNCandles,
  ]);

  // 2️⃣ WebSocket for live candle updates
  useLiveCandles({
    symbol: selectedTargetAsset.symbol,
    interval: selectedInterval,
    seriesRef,
    candleStoreRef,
    lastCandleTimeRef,
    setLivePrice,
  });

  // 3️⃣ Live marker updates
  useEffect(() => {
    if (!seriesMarkersRef.current || !trades) return;

    if (!toggleMarkers) {
      seriesMarkersRef.current.setMarkers([]);
      return;
    }

    const bucket = intervalMsMap[selectedInterval] / 1000;

    const eventMarkers = trades.map((e) => {
      const tradeSeconds = Math.floor(new Date(e.timestamp).getTime());
      const candleTime = Math.floor(tradeSeconds / bucket) * bucket;
      return {
        time: utcToLocalSeconds(candleTime) as Time,
        position: (e.isBuy ? "aboveBar" : "belowBar") as
          | "aboveBar"
          | "belowBar",
        color: e.isBuy ? "#52be60" : "#f76960",
        shape: "circle" as const,
        text: `${e.targetLeverage}${e.isLong ? "L" : "S"}`,
        price: undefined,
      };
    });

    eventMarkers.sort((a, b) => (a.time as number) - (b.time as number));
    seriesMarkersRef.current.setMarkers(eventMarkers);
  }, [
    theme,
    trades,
    toggleMarkers,
    leverageTokenSymbol,
    selectedTargetAsset.symbol,
    historicalCandles,
    selectedInterval,
  ]);

  // 4️⃣ Loading state
  if (!historicalCandles.length || loading) {
    if (chartContainerRef.current) {
      chartContainerRef.current.innerHTML = "";
    }
    return (
      <div className={styles.loader} data-testid="jelly-loader">
        <JellyLoader />
      </div>
    );
  }

  // 5️⃣ Render chart container
  return (
    <div
      ref={chartContainerRef}
      className={styles.chart}
      data-testid="chart-container"
    />
  );
};

export default Chart;
