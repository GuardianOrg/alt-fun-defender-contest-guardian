import { useEffect, useState } from "react";

import { TOKEN_SUPPLY } from "../config/constants";
import { fetchChart } from "../services/api";

import type { ChartTimeframe } from "../services/api";
import type { CandlestickData } from "lightweight-charts";

interface UseChartDataResult {
  candles: CandlestickData[];
  loading: boolean;
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

  return { candles, loading };
}
