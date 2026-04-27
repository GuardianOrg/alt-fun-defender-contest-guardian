import {
  fetchRouterTradesByToken,
  fetchRouterTradesGlobal,
} from "./api";
import { resolveExchangeRate, resolveTokenName } from "./exchangeRates";
import { ponderTradeToTrade, routerTradeToTrade } from "./tradeFormatter";
import { getWebSocketClient } from "./websocket";

import type { Trade, TradeBroadcast } from "./types";

/**
 * Convert a raw WS trade broadcast from the indexer into the client's
 * formatted `Trade` type. Looks up the LT exchange rate to compute `amountUsd`;
 * returns `null` if the rate isn't resolvable (caller can retry on next REST
 * poll).
 *
 * The WS broadcast is keyed on `Bonding.Trade` (curve phase) — post-graduation
 * trades come through REST polling of `routerTrade` since that source carries
 * USDC amounts directly without an LT-rate lookup. The Sync handler does emit
 * a synthetic `trade` WS message for chart ratio updates, but it has zero
 * `ltAmount` / zero-address `trader`, so we filter those out here so the
 * trade-feed never shows phantom "$0 from 0x000…" entries.
 */
async function formatWsTrade(raw: TradeBroadcast): Promise<Trade | null> {
  if (BigInt(raw.ltAmount ?? "0") === 0n) return null;
  const exchangeRate = await resolveExchangeRate(raw.tokenAddress);
  if (!exchangeRate) return null;
  const trade = ponderTradeToTrade(raw, exchangeRate);
  trade.tokenName = resolveTokenName(raw.tokenAddress);
  return trade;
}

export function subscribeFeed(cb: (trade: Trade) => void): () => void {
  const ws = getWebSocketClient();
  let unsubWs: (() => void) | null = null;
  const seenIds = new Set<string>();
  const pendingIds = new Set<string>();

  if (ws) {
    unsubWs = ws.subscribe("trade", (data) => {
      const raw = data as TradeBroadcast;
      if (!raw.id || seenIds.has(raw.id) || pendingIds.has(raw.id)) return;
      pendingIds.add(raw.id);
      void formatWsTrade(raw)
        .then((trade) => {
          if (trade) {
            // Only mark as seen once we've successfully emitted it. If the
            // exchange-rate lookup failed (trade === null), leave the id out
            // of `seenIds` so the REST poll can retry.
            seenIds.add(raw.id);
            cb(trade);
          }
        })
        .finally(() => pendingIds.delete(raw.id));
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
  const pendingIds = new Set<string>();

  const normalizedAddress = address.toLowerCase();
  if (ws) {
    unsubWs = ws.subscribe("trade", (data) => {
      const raw = data as TradeBroadcast;
      if (
        !raw.id ||
        seenIds.has(raw.id) ||
        pendingIds.has(raw.id) ||
        raw.tokenAddress?.toLowerCase() !== normalizedAddress
      ) {
        return;
      }
      pendingIds.add(raw.id);
      void formatWsTrade(raw)
        .then((trade) => {
          if (trade) {
            seenIds.add(raw.id);
            cb(trade);
          }
        })
        .finally(() => pendingIds.delete(raw.id));
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
