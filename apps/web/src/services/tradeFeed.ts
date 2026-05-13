import {
  fetchRouterTradesByToken,
  fetchRouterTradesGlobal,
} from "./api";
import { prefetchTokenName, resolveTokenName } from "./tokenNames";
import { routerTradeToTrade } from "./tradeFormatter";
import { getWebSocketClient } from "./websocket";

import type { Trade, TradeBroadcast } from "./types";

/**
 * Convert a raw WS trade broadcast into the client's formatted `Trade`.
 *
 * The trade-feed only consumes the **`Zap:Buy` / `Zap:Sell`** variant of
 * the `trade` channel, identified by the presence of `usdcAmount`. That
 * broadcast carries the gross USDC the user paid/received — the canonical
 * user-facing value — and its `id` matches `routerTrade.id`, so it dedupes
 * cleanly against the REST `/api/v1/trades` poll fallback.
 *
 * Chart-state broadcasts on the same channel (`Bonding:Trade`,
 * `HyperSwapPair:Sync`) carry `curveSupply` / `ltReserve` only — they're
 * picked up by `useChartData` and skipped here. Surfacing them as rows
 * would produce two entries per trade because the Bonding broadcast
 * records LT consumed by the curve (which can be strictly less than the
 * gross USDC — e.g. a graduation-triggering buy whose final increment
 * hits the supply cap) while the Zap broadcast records the gross USDC.
 */
function formatWsTrade(raw: TradeBroadcast): Trade | null {
  // `TradeBroadcast` is a discriminated union: `usdcAmount` presence
  // narrows to the trade-list variant. The chart-state variant has
  // `usdcAmount?: never` so the type-system guarantees the other four
  // trade-list fields are populated after this check.
  if (raw.usdcAmount === undefined) return null;
  const trade = routerTradeToTrade({
    id: raw.id,
    tokenAddress: raw.tokenAddress,
    trader: raw.trader,
    isBuy: raw.isBuy,
    usdcAmount: raw.usdcAmount,
    tokenAmount: raw.tokenAmount,
    timestamp: raw.timestamp,
  });
  trade.tokenName = resolveTokenName(raw.tokenAddress);
  return trade;
}

export function subscribeFeed(cb: (trade: Trade) => void): () => void {
  const ws = getWebSocketClient();
  let unsubWs: (() => void) | null = null;
  const seenIds = new Set<string>();

  if (ws) {
    unsubWs = ws.subscribe("trade", (data) => {
      const raw = data as TradeBroadcast;
      if (!raw.id || seenIds.has(raw.id)) return;
      const trade = formatWsTrade(raw);
      if (!trade) return;
      seenIds.add(raw.id);
      cb(trade);
      // Fire-and-forget: warm the name cache so subsequent trades for
      // this token render with the real symbol instead of a truncated
      // address. The current trade may show truncated for a brand-new
      // token; the next one will pick up the resolved name.
      void prefetchTokenName(raw.tokenAddress);
    });
  }

  let cancelled = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;

  const poll = async () => {
    if (cancelled || polling) return;
    polling = true;
    try {
      // `routerTrade` covers both curve and post-graduation trades (any
      // `Zap.buy/sell` regardless of execution venue), so a single poll
      // catches everything. The previous Ponder `trades` GraphQL path was
      // bonding-only and silently dropped post-grad activity from the feed.
      // Pull 50 — `RightPanel` keeps up to 50 in `useTradeFeed` so the
      // scrollable feed has enough rows to feel populated on first paint,
      // and the API caps `limit` at 100 so we have headroom.
      const trades = await fetchRouterTradesGlobal(50);
      if (cancelled) return;

      // Warm the name cache for every unique token in this batch in
      // parallel before mapping, so the initial render shows real
      // symbols rather than truncated addresses on first paint.
      const uniqueTokens = new Set(trades.map((t) => t.tokenAddress));
      await Promise.all([...uniqueTokens].map(prefetchTokenName));
      if (cancelled) return;

      const batchIds = new Set<string>();
      for (const t of trades) batchIds.add(t.id);
      for (let i = trades.length - 1; i >= 0; i--) {
        const t = trades[i];
        if (seenIds.has(t.id)) continue;
        const mapped = routerTradeToTrade(t);
        mapped.tokenName = resolveTokenName(t.tokenAddress);
        cb(mapped);
      }
      seenIds.clear();
      for (const id of batchIds) seenIds.add(id);
    } catch (err) {
      console.warn("[tradeFeed] poll failed:", err);
    } finally {
      polling = false;
    }
  };

  void poll();
  const schedulePoll = () => {
    if (cancelled) return;
    pollTimer = setTimeout(() => {
      void poll().finally(schedulePoll);
    }, ws?.isConnected ? 15_000 : 3_000);
  };
  schedulePoll();

  return () => {
    cancelled = true;
    if (pollTimer) clearTimeout(pollTimer);
    unsubWs?.();
  };
}

export function subscribeTokenTrades(
  address: string,
  cb: (trade: Trade) => void,
): () => void {
  const ws = getWebSocketClient();
  let unsubWs: (() => void) | null = null;
  const seenIds = new Set<string>();

  const normalizedAddress = address.toLowerCase();
  // Warm the cache for the single token this subscription cares about.
  // No await needed — the WS handler and poll path both fall back to a
  // truncated address until the prefetch resolves.
  void prefetchTokenName(address);
  if (ws) {
    unsubWs = ws.subscribe("trade", (data) => {
      const raw = data as TradeBroadcast;
      if (
        !raw.id ||
        seenIds.has(raw.id) ||
        raw.tokenAddress?.toLowerCase() !== normalizedAddress
      ) {
        return;
      }
      const trade = formatWsTrade(raw);
      if (!trade) return;
      seenIds.add(raw.id);
      cb(trade);
    }, normalizedAddress);
  }

  let cancelled = false;
  let polling = false;

  const poll = async () => {
    if (cancelled || polling) return;
    polling = true;
    try {
      // Same rationale as `subscribeFeed`: `routerTrade` is the only
      // graduation-aware trade source. Curve-phase trades still live there
      // (Zap also wraps on-curve buys/sells), so a single fetch path covers
      // both phases.
      const trades = await fetchRouterTradesByToken(address, 30);
      if (cancelled) return;
      const batchIds = new Set<string>();
      for (const t of trades) batchIds.add(t.id);
      for (let i = trades.length - 1; i >= 0; i--) {
        const t = trades[i];
        if (seenIds.has(t.id)) continue;
        const mapped = routerTradeToTrade(t);
        mapped.tokenName = resolveTokenName(t.tokenAddress);
        cb(mapped);
      }
      seenIds.clear();
      for (const id of batchIds) seenIds.add(id);
    } catch (err) {
      console.warn("[tradeFeed] token poll failed:", err);
    } finally {
      polling = false;
    }
  };

  void poll();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedulePoll = () => {
    if (cancelled) return;
    timer = setTimeout(() => {
      void poll().finally(schedulePoll);
    }, ws?.isConnected ? 15_000 : 5_000);
  };
  schedulePoll();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    unsubWs?.();
  };
}
