import { useEffect } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { createTradeFeedInvalidator } from "./useTokenLiveFeed";
import { getWebSocketClient } from "../services/websocket";

import type { TradeBroadcast } from "../services/types";

/**
 * Window over which trade-driven invalidations are coalesced on the home
 * page token list. Mirrors `INVALIDATE_THROTTLE_MS` in `useTokenLiveFeed`
 * (the token-detail equivalent) — but the home page is observably hotter
 * than a single detail page: every trade on *any* token flows through this
 * subscription, so without a throttle a trending hour could chain dozens
 * of refetches per second of the catalogue + `/market-data` payload (the
 * latter scales with token count).
 *
 * 1s is the smallest cadence at which the MCAP / 24h change / progress
 * bar still reads as "moving" to a human eye, and lines up with the API
 * edge-cache TTLs in front of `/tokens` (10s) and `/market-data` (30s) —
 * going faster would just pile up requests in front of those caches.
 *
 * Throttle is **leading + trailing** (via `createTradeFeedInvalidator`):
 * the first trade in a quiet window fires the refetch immediately so a
 * single trade lands "live", and any further trades within the window
 * queue exactly one trailing refetch at the window's close.
 */
const INVALIDATE_THROTTLE_MS = 1_000;

/**
 * Pure predicate: does this `trade` broadcast carry enough shape to be
 * worth a list-level invalidation?
 *
 * Both broadcast variants on the `trade` channel (`Zap:Buy`/`Zap:Sell`
 * trade-list entries with `usdcAmount`, and `Bonding:Trade` /
 * `HyperSwapPair:Sync` chart-state entries with `curveSupply` /
 * `ltReserve`) signal that a token's mcap / curve state moved — the
 * predicate is variant-blind by design. We only filter out malformed
 * payloads that would no-op every downstream consumer anyway: a missing
 * `tokenAddress` means the indexer can't tell us *which* token changed,
 * so there's nothing actionable.
 *
 * Exported so the malformed-payload edge cases can be unit-tested
 * without the WS / `QueryClient` harness.
 */
export function isListLiveTradeUpdate(raw: TradeBroadcast): boolean {
  return (
    typeof raw.tokenAddress === "string" && raw.tokenAddress.trim().length > 0
  );
}

/**
 * Subscribe to the global `trade` WebSocket channel and keep the home
 * page token list live as trades land on-chain (issue #710). The
 * indexer-side `broadcastShardsFor` (see
 * `apps/api/src/websocket/durable-object.ts`) fans every per-token
 * trade broadcast out to both the token's own shard *and* the wildcard
 * `__all__` shard — so this hook subscribes to `trade` with no token,
 * landing on the wildcard shard and receiving every trade in the fleet
 * through a single connection.
 *
 * Strategy is "invalidate, don't merge": each event signals that a
 * token row's mcap / 24h change / progress bar moved, so we re-fetch
 * the catalogue + market-data round-trip rather than diffing
 * client-side. This avoids replicating the API's enrichment
 * (`organicFilled` / `leverageBoost` split, USD-denominated mcap, the
 * indexer-degraded `null` sentinels — see
 * `apps/api/src/lib/token-enrich.ts`) on the client.
 *
 * Throttled by `INVALIDATE_THROTTLE_MS` — see that constant's JSDoc.
 *
 * If `VITE_WS_URL` isn't set (local dev without the API Worker,
 * preview builds without a WS endpoint) this is a silent no-op. The
 * `useInfiniteTokens` / `useMarketData` / `useTokenPrices` poll loops
 * still tick on their own intervals; users just won't get the sub-poll
 * live updates. Matches `useTokenLiveFeed` / `useGraduationFeed`
 * degradation behaviour.
 */
export function useTokenListLiveFeed(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const ws = getWebSocketClient();
    if (!ws) return;

    const invalidator = createTradeFeedInvalidator(() => {
      // Refresh the catalogue itself so `curveFilled` /
      // `organicFilled` / `leverageBoost` (the progress bar inputs on
      // every row) pick up the new trade.
      queryClient.invalidateQueries({ queryKey: ["tokens-infinite"] });
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
      // Refresh the per-token mcap + 24h change + 24h volume map. Both
      // queries derive from `/api/v1/market-data` — they have distinct
      // keys today (pre-existing duplication) so we invalidate both to
      // keep `useTokenMarketStats` / `useTokenPrices` consumers in
      // lockstep.
      queryClient.invalidateQueries({ queryKey: ["market-data"] });
      queryClient.invalidateQueries({ queryKey: ["token-prices"] });
    }, INVALIDATE_THROTTLE_MS);

    const unsub = ws.subscribe("trade", (data) => {
      // The WS handler signature is `(data: unknown) => void` — defend
      // against the server (or a malformed broadcast / JSON-parsed
      // `null`) sending a non-object before we touch `.tokenAddress`
      // inside `isListLiveTradeUpdate`. Primitives are safe under
      // optional chaining, but `null` / `undefined` would throw on the
      // property read.
      if (data === null || typeof data !== "object") return;
      const raw = data as TradeBroadcast;
      if (!isListLiveTradeUpdate(raw)) return;
      invalidator.handle();
    });

    return () => {
      unsub();
      invalidator.dispose();
    };
  }, [queryClient]);
}
