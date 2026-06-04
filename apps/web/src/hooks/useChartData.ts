import { useEffect, useMemo, useRef, useState } from "react";

import { computeCurveRatio } from "@launchpad/shared";

import { TOKEN_SUPPLY } from "../config/constants";
import { fetchChart, getChartModeConfig } from "../services/api";
import { getWebSocketClient } from "../services/websocket";

import type { ChartMode, ChartUnit } from "../services/api";
import type { CandlestickData, Time } from "lightweight-charts";

/**
 * Fold a live OHLC value into the current candle. New buckets carry forward
 * the prior close so live candles match the API's boundary-corrected history.
 */
export function mergePriceIntoCandles(
  prev: CandlestickData[],
  value: number,
  nowSec: number,
  candleSec: number,
): CandlestickData[] {
  const mcap = value;
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
    // Carry-forward prevents boundary-crossing live trades from drawing gap dojis.
    const carry = last.close as number;
    return [
      ...prev,
      {
        time: bucketTs as unknown as Time,
        open: carry,
        high: Math.max(carry, mcap),
        low: Math.min(carry, mcap),
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
  /** Live USD mcap from the latest raw candle; independent of chart unit toggle. */
  liveMcapUsd: number | null;
}

interface TradeWsPayload {
  id?: string;
  tokenAddress?: string;
  curveSupply?: string;
  ltReserve?: string;
}

interface PriceWsPayload {
  ltAddress?: string;
  /** Raw 1e18-scaled exchange rate broadcast by LtTicker. */
  exchangeRate?: string | number;
}

/** Hybrid chart data: REST snapshot plus token trade and LT price WS ticks. */
export function useChartData(
  address: string,
  ltAddress: string | null | undefined,
  mode: ChartMode,
  unit: ChartUnit = "mcap",
): UseChartDataResult {
  // Store raw per-token price; mcap/price toggles are local output remaps.
  const [priceCandles, setPriceCandles] = useState<CandlestickData[]>([]);
  const [loading, setLoading] = useState(true);

  const ratioRef = useRef(0);
  const exchangeRateRef = useRef(0);
  // Reset live refs on token change; preserve them for same-token refetches.
  const refsAnchoredAddressRef = useRef<string | null>(null);

  const { candleSec, key: modeKey } = getChartModeConfig(mode);
  const unitMultiplier = unit === "mcap" ? TOKEN_SUPPLY : 1;

  // Use stable `modeKey` for fetch deps while retaining latest mode object.
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const [syncEpoch, setSyncEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // Clear cross-token state synchronously before any new WS tick can merge against old refs.
    const isAddressChange = refsAnchoredAddressRef.current !== address;
    if (isAddressChange) {
      refsAnchoredAddressRef.current = address;
      ratioRef.current = 0;
      exchangeRateRef.current = 0;
      setPriceCandles([]);
    }

    fetchChart(address, modeRef.current)
      .then((snapshot) => {
        if (cancelled) return;

        // Do not let a lagging indexer snapshot clobber fresher same-token WS refs.
        if (ratioRef.current <= 0) {
          ratioRef.current = snapshot.currentRatio;
        }
        if (exchangeRateRef.current <= 0) {
          exchangeRateRef.current = snapshot.currentExchangeRate;
        }

        const mapped: CandlestickData[] = snapshot.candles.map((c) => ({
          time: c.time as unknown as CandlestickData["time"],
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));

        // Overlay the latest live price onto the snapshot tail to avoid stale-candle flashes.
        let nextCandles = mapped;
        const ratio = ratioRef.current;
        const rate = exchangeRateRef.current;
        if (ratio > 0 && rate > 0) {
          const priceUsd = ratio * rate;
          const nowSec = Math.floor(Date.now() / 1000);
          const { candleSec: cs } = getChartModeConfig(modeRef.current);
          nextCandles = mergePriceIntoCandles(mapped, priceUsd, nowSec, cs);
        }

        setPriceCandles(nextCandles);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPriceCandles([]);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, modeKey, syncEpoch]);

  useEffect(() => {
    const ws = getWebSocketClient();
    if (!ws) return;

    // Emit current price into the in-progress candle, rolling buckets at interval boundaries.
    const applyLivePrice = () => {
      const ratio = ratioRef.current;
      const rate = exchangeRateRef.current;
      if (ratio <= 0 || rate <= 0) return;

      const priceUsd = ratio * rate;
      const nowSec = Math.floor(Date.now() / 1000);

      setPriceCandles((prev) =>
        mergePriceIntoCandles(prev, priceUsd, nowSec, candleSec),
      );
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
          // Malformed bigint strings.
        }
      },
      address.toLowerCase(),
    );

    // Subscribe to LT price once token metadata has resolved.
    const unsubPrice = ltAddress
      ? ws.subscribe(
          "price",
          (data) => {
            const tick = data as PriceWsPayload;
            if (!tick.exchangeRate) return;
            if (tick.ltAddress?.toLowerCase() !== ltAddress.toLowerCase())
              return;

            const raw =
              typeof tick.exchangeRate === "string"
                ? Number(tick.exchangeRate) / 1e18
                : tick.exchangeRate;
            if (!isFinite(raw) || raw <= 0) return;
            exchangeRateRef.current = raw;
            applyLivePrice();
          },
          ltAddress.toLowerCase(),
        )
      : () => {};

    const unsubReconnect = ws.onReconnect(() => {
      setSyncEpoch((n) => n + 1);
    });

    return () => {
      unsubTrade();
      unsubPrice();
      unsubReconnect();
    };
  }, [address, ltAddress, candleSec]);

  // Convert units at the output boundary; identity path preserves reference stability.
  const candles = useMemo(() => {
    if (unitMultiplier === 1) return priceCandles;
    return priceCandles.map((c) => ({
      time: c.time,
      open: (c.open as number) * unitMultiplier,
      high: (c.high as number) * unitMultiplier,
      low: (c.low as number) * unitMultiplier,
      close: (c.close as number) * unitMultiplier,
    }));
  }, [priceCandles, unitMultiplier]);

  const currentMcap =
    candles.length > 0 ? (candles[candles.length - 1].close as number) : 0;

  const changePercent =
    candles.length > 0 && (candles[0].open as number) > 0
      ? (((candles[candles.length - 1].close as number) -
          (candles[0].open as number)) /
          (candles[0].open as number)) *
        100
      : 0;

  // The mcap overlay always uses raw price candles, regardless of y-axis unit.
  const liveMcapUsd =
    priceCandles.length > 0
      ? (priceCandles[priceCandles.length - 1].close as number) * TOKEN_SUPPLY
      : null;

  return { candles, loading, currentMcap, changePercent, liveMcapUsd };
}
