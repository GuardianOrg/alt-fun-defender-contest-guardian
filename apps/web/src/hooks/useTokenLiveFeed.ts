import { useEffect } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { getWebSocketClient } from "../services/websocket";

import type { TradeBroadcast } from "../services/types";

/**
 * Window over which trade-driven invalidations are coalesced.
 *
 * Each `Zap.buy` / `Zap.sell` on a single token fires *two* broadcasts on
 * the `trade` channel (a `Zap:Buy`/`Sell` row + a `Bonding:Trade` chart
 * state — see `packages/shared/src/types/trade.ts`). On a trending token
 * a string of buyers can produce a dozen broadcasts per second; without
 * throttling the client would chain `/tokens/:addr` refetches in a tight
 * loop just to redraw the same curve strip.
 *
 * 1s is the smallest cadence at which the curve bar still reads as
 * "moving" to a human eye, and lines up roughly with the API's edge
 * cache (`/tokens/:addr` is held by Cloudflare for ~2s — see the JSDoc
 * on `useToken`). Going faster would just pile up requests in front of
 * the cache.
 *
 * The throttle is **leading + trailing**: the first event in a quiet
 * period fires the refetch immediately (so a single trade lands "live"),
 * and any further events within the window queue exactly one trailing
 * refetch at the window's close — guaranteeing the latest state of a
 * burst is never dropped.
 */
const INVALIDATE_THROTTLE_MS = 1_000;

/**
 * Pure predicate: does this `trade` broadcast belong to the token at
 * `normalizedAddress` (already lowercased)?
 *
 * The WS subject shard is per-token already, so in practice every
 * payload landing on this subscription matches — but the indexer is the
 * source of truth here, not the routing layer, so we still gate on the
 * payload's `tokenAddress` defensively. Exported so the case-folding
 * + nullable-tokenAddress edge cases can be unit-tested without the WS
 * harness.
 */
export function isLiveUpdateForToken(
  raw: TradeBroadcast,
  normalizedAddress: string,
): boolean {
  return raw.tokenAddress?.toLowerCase() === normalizedAddress;
}

export interface TradeFeedInvalidator {
  /** Forward a trade-channel hit through the throttle. */
  handle: () => void;
  /** Cancel any pending trailing fire — call on unsubscribe. */
  dispose: () => void;
}

/**
 * Build a leading + trailing throttle around `invalidate`.
 *
 * Extracted from `useTokenLiveFeed` as a plain factory so the throttle
 * behaviour can be exercised under `vi.useFakeTimers()` without a
 * `QueryClient` / WebSocket harness — matches the
 * `composeLiveVolume` / `tradeBroadcastToUsd` split in
 * `useLiveTokenVolume24h.ts`.
 *
 * `now` is injectable to keep the unit tests self-contained; production
 * callers leave it at `Date.now`.
 */
export function createTradeFeedInvalidator(
  invalidate: () => void,
  throttleMs: number,
  now: () => number = Date.now,
): TradeFeedInvalidator {
  // Sentinel so the very first call always satisfies `elapsed >= throttleMs`,
  // even under fake timers that start at 0. A plain `0` would treat
  // `now() === 0` as "just fired" and miss the leading edge.
  let lastFiredAt = Number.NEGATIVE_INFINITY;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;

  const fire = () => {
    lastFiredAt = now();
    invalidate();
  };

  return {
    handle: () => {
      const elapsed = now() - lastFiredAt;
      if (elapsed >= throttleMs) {
        // Quiet period — fire immediately. Cancel any stale trailing
        // timer (left over from an earlier burst whose window has now
        // expired) so we don't double-fire one tick later.
        if (trailingTimer) {
          clearTimeout(trailingTimer);
          trailingTimer = null;
        }
        fire();
        return;
      }
      // Inside the window — coalesce. The first event schedules the
      // trailing fire at the end of the window; subsequent events are
      // dropped (the trailing fire already covers them).
      if (trailingTimer) return;
      trailingTimer = setTimeout(() => {
        trailingTimer = null;
        fire();
      }, throttleMs - elapsed);
    },
    dispose: () => {
      if (trailingTimer) {
        clearTimeout(trailingTimer);
        trailingTimer = null;
      }
    },
  };
}

/**
 * Subscribe to the `trade` WebSocket channel for a single token and keep
 * the `["token", address]` TanStack query live — the source of truth
 * behind the curve strip's progress bar, `$X raised` label, mcap, price,
 * 24h change, and 24h volume on the token detail page (issue #643).
 *
 * Companion to `useGraduationFeed`: same effect-only shape, same
 * "invalidate, don't merge" strategy, scoped to the `trade` channel
 * instead of `graduation`. We deliberately re-fetch `/tokens/:addr`
 * rather than diffing client-side because the API does non-trivial
 * enrichment (the `organicFilled` / `leverageBoost` split, USD-denoted
 * mcap, the indexer-degraded `null` sentinels — see
 * `apps/api/src/lib/token-enrich.ts` and `apps/web/AGENTS.md`'s
 * "Progress-bar breakdown" section) that we don't want to replicate
 * here.
 *
 * Throttled by `INVALIDATE_THROTTLE_MS` — see that constant's JSDoc.
 *
 * If `VITE_WS_URL` isn't set (local dev without the API Worker, preview
 * builds without a WS endpoint) this is a silent no-op. The default
 * `useToken` path still works; users just won't get the live ticks.
 * Matches `useGraduationFeed`'s degradation behaviour.
 */
export function useTokenLiveFeed(address: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!address) return;
    const ws = getWebSocketClient();
    if (!ws) return;

    const normalized = address.toLowerCase();
    const invalidator = createTradeFeedInvalidator(() => {
      queryClient.invalidateQueries({ queryKey: ["token", address] });
    }, INVALIDATE_THROTTLE_MS);

    const unsub = ws.subscribe(
      "trade",
      (data) => {
        // The WS handler signature is `(data: unknown) => void` — defend
        // against the server (or a malformed broadcast / JSON-parsed
        // `null`) sending a non-object before we touch `.tokenAddress`
        // inside `isLiveUpdateForToken`. Primitives are safe under
        // optional chaining, but `null` / `undefined` would throw on the
        // property read.
        if (data === null || typeof data !== "object") return;
        const raw = data as TradeBroadcast;
        if (!isLiveUpdateForToken(raw, normalized)) return;
        invalidator.handle();
      },
      normalized,
    );

    return () => {
      unsub();
      invalidator.dispose();
    };
  }, [address, queryClient]);
}
