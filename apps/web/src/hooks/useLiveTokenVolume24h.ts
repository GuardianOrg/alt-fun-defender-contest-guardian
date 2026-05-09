import { useEffect, useRef, useState } from "react";

import { useMarketData } from "./useMarketData";
import { getWebSocketClient } from "../services/websocket";

import type { TradeBroadcast } from "../services/types";

/**
 * Pure composition logic, extracted so the polling-base + WS-delta merge
 * can be unit-tested without React Query / WebSocket scaffolding.
 *
 * Returns `null` when the polled base is unavailable (indexer degraded),
 * so the UI renders `—` rather than an isolated WS-delta figure that
 * would underrepresent the true 24h volume.
 */
export function composeLiveVolume(
  baseVolumeUsd: number | null,
  deltaUsd: number,
): number | null {
  if (baseVolumeUsd === null) return null;
  return baseVolumeUsd + deltaUsd;
}

/**
 * Convert a `TradeBroadcast` from the `trade` WS channel to a USD delta.
 * Only the trade-list variant (with `usdcAmount`) carries a USD figure;
 * the chart-state variant returns `null`. Exported for unit testing.
 */
export function tradeBroadcastToUsd(raw: TradeBroadcast): number | null {
  if (raw.usdcAmount === undefined) return null;
  try {
    return Number(BigInt(raw.usdcAmount)) / 1e6;
  } catch {
    return null;
  }
}

/**
 * Live 24h trading volume for a single token, displayed on the token
 * detail hero. Combines two sources:
 *
 *   1. **Polled base** — `/api/v1/market-data` refetched every 30s by
 *      `useMarketData`. The Cloudflare Workers cache holds the response
 *      for 30s, so worst-case staleness is ~30s + indexer lag.
 *   2. **Live WS deltas** — `Zap:Buy` / `Zap:Sell` broadcasts on the
 *      token-scoped `trade` channel, summed in `usdcAmount`. Each
 *      broadcast's `id` matches the indexer's `routerTrade.id`, so
 *      we dedupe trades that arrive on the WS *and* are already
 *      reflected in the polled base.
 *
 * Reset semantics: when the polled `volume24hUsd` value changes
 * (TanStack refetch picked up new trades), we drop both the delta and
 * the seen-id set. Trades whose WS broadcast races a refetch may be
 * briefly double-counted on the receiving render, but the next refetch
 * smooths it out. Trades whose WS broadcast races *behind* the refetch
 * are deduped on the seen-id check that survives across the reset, so
 * the lifetime drift is bounded.
 *
 * The 24h window slides forward as time passes — trades older than 24h
 * fall out of the rolling window. We don't track that on the client; the
 * 30s polled refresh is the source of truth for window boundaries. The
 * delta only ever monotonically grows between refreshes.
 *
 * Returns `null` whenever `useMarketData` reports a null base for this
 * token (indexer degraded, or token not yet in the snapshot). Callers
 * should render `—` in that state, not `$0`.
 */
export function useLiveTokenVolume24h(
  address: string | undefined,
): number | null {
  const { getTokenMarketData, dataUpdatedAt } = useMarketData();
  const baseVolume = address
    ? (getTokenMarketData(address)?.volume24hUsd ?? null)
    : null;

  const [delta, setDelta] = useState(0);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const lastBaseUpdatedAtRef = useRef(dataUpdatedAt);
  const lastAddressRef = useRef(address);

  // Reset accumulated delta whenever the polled base refreshes. We key
  // off `dataUpdatedAt` (not the volume value itself) so that a refetch
  // that returns the same number — e.g. no trades happened in the
  // 30s window — still drops the delta. Both inputs already reflect the
  // current state at that moment, so adding stale WS deltas on top would
  // double-count.
  //
  // Also reset whenever the viewed `address` changes — the WS subscribe
  // effect below tears down the old subscription and re-subscribes, but
  // without this guard the previous token's accumulated `delta` and
  // `seenIds` would briefly leak onto the new token until the next
  // market-data refetch tick.
  useEffect(() => {
    const addressChanged = address !== lastAddressRef.current;
    const baseRefreshed = dataUpdatedAt !== lastBaseUpdatedAtRef.current;
    if (!addressChanged && !baseRefreshed) return;
    lastAddressRef.current = address;
    lastBaseUpdatedAtRef.current = dataUpdatedAt;
    setDelta(0);
    seenIdsRef.current = new Set();
  }, [address, dataUpdatedAt]);

  useEffect(() => {
    if (!address) return;
    const ws = getWebSocketClient();
    if (!ws) return;

    const lower = address.toLowerCase();

    return ws.subscribe(
      "trade",
      (data) => {
        const raw = data as TradeBroadcast;
        if (raw.tokenAddress?.toLowerCase() !== lower) return;
        if (!raw.id || seenIdsRef.current.has(raw.id)) return;

        const usd = tradeBroadcastToUsd(raw);
        if (usd === null) return;

        seenIdsRef.current.add(raw.id);
        setDelta((prev) => prev + usd);
      },
      lower,
    );
  }, [address]);

  return composeLiveVolume(baseVolume, delta);
}
