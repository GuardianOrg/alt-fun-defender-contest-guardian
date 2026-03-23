import { useEffect, useRef } from "react";

import { utcToLocalSeconds } from "./Chart.utils";
import {
  intervalMsMap,
  type ChartTimeInterval,
} from "../../../../constants/chartTimeIntervals";
import { fetchCandlesBetween } from "../../../../hooks/Hyperliquid/useHyperliquidCandles";

import type { CandlestickData, ISeriesApi, Time } from "lightweight-charts";

type Params = {
  symbol: string;
  interval: ChartTimeInterval;
  seriesRef: React.RefObject<ISeriesApi<"Candlestick"> | null>;
  candleStoreRef: React.RefObject<CandlestickData<Time>[]>;
  lastCandleTimeRef: React.RefObject<Time | null>;
  setLivePrice: (price: number) => void;
};

export function useLiveCandles({
  symbol,
  interval,
  seriesRef,
  candleStoreRef,
  lastCandleTimeRef,
  setLivePrice,
}: Params) {
  const wsRef = useRef<WebSocket | null>(null);
  const connectionIdRef = useRef(0);
  const normalizeTime = (sec: number) => utcToLocalSeconds(sec) as Time;

  useEffect(() => {
    if (!symbol) return;

    const startWs = () => {
      const ws = new WebSocket("wss://api.hyperliquid.xyz/ws");
      wsRef.current = ws;
      connectionIdRef.current += 1;
      const connectionId = connectionIdRef.current;

      ws.onopen = () => {
        if (connectionId !== connectionIdRef.current) return;
        ws.send(
          JSON.stringify({
            method: "subscribe",
            subscription: {
              type: "candle",
              coin: symbol,
              interval,
            },
          }),
        );
      };

      ws.onmessage = (event) => {
        if (!seriesRef.current) return;
        if (connectionId !== connectionIdRef.current) return;

        const msg = JSON.parse(event.data);
        if (msg.channel !== "candle") return;

        const c = msg.data;

        const bar: CandlestickData<Time> = {
          time: Math.floor(c.t / 1000) as Time,
          open: +c.o,
          high: +c.h,
          low: +c.l,
          close: +c.c,
        };

        const normalizedBar = {
          ...bar,
          time: normalizeTime(bar.time as number),
        };

        setLivePrice(bar.close);
        seriesRef.current.update(normalizedBar);

        const store = candleStoreRef.current;
        const last = store.at(-1);

        if (last?.time === bar.time) {
          store[store.length - 1] = bar;
        } else if (!last || bar.time > last.time) {
          store.push(bar);
        }

        lastCandleTimeRef.current = bar.time;
      };

      ws.onclose = () => {
        wsRef.current = null;
      };
    };

    const handleVisibilityChange = async () => {
      if (document.visibilityState === "hidden") {
        wsRef.current?.close();
        return;
      }

      const lastTime = lastCandleTimeRef.current as number;
      if (!lastTime) {
        startWs();
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const intervalSec = intervalMsMap[interval] / 1000;

      if (now - lastTime > intervalSec * 1.2) {
        const missing = await fetchCandlesBetween({
          coin: symbol,
          interval,
          fromSec: lastTime,
        });
        const normalizedMissing = missing.map((c) => ({
          ...c,
          time: normalizeTime(c.time as number),
        }));

        if (normalizedMissing.length) {
          const lastStoredCandle = candleStoreRef.current?.at(-1);
          const merged = [
            ...(candleStoreRef.current ?? []),
            ...normalizedMissing.filter(
              (c) => !lastStoredCandle || c.time > lastStoredCandle.time,
            ),
          ];

          candleStoreRef.current = merged;
          lastCandleTimeRef.current = merged.at(-1)?.time || null;
          seriesRef.current?.setData(merged);
        }
      }

      startWs();
    };

    startWs();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      wsRef.current?.close();
      connectionIdRef.current += 1;
    };
  }, [
    symbol,
    interval,
    seriesRef,
    candleStoreRef,
    lastCandleTimeRef,
    setLivePrice,
  ]);
}
