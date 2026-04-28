import {
  fetchRouterTradesByToken,
  fetchRouterTradesGlobal,
} from "./api";
import { resolveTokenName } from "./exchangeRates";
import { routerTradeToTrade } from "./tradeFormatter";
import { getWebSocketClient } from "./websocket";

import type { ApiRouterTrade } from "./api";
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
  // `usdcAmount`, `tokenAmount`, `trader`, `isBuy` are set together by
  // the Zap variant — see `TradeBroadcast`'s docstring. The check on
  // `usdcAmount` alone discriminates the variant; the others would only
  // be undefined together if the broadcast contract were violated.
  if (
    raw.usdcAmount === undefined ||
    raw.tokenAmount === undefined ||
    raw.trader === undefined ||
    raw.isBuy === undefined
  ) {
    return null;
  }
  const apiShape: ApiRouterTrade = {
    id: raw.id,
    tokenAddress: raw.tokenAddress,
    trader: raw.trader,
    isBuy: raw.isBuy,
    usdcAmount: raw.usdcAmount,
    tokenAmount: raw.tokenAmount,
    blockNumber: "0",
    timestamp: raw.timestamp,
  };
  const trade = routerTradeToTrade(apiShape);
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
      const trades = await fetchRouterTradesGlobal(20);
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
