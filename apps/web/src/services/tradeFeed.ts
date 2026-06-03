import {
  fetchRouterTradesByToken,
  fetchRouterTradesGlobal,
} from "./api";
import {
  ingestResolvedTokenName,
  prefetchTokenName,
  resolveTokenName,
} from "./tokenNames";
import { isTokenValid } from "./tokenValidity";
import { routerTradeToTrade } from "./tradeFormatter";
import { getWebSocketClient } from "./websocket";

import type { Trade, TradeBroadcast } from "./types";

// Slow REST safety-net cadence while WS is healthy.
const POLL_INTERVAL_WS_OPEN_MS = 15_000;

// Tighter fallback cadence while WS is closed or not yet open.
const POLL_INTERVAL_WS_CLOSED_MS = 5_000;

/** Format Zap trade broadcasts; chart-state broadcasts on the same channel are skipped. */
function formatWsTrade(raw: TradeBroadcast): Trade | null {
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
  // Prefer broadcast labels and seed the shared name cache.
  ingestResolvedTokenName(raw.tokenAddress, raw.tokenSymbol);
  ingestResolvedTokenName(raw.tokenAddress, raw.tokenName);
  const broadcastLabel =
    raw.tokenSymbol?.trim() || raw.tokenName?.trim() || "";
  trade.tokenName = broadcastLabel || resolveTokenName(raw.tokenAddress);
  return trade;
}

export function subscribeFeed(cb: (trade: Trade) => void): () => void {
  const ws = getWebSocketClient();
  let unsubWs: (() => void) | null = null;
  let unsubReconnect: (() => void) | null = null;
  const seenIds = new Set<string>();
  let cancelled = false;

  if (ws) {
    unsubWs = ws.subscribe("trade", (data) => {
      const raw = data as TradeBroadcast;
      if (!raw.id || seenIds.has(raw.id)) return;
      const trade = formatWsTrade(raw);
      if (!trade) return;
      // Drop trades for tokens that would 404 on the detail page —
      // unregistered or moderation-hidden. Validity is verified once per
      // token address and cached. The broadcast id is added to `seenIds`
      // only after a positive check, so a not-yet-valid token's row can
      // still be backfilled by the REST poll (already SQL-filtered to
      // valid tokens) if it becomes valid.
      void (async () => {
        const valid = await isTokenValid(raw.tokenAddress);
        if (cancelled || !valid || seenIds.has(raw.id)) return;
        seenIds.add(raw.id);
        cb(trade);
        // Warm the name cache for subsequent rows.
        void prefetchTokenName(raw.tokenAddress);
      })();
    });
  }

  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;
  // Reconnect-triggered polls wait for the in-flight poll's `finally`.
  let pendingPollRequest = false;

  const poll = async () => {
    if (cancelled) return;
    if (polling) {
      pendingPollRequest = true;
      return;
    }
    polling = true;
    pendingPollRequest = false;
    try {
      // Router trades cover both curve and post-grad venues; pull 50 for first paint.
      const trades = await fetchRouterTradesGlobal(50);
      if (cancelled) return;

      // Seed enriched labels, then prefetch any older/unresolved rows.
      for (const t of trades) {
        ingestResolvedTokenName(t.tokenAddress, t.tokenSymbol);
        ingestResolvedTokenName(t.tokenAddress, t.tokenName);
      }
      const uniqueTokens = new Set(trades.map((t) => t.tokenAddress));
      await Promise.all([...uniqueTokens].map(prefetchTokenName));
      if (cancelled) return;

      const batchIds = new Set<string>();
      for (const t of trades) batchIds.add(t.id);
      for (let i = trades.length - 1; i >= 0; i--) {
        const t = trades[i];
        if (seenIds.has(t.id)) continue;
        const mapped = routerTradeToTrade(t);
        // Mirror the WS path: prefer API labels, then cache fallback.
        const apiLabel =
          t.tokenSymbol?.trim() || t.tokenName?.trim() || "";
        mapped.tokenName = apiLabel || resolveTokenName(t.tokenAddress);
        cb(mapped);
      }
      seenIds.clear();
      for (const id of batchIds) seenIds.add(id);
    } catch (err) {
      console.warn("[tradeFeed] poll failed:", err);
    } finally {
      polling = false;
      if (!cancelled) {
        // Re-arm cadence here so reconnect refreshes cannot be overwritten.
        if (pendingPollRequest) {
          pendingPollRequest = false;
          reschedulePoll(0);
        } else {
          reschedulePoll(
            ws?.isConnected
              ? POLL_INTERVAL_WS_OPEN_MS
              : POLL_INTERVAL_WS_CLOSED_MS,
          );
        }
      }
    }
  };

  // One timer path prevents duplicate REST bursts on subscribe/reconnect.
  const reschedulePoll = (delay: number) => {
    if (cancelled) return;
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void poll();
    }, delay);
  };

  // WS has no snapshot/backfill, so REST seeds initial rows.
  reschedulePoll(0);

  // Re-poll on reconnect to backfill trades missed while the socket was wedged.
  if (ws) {
    unsubReconnect = ws.onReconnect(() => {
      reschedulePoll(0);
    });
  }

  return () => {
    cancelled = true;
    if (pollTimer) clearTimeout(pollTimer);
    unsubWs?.();
    unsubReconnect?.();
  };
}

export function subscribeTokenTrades(
  address: string,
  cb: (trade: Trade) => void,
): () => void {
  const ws = getWebSocketClient();
  let unsubWs: (() => void) | null = null;
  let unsubReconnect: (() => void) | null = null;
  const seenIds = new Set<string>();

  const normalizedAddress = address.toLowerCase();
  // Warm the cache for this token; fallback renders until it resolves.
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
  // Same role as `subscribeFeed`'s `pendingPollRequest`.
  let pendingPollRequest = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const poll = async () => {
    if (cancelled) return;
    if (polling) {
      pendingPollRequest = true;
      return;
    }
    polling = true;
    pendingPollRequest = false;
    try {
      // Router trades cover both curve and post-grad venues.
      const trades = await fetchRouterTradesByToken(address, 30);
      if (cancelled) return;
      // Seed the cache from API-enriched labels.
      for (const t of trades) {
        ingestResolvedTokenName(t.tokenAddress, t.tokenSymbol);
        ingestResolvedTokenName(t.tokenAddress, t.tokenName);
      }
      const batchIds = new Set<string>();
      for (const t of trades) batchIds.add(t.id);
      for (let i = trades.length - 1; i >= 0; i--) {
        const t = trades[i];
        if (seenIds.has(t.id)) continue;
        const mapped = routerTradeToTrade(t);
        const apiLabel =
          t.tokenSymbol?.trim() || t.tokenName?.trim() || "";
        mapped.tokenName = apiLabel || resolveTokenName(t.tokenAddress);
        cb(mapped);
      }
      seenIds.clear();
      for (const id of batchIds) seenIds.add(id);
    } catch (err) {
      console.warn("[tradeFeed] token poll failed:", err);
    } finally {
      polling = false;
      if (!cancelled) {
        // Re-arm cadence here so reconnect refreshes cannot be overwritten.
        if (pendingPollRequest) {
          pendingPollRequest = false;
          reschedulePoll(0);
        } else {
          reschedulePoll(
            ws?.isConnected
              ? POLL_INTERVAL_WS_OPEN_MS
              : POLL_INTERVAL_WS_CLOSED_MS,
          );
        }
      }
    }
  };

  // Single-timer polling cadence.
  const reschedulePoll = (delay: number) => {
    if (cancelled) return;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    timer = setTimeout(() => {
      timer = null;
      void poll();
    }, delay);
  };

  // WS has no snapshot/backfill, so REST seeds initial rows.
  reschedulePoll(0);

  // Re-poll on reconnect to backfill trades missed while the socket was wedged.
  if (ws) {
    unsubReconnect = ws.onReconnect(() => {
      reschedulePoll(0);
    });
  }

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    unsubWs?.();
    unsubReconnect?.();
  };
}
