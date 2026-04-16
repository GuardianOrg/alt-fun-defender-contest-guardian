import { useEffect, useState } from "react";

import { TOKEN_SUPPLY } from "../config/constants";
import { fetchChart } from "../services/api";

import type { ChartTimeframe } from "../services/api";
import type { CandlestickData } from "lightweight-charts";

interface UseChartDataResult {
  candles: CandlestickData[];
  loading: boolean;
  /** Current market cap derived from the last chart candle close */
  currentMcap: number;
  /** Percent change over the chart timeframe (first open → last close) */
  changePercent: number;
}

export function useChartData(
  address: string,
  timeframe: ChartTimeframe,
): UseChartDataResult {
  const [candles, setCandles] = useState<CandlestickData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchChart(address, timeframe)
      .then((data) => {
        if (cancelled) return;
        setCandles(
          data.map((c) => ({
            time: c.time as unknown as CandlestickData["time"],
            open: c.open * TOKEN_SUPPLY,
            high: c.high * TOKEN_SUPPLY,
            low: c.low * TOKEN_SUPPLY,
            close: c.close * TOKEN_SUPPLY,
          })),
        );
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setCandles([]);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, timeframe]);

  const currentMcap =
    candles.length > 0
      ? (candles[candles.length - 1].close as number)
      : 0;

  const changePercent =
    candles.length > 0 && (candles[0].open as number) > 0
      ? (((candles[candles.length - 1].close as number) -
          (candles[0].open as number)) /
          (candles[0].open as number)) *
        100
      : 0;

  return { candles, loading, currentMcap, changePercent };
}
