import { useEffect, useRef, useState } from "react";

import { computeCurveRatio } from "@launchpad/shared";

import { TOKEN_SUPPLY } from "../config/constants";
import { fetchChart, getChartModeConfig } from "../services/api";
import { getWebSocketClient } from "../services/websocket";

import type { ChartMode } from "../services/api";
import type { CandlestickData, Time } from "lightweight-charts";

/**
 * Pure helper: fold a live `mcap` value into the in-progress candle, rolling
 * over into a new bucket at interval boundaries. Exported for unit testing.
 */
export function mergePriceIntoCandles(
  prev: CandlestickData[],
  mcap: number,
  nowSec: number,
  candleSec: number,
): CandlestickData[] {
  const bucketTs = Math.floor(nowSec / candleSec) * candleSec;

  if (prev.length === 0) {
    return [
      {
        time: bucketTs as unknown as Time,
        open: mcap,
        high: mcap,
        low: mcap,
        close: mcap,
      },
    ];
  }

  const last = prev[prev.length - 1];
  const lastTime = last.time as number;

  if (bucketTs > lastTime) {
    return [
      ...prev,
      {
        time: bucketTs as unknown as Time,
        open: mcap,
        high: mcap,
        low: mcap,
        close: mcap,
      },
    ];
  }

  const merged: CandlestickData = {
    time: last.time,
    open: last.open,
    high: Math.max(last.high, mcap),
    low: Math.min(last.low, mcap),
    close: mcap,
  };
  return [...prev.slice(0, -1), merged];
}

interface UseChartDataResult {
  candles: CandlestickData[];
  loading: boolean;
  /** Current market cap derived from the latest (live) candle close */
  currentMcap: number;
  /** Percent change over the chart window (first open → last close) */
  changePercent: number;
}

interface TradeWsPayload {
  id?: string;
  tokenAddress?: string;
  curveSupply?: string;
  ltReserve?: string;
}

interface PriceWsPayload {
  ltAddress?: string;
  /** BounceTech stores exchange_rate as 1e18-scaled integer; the LtTicker
   *  broadcasts the raw string. Parsed on receipt. */
  exchangeRate?: string | number;
}

/**
 * Chart data hook. Owns the hybrid flow:
 *
 *   1. Fetches a REST snapshot of historical candles plus the live anchor
 *      inputs (`currentRatio`, `currentExchangeRate`).
 *   2. Subscribes to the `trade` WS channel (token-scoped) to update the live
 *      ratio as trades land on-chain.
 *   3. Subscribes to the `price` WS channel (LT-scoped) to update the live
 *      exchange rate from the `LtTicker` DO's 2s cadence.
 *   4. Recomputes `price = ratio × exchangeRate` on each input change and
 *      folds the result into the in-progress candle. Opens a new candle at
 *      bucket boundaries so time keeps moving even without new inputs.
 *   5. On WS reconnect, refetches the REST snapshot to resync.
 *
 * `mode` selects either a fixed timeframe (with per-timeframe default candle
 * width) or a user-picked candle interval (with an auto-sized window). The
 * candle bucket used for live-tick bucketing follows `mode` so a 1m interval
 * rolls candles every minute even though nothing else changes.
 */
export function useChartData(
  address: string,
  ltAddress: string,
  mode: ChartMode,
): UseChartDataResult {
  const [candles, setCandles] = useState<CandlestickData[]>([]);
  const [loading, setLoading] = useState(true);

  const ratioRef = useRef(0);
  const exchangeRateRef = useRef(0);

  const { candleSec, key: modeKey } = getChartModeConfig(mode);

  // Bump to force a resync (initial mount, mode change, WS reconnect).
  const [syncEpoch, setSyncEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchChart(address, mode)
      .then((snapshot) => {
        if (cancelled) return;

        ratioRef.current = snapshot.currentRatio;
        exchangeRateRef.current = snapshot.currentExchangeRate;

        const mapped: CandlestickData[] = snapshot.candles.map((c) => ({
          time: c.time as unknown as CandlestickData["time"],
          open: c.open * TOKEN_SUPPLY,
          high: c.high * TOKEN_SUPPLY,
          low: c.low * TOKEN_SUPPLY,
          close: c.close * TOKEN_SUPPLY,
        }));

        setCandles(mapped);
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
    // `modeKey` captures the full (kind, value) tuple so passing a fresh
    // mode object each render doesn't refetch — only a real change does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, modeKey, syncEpoch]);

  useEffect(() => {
    const ws = getWebSocketClient();
    if (!ws) return;

    // Emit the current price into the in-progress candle, rolling over into a
    // new bucket at interval boundaries. Uses `series.update()` semantics on
    // the consumer side — open stays fixed, high/low widen, close tracks.
    const applyLivePrice = () => {
      const ratio = ratioRef.current;
      const rate = exchangeRateRef.current;
      if (ratio <= 0 || rate <= 0) return;

      const priceUsd = ratio * rate;
      const mcap = priceUsd * TOKEN_SUPPLY;
      const nowSec = Math.floor(Date.now() / 1000);

      setCandles((prev) => mergePriceIntoCandles(prev, mcap, nowSec, candleSec));
    };

    const unsubTrade = ws.subscribe(
      "trade",
      (data) => {
        const trade = data as TradeWsPayload;
        if (
          !trade.curveSupply ||
          !trade.ltReserve ||
          trade.tokenAddress?.toLowerCase() !== address.toLowerCase()
        ) {
          return;
        }

        try {
          const curveSupply = BigInt(trade.curveSupply);
          const ltReserve = BigInt(trade.ltReserve);
          const ratio = computeCurveRatio(curveSupply, ltReserve);
          if (ratio > 0) {
            ratioRef.current = ratio;
            applyLivePrice();
          }
        } catch {
          // Malformed bigint strings — ignore this trade.
        }
      },
      address.toLowerCase(),
    );

    const unsubPrice = ws.subscribe(
      "price",
      (data) => {
        const tick = data as PriceWsPayload;
        if (!tick.exchangeRate) return;
        if (tick.ltAddress?.toLowerCase() !== ltAddress.toLowerCase()) return;

        const raw =
          typeof tick.exchangeRate === "string"
            ? Number(tick.exchangeRate) / 1e18
            : tick.exchangeRate;
        if (!isFinite(raw) || raw <= 0) return;
        exchangeRateRef.current = raw;
        applyLivePrice();
      },
      ltAddress.toLowerCase(),
    );

    const unsubReconnect = ws.onReconnect(() => {
      setSyncEpoch((n) => n + 1);
    });

    return () => {
      unsubTrade();
      unsubPrice();
      unsubReconnect();
    };
  }, [address, ltAddress, candleSec]);

  const currentMcap =
    candles.length > 0 ? (candles[candles.length - 1].close as number) : 0;

  const changePercent =
    candles.length > 0 && (candles[0].open as number) > 0
      ? (((candles[candles.length - 1].close as number) -
          (candles[0].open as number)) /
          (candles[0].open as number)) *
        100
      : 0;

  return { candles, loading, currentMcap, changePercent };
}
