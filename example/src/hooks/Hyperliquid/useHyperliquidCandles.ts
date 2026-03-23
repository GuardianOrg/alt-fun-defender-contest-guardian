import { useEffect, useState } from "react";

import {
  intervalMsMap,
  type ChartTimeInterval,
} from "../../constants/chartTimeIntervals";

import type { CandlestickData, Time } from "lightweight-charts";

interface RawCandle {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
}

interface FetchParams {
  coin: string;
  interval: ChartTimeInterval;
  startTimeMs: number;
  endTimeMs: number;
}

const mapRawCandle = (c: RawCandle): CandlestickData<Time> => ({
  time: Math.floor(c.t / 1000) as Time,
  open: Number(c.o),
  high: Number(c.h),
  low: Number(c.l),
  close: Number(c.c),
});

const fetchCandles = async ({
  coin,
  interval,
  startTimeMs,
  endTimeMs,
}: FetchParams): Promise<CandlestickData<Time>[]> => {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: { coin, interval, startTime: startTimeMs, endTime: endTimeMs },
    }),
  });

  const data: RawCandle[] = await res.json();
  return data.map(mapRawCandle);
};

export const useHyperliquidCandles = ({
  coin,
  interval,
}: {
  coin: string;
  interval: ChartTimeInterval;
}) => {
  const [candles, setCandles] = useState<CandlestickData<Time>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      try {
        const now = Date.now();
        const startTimeMs = now - intervalMsMap[interval] * 5000;

        const result = await fetchCandles({
          coin,
          interval,
          startTimeMs,
          endTimeMs: now,
        });

        if (alive) setCandles(result);
      } catch (err) {
        if (alive) {
          console.error("Error fetching historical candles:", err);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [coin, interval]);

  return { candles, loading };
};

export const fetchCandlesBetween = ({
  coin,
  interval,
  fromSec,
}: {
  coin: string;
  interval: ChartTimeInterval;
  fromSec: number;
}): Promise<CandlestickData<Time>[]> => {
  return fetchCandles({
    coin,
    interval,
    startTimeMs: fromSec * 1000,
    endTimeMs: Date.now(),
  });
};
