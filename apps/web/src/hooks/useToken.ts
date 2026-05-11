import { useQuery } from "@tanstack/react-query";

import { tokenService } from "../services/tokenService";

import type { Token } from "../services/types";

/**
 * Poll cadence used as a safety net while a token sits in the
 * graduating window (phase 1 of the two-phase graduation has fired,
 * `finalizeGraduation` hasn't yet). The primary signal that drives the
 * UI out of the "Token is graduating" overlay is the `graduation`
 * WebSocket channel — see `useGraduationFeed`. This poll only exists to
 * guarantee the transition still happens when the WS broadcast doesn't
 * land (issue #600):
 *
 *   - `VITE_WS_URL` unset (e.g. preview deploys without a WS endpoint).
 *   - WebSocket disconnected at the exact moment the event fires.
 *   - Indexer's `isLiveEvent` 60s window suppresses a broadcast for an
 *     event whose block timestamp is older than the wall clock
 *     (`finalizeGraduation` confirmation can drift past 60s under
 *     mempool congestion or HyperEVM big-block propagation tail).
 *   - Webhook delivery failed (1s timeout, no retry).
 *   - One of the WebSocketDO shards is unhealthy and drops the fan-out.
 *
 * 3s gives a snappy recovery within the typical 60–120s graduation
 * window without meaningfully loading the API: the `/tokens/:addr`
 * endpoint sits behind a 2s edge cache, so concurrent users sitting on
 * the same graduating token collapse onto a single origin fetch per
 * window. TanStack Query also pauses `refetchInterval` while the tab
 * is hidden, so a backgrounded token detail page costs nothing.
 *
 * No polling outside the graduating state — the WebSocket-driven
 * invalidation is more than sufficient for the normal trade flow and
 * we don't want every open token tab generating background load on the
 * API forever.
 */
const GRADUATING_POLL_INTERVAL_MS = 3_000;

/**
 * Picks the `refetchInterval` used by `useToken`. Exported (and pure)
 * so the graduating-window safety-net behaviour can be unit-tested
 * without rendering the hook through a `QueryClient`.
 */
export function tokenRefetchInterval(
  token: Token | undefined,
): number | false {
  return token?.status === "graduating"
    ? GRADUATING_POLL_INTERVAL_MS
    : false;
}

export function useToken(address: string | undefined) {
  return useQuery({
    queryKey: ["token", address],
    queryFn: () => {
      if (!address) throw new Error("Address required");
      return tokenService.getToken(address);
    },
    enabled: !!address,
    refetchInterval: (query) => tokenRefetchInterval(query.state.data),
  });
}
