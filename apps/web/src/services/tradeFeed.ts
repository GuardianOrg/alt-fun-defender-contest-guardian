import {
  fetchRouterTradesByToken,
  fetchRouterTradesGlobal,
} from "./api";
import {
  ingestResolvedTokenName,
  prefetchTokenName,
  resolveTokenName,
} from "./tokenNames";
import { routerTradeToTrade } from "./tradeFormatter";
import { getWebSocketClient } from "./websocket";

import type { Trade, TradeBroadcast } from "./types";

/**
 * REST poll cadence while the WS connection is healthy. With WS pushing
 * live trades as they happen, the REST poll is a slow safety net — long
 * enough to be cheap, short enough that a wedged WS still surfaces
 * trades within ~one cadence.
 */
const POLL_INTERVAL_WS_OPEN_MS = 15_000;

/**
 * REST poll cadence while the WS connection is down or hasn't yet
 * opened. Tighter than the WS-open cadence so a tab without a working
 * WS stays semi-live, but still loose enough to avoid the back-to-back
 * `/api/v1/trades` bursts the previous immediate-fire + 3s-rescheduled
 * shape produced during the WS handshake (see audit in the "duplicate
 * /api/v1/trades bursts" task).
 */
const POLL_INTERVAL_WS_CLOSED_MS = 5_000;

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
  // Prefer the indexer-resolved label on the broadcast — it closes the
  // race window where the first buy for a brand-new token lands in the
  // feed before the Ponder GraphQL endpoint has caught up to the
  // indexer's write (issue #703). Fall back through `tokenSymbol` →
  // `tokenName` → the existing cache lookup (which itself falls back
  // to a truncated address). Seed the cache while we're here so
  // subsequent trades for the same token, other components, and the
  // `subscribeTokenName` healer all see the resolved label without a
  // separate fetch.
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
  // Set when a fresh-poll trigger (typically a WS reconnect) lands
  // while `poll()` is already in flight. The in-flight poll's `finally`
  // block honours the request once it resolves, so a reconnect's
  // refresh is never silently dropped just because the regular tick
  // happened to run a few hundred ms before it. Without this, the
  // polling-guard early-return would swallow the reconnect's refresh
  // until the next 15 s tick.
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
      // `routerTrade` covers both curve and post-graduation trades (any
      // `Zap.buy/sell` regardless of execution venue), so a single poll
      // catches everything. The previous Ponder `trades` GraphQL path was
      // bonding-only and silently dropped post-grad activity from the feed.
      // Pull 50 — `RightPanel` keeps up to 50 in `useTradeFeed` so the
      // scrollable feed has enough rows to feel populated on first paint,
      // and the API caps `limit` at 100 so we have headroom.
      const trades = await fetchRouterTradesGlobal(50);
      if (cancelled) return;

      // The API now returns `tokenSymbol` / `tokenName` enriched from
      // the indexer's `token` row (issue #703), so the row's display
      // label lands on first paint without a second Ponder round-trip.
      // Seed `tokenNameMap` from the response so the WS path's
      // `subscribeTokenName` heal flow (and any other consumer) picks
      // up the same labels without redoing the work.
      //
      // For older API builds that don't return the labels, fall back
      // through `prefetchTokenName` (Ponder GraphQL) — same code path
      // as before this PR. Both paths are idempotent, so calling them
      // together for the same address is cheap.
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
        // Mirror the WS path: prefer the API-enriched label, then fall
        // back to the cache (which we already seeded above for the
        // enriched case anyway — kept as a defence-in-depth fallback
        // when the API hasn't been redeployed with #703 yet).
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
      // A reconnect (or any other trigger) came in while we were
      // mid-flight — fire the refresh now instead of waiting up to a
      // full cadence for the next scheduled tick.
      if (pendingPollRequest && !cancelled) {
        pendingPollRequest = false;
        reschedulePoll(0);
      }
    }
  };

  // Single source of truth for the polling cadence: cancels any
  // pending timer and starts a fresh one. Previously the code path
  // mixed an unconditional `void poll()` on subscribe with a separate
  // `schedulePoll` recursion AND a parallel `void poll()` on every WS
  // reconnect, which produced two near-simultaneous `/api/v1/trades`
  // requests on first paint (immediate fire + 3 s rescheduled tick
  // during the WS handshake) and another race window every reconnect
  // (parallel poll + scheduled tick landing inside 50 ms of each
  // other). See the "duplicate /api/v1/trades bursts" audit. Funnelling
  // every trigger through `reschedulePoll` collapses those races: at
  // most one timer is queued at a time, and `poll()`'s own re-entry
  // guard + `pendingPollRequest` flag handle the in-flight overlap.
  const reschedulePoll = (delay: number) => {
    if (cancelled) return;
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void poll().finally(() => {
        if (cancelled) return;
        reschedulePoll(
          ws?.isConnected ? POLL_INTERVAL_WS_OPEN_MS : POLL_INTERVAL_WS_CLOSED_MS,
        );
      });
    }, delay);
  };

  // Initial fetch fires immediately — the WS only pushes live trades
  // (no snapshot/backfill on subscribe), so the recent-trades feed
  // depends on this REST call to populate its initial rows.
  reschedulePoll(0);

  // Re-poll when the WS reconnects (e.g. after a tab wake,
  // captive-portal blip, NAT eviction). The regular 15s cadence would
  // otherwise leave the feed stale for up to a full cycle before live
  // events resume, and any trades broadcast WHILE the socket was
  // wedged are visible only via REST until then. Issue #824. We
  // *reschedule* through the shared timer (rather than firing a
  // parallel `void poll()`) so a reconnect that lands 50 ms before a
  // scheduled tick coalesces into one request instead of two.
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
  // Same role as `subscribeFeed`'s `pendingPollRequest` — see that
  // helper's JSDoc for the rationale.
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
      // Same rationale as `subscribeFeed`: `routerTrade` is the only
      // graduation-aware trade source. Curve-phase trades still live there
      // (Zap also wraps on-curve buys/sells), so a single fetch path covers
      // both phases.
      const trades = await fetchRouterTradesByToken(address, 30);
      if (cancelled) return;
      // Seed the name cache from the API-enriched labels (issue #703).
      // Strictly an optimisation for the per-token tab today
      // (`TradesTab` renders the parent token's ticker rather than
      // each trade's `tokenName`), but keeps the cache hydrated for
      // any other surface watching this address's name.
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
      if (pendingPollRequest && !cancelled) {
        pendingPollRequest = false;
        reschedulePoll(0);
      }
    }
  };

  // Single-timer polling cadence — see `subscribeFeed`'s
  // `reschedulePoll` JSDoc for the rationale.
  const reschedulePoll = (delay: number) => {
    if (cancelled) return;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    timer = setTimeout(() => {
      timer = null;
      void poll().finally(() => {
        if (cancelled) return;
        reschedulePoll(
          ws?.isConnected ? POLL_INTERVAL_WS_OPEN_MS : POLL_INTERVAL_WS_CLOSED_MS,
        );
      });
    }, delay);
  };

  // Initial fetch fires immediately — the WS doesn't backfill, so
  // populating the per-token trade list depends on this REST call.
  reschedulePoll(0);

  // Re-poll on WS reconnect so the per-token tab catches any trades
  // that fired while the socket was wedged. Same rationale as
  // `subscribeFeed` above (issue #824) — reschedule through the
  // shared timer instead of firing a parallel `void poll()` so a
  // reconnect that lands close to a scheduled tick coalesces into
  // one request.
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
