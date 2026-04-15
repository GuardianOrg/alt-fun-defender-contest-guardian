import { useEffect, useState } from "react";

import { fetchChart } from "../services/api";

import type { ChartTimeframe } from "../services/api";
import type { LineData } from "lightweight-charts";

interface UseChartDataResult {
  prices: LineData[];
  loading: boolean;
}

export function useChartData(
  address: string,
  timeframe: ChartTimeframe,
): UseChartDataResult {
  const [prices, setPrices] = useState<LineData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchChart(address, timeframe)
      .then((points) => {
        if (cancelled) return;
        setPrices(
          points.map((p) => ({
            time: (p.timestamp / 1000) as unknown as LineData["time"],
            value: p.price,
          })),
        );
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPrices([]);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, timeframe]);

  return { prices, loading };
}
