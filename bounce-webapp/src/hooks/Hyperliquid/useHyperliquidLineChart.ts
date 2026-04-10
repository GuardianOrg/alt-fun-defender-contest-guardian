/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";

import type { ChartTimeInterval } from "../../constants/chartTimeIntervals";

export const useHyperliquidLineChart = ({
  coin,
  interval,
}: {
  coin: string;
  interval: ChartTimeInterval;
}) => {
  const [prices, setPrices] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  interface Candle {
    t: number;
    o: string;
    h: string;
    l: string;
    c: string;
  }

  useEffect(() => {
    const isMounted = true;
    const fetchPrices = async () => {
      setLoading(true);
      try {
        const res = await fetch("https://api.hyperliquid.xyz/info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "candleSnapshot",
            req: {
              coin,
              interval,
              startTime: Date.now() - 86400000,
              endTime: Date.now(),
            },
          }),
        });

        const data = await res.json();
        if (!isMounted) return;

        const formattedPrices = data.map((c: Candle) => c.c);
        setPrices(formattedPrices);
      } catch (err) {
        console.error(err);
      } finally {
        if (isMounted) setLoading(false);
      }

      return { prices };
    };

    fetchPrices();
  }, [coin, interval]);

  return { prices, loading };
};
