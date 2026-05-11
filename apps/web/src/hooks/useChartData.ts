import { useEffect, useMemo, useRef, useState } from "react";

import { computeCurveRatio } from "@launchpad/shared";

import { TOKEN_SUPPLY } from "../config/constants";
import { fetchChart, getChartModeConfig } from "../services/api";
import { getWebSocketClient } from "../services/websocket";

import type { ChartMode, ChartUnit } from "../services/api";
import type { CandlestickData, Time } from "lightweight-charts";

/**
 * Pure helper: fold a live OHLC tick value into the in-progress candle,
 * rolling over into a new bucket at interval boundaries. Exported for unit
 * testing. The `value` is whatever scale the candles are stored at —
 * either market cap (price × supply) or per-token USD price; the helper is
 * unit-agnostic.
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
 *      exchange rate from the `LtTicker` DO's 1s cadence.
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
  ltAddress: string | null | undefined,
  mode: ChartMode,
  unit: ChartUnit = "mcap",
): UseChartDataResult {
  // Internal candles are always stored in raw per-token USD price scale —
  // the unit multiplier is applied at the output boundary (`candles` below).
  // This decouples unit toggling from the network: switching MC ⇄ Price is a
  // pure local remap, doesn't refetch history, and can't blank the chart on
  // a transient API failure (CodeRabbit feedback on PR #468).
  const [priceCandles, setPriceCandles] = useState<CandlestickData[]>([]);
  const [loading, setLoading] = useState(true);

  const ratioRef = useRef(0);
  const exchangeRateRef = useRef(0);
  // Tracks the address the live refs were last anchored to. When `address`
  // changes (user navigates A → B) we must fully reset; for same-token
  // refetches (mode change, WS reconnect) the WS-driven refs are typically
  // newer than the snapshot's currentRatio/currentExchangeRate and must be
  // preserved. See the regression note inside the fetch effect for why.
  const refsAnchoredAddressRef = useRef<string | null>(null);

  const { candleSec, key: modeKey } = getChartModeConfig(mode);
  const unitMultiplier = unit === "mcap" ? TOKEN_SUPPLY : 1;

  // Hold the latest `mode` in a ref so the fetch effect can depend on the
  // stable `modeKey` string (which uniquely identifies the mode) rather than
  // the mode object itself — passing a fresh object each render must not
  // trigger a refetch, but a real mode change must.
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Bump to force a resync (initial mount, mode change, WS reconnect).
  const [syncEpoch, setSyncEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // Address change: clear cross-token state SYNCHRONOUSLY, before the
    // network round-trip starts. The WS subscription effect re-runs on the
    // same dependency change and may receive a tick for the new token (or
    // its LT) while `fetchChart` is still in flight. If we left the old
    // refs in place until the `.then()` ran, an early WS tick could merge
    // the new token's ratio against the previous token's `exchangeRate`
    // (or vice versa) and produce a junk mcap; later, the snapshot resolve
    // would clobber that fresher WS value back to its own.
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

        // Only adopt the snapshot's ratio/exchangeRate when we don't yet
        // have a live value (refs at 0). For same-token refetches (mode
        // change, WS reconnect) the WS keeps these refs current.
        // Overwriting them with the snapshot's values is unsafe because
        // the API reads from the indexer, which can lag the chain by a
        // couple of seconds — long enough to clobber a freshly-pumped
        // ratio with a pre-buy value. That regression is exactly what
        // made buy candles "disappear" after a few seconds: the
        // in-progress big green body collapsed back to its open as
        // subsequent live ticks recomputed `mcap = staleRatio × rate`.
        // On address change the synchronous reset above already zeroed
        // the refs, so this branch fires for the new token too unless
        // a WS tick has already raced ahead of the snapshot.
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

        // Overlay the latest live price onto the snapshot's tail before we
        // hand the array to the chart. Without this, even with the refs
        // preserved above, the in-progress live candle would be replaced
        // by the snapshot's stale last-candle close until the next WS
        // tick lands — which on a quiet token can be many seconds and is
        // exactly when the user notices the candle "vanishing" (issue
        // #445). Storage is per-token USD price (unit toggle is applied
        // at the output boundary, see `candles` below), so the overlay
        // value is `ratio × rate` — no `× TOKEN_SUPPLY`.
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

    // Emit the current price into the in-progress candle, rolling over into a
    // new bucket at interval boundaries. Uses `series.update()` semantics on
    // the consumer side — open stays fixed, high/low widen, close tracks.
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
          // Malformed bigint strings — ignore this trade.
        }
      },
      address.toLowerCase(),
    );

    // The LT-scoped `price` channel needs `ltAddress` from the token metadata.
    // When the chart is mounted in parallel with `useToken` we may not have it
    // yet — skip the subscription until the token resolves and this effect
    // re-runs with a real address. Historical candles + trade-derived live
    // ticks still flow without the LT exchange-rate stream.
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

  // Unit conversion happens at the output boundary so toggling MC ⇄ Price is
  // a pure local remap (no refetch, no `loading` flash). The identity case
  // (`unitMultiplier === 1`) returns `priceCandles` directly to keep the
  // reference stable, which lets `useChart` short-circuit its live-tick
  // detection (see `lastCandlesRef` in `useChart`) when the user hasn't
  // toggled units.
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

  return { candles, loading, currentMcap, changePercent };
}
