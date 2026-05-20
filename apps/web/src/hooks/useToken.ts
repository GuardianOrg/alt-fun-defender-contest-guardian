import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { applyGraduationRatchet } from "./graduationRatchet";
import { cacheTokenDetail, readCachedToken } from "./tokenDetailCache";
import { useWallet } from "./useWallet";
import {
  applyTokenOverride,
  getTokenOverride,
  subscribeTokenOverrides,
} from "../dev/devTokenOverrides";
import { tokenService } from "../services/tokenService";

import type { Token } from "../services/types";

/**
 * Pull the most-recent cached `Token` for `address` out of the home
 * table's infinite-scroll cache (`["tokens-infinite", …]`, populated
 * by `useInfiniteTokens` and shared with `useTokens` per its JSDoc).
 * Returns the first match (case-insensitive on address) or `undefined`.
 *
 * Used before the localStorage token-detail cache so navigating from a
 * list paints the freshest in-session copy first; a recently visited
 * token still has a persisted fallback after a reload or flaky endpoint.
 * The fresh fetch runs in the background and detail-only fields snap in
 * once it resolves.
 */
function findCachedTokenInLists(
  queryClient: QueryClient,
  address: string | undefined,
): Token | undefined {
  if (!address) return undefined;
  const target = address.toLowerCase();
  // `useTokens` and `useInfiniteTokens` now share a single cache entry
  // under `["tokens-infinite", …]` (see `useTokens.ts` JSDoc). The
  // previous `["tokens", …]` namespace is no longer populated by any
  // hook, so scanning it would just be dead work.
  for (const [, data] of queryClient.getQueriesData<{
    pages: Token[][];
  }>({ queryKey: ["tokens-infinite"] })) {
    const pages = data?.pages;
    if (!pages) continue;
    for (const page of pages) {
      const hit = page.find((t) => t.address.toLowerCase() === target);
      if (hit) return hit;
    }
  }
  return undefined;
}

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
export function tokenRefetchInterval(token: Token | undefined): number | false {
  return token?.status === "graduating" ? GRADUATING_POLL_INTERVAL_MS : false;
}

export function useToken(address: string | undefined) {
  // Connected wallet enables the holder-aware bypass for admin-hidden
  // tokens (issue #712): a wallet that already holds a hidden token
  // can still load its detail page so it can sell out. The wallet is
  // baked into the query key so a connect / disconnect / wallet switch
  // re-fetches under the right lens (public 404 vs holder-only 200).
  const { address: wallet } = useWallet();
  const queryClient = useQueryClient();
  // Snapshot the list-cache entry once per `address` change. The
  // placeholder is consulted by React Query at query-mount time only —
  // the real fetch always supersedes it — so recomputing on every
  // parent re-render would just be wasted work. Memoised on the
  // queryClient ref + address so a wallet switch (which re-keys the
  // query) still picks up the latest cached snapshot.
  const placeholder = useMemo(
    () =>
      findCachedTokenInLists(queryClient, address) ?? readCachedToken(address),
    [queryClient, address],
  );
  const query = useQuery({
    queryKey: ["token", address, wallet ?? null],
    queryFn: () => {
      if (!address) throw new Error("Address required");
      return tokenService.getToken(address, wallet);
    },
    enabled: !!address,
    refetchInterval: (query) => tokenRefetchInterval(query.state.data),
    placeholderData: placeholder,
  });

  // Dev-only overlay (DCE'd in production by the `import.meta.env.DEV`
  // gate below). The override store lives outside the TanStack Query
  // cache so WS-driven invalidations from `useTokenLiveFeed` keep
  // refreshing the underlying real data each tick — clearing the
  // override snaps back to the API response on the next render with
  // no refetch required. See `dev/devTokenOverrides.ts`.
  const override = useSyncExternalStore(
    subscribeTokenOverrides,
    () => (import.meta.env.DEV ? getTokenOverride(address) : undefined),
    () => undefined,
  );

  const data = useMemo(() => {
    const rawData = query.data ?? placeholder;
    if (!rawData) return rawData;
    // Pin the graduated lifecycle before any other transform: the
    // ratchet protects against the API's degraded path silently
    // flipping a previously-graduated token back to `status: "curve"`
    // (the on-chain `Bonding.TokenGraduated` event has no inverse, so
    // any such response is a transient data error — see
    // `graduationRatchet.ts`). Running the ratchet *first* means any
    // dev override layered on top still wins for QA flows that
    // explicitly want to inspect a non-graduated lens.
    const ratcheted = applyGraduationRatchet(rawData);
    if (!override) return ratcheted;
    return applyTokenOverride(ratcheted, override);
  }, [query.data, placeholder, override]);

  useEffect(() => {
    if (!data) return;
    cacheTokenDetail(data);
  }, [data]);

  // Re-shape the query result with the transformed `data`. We can't
  // just mutate `query.data` (TanStack Query owns that reference) and
  // returning a fresh object every render is fine — consumers
  // destructure `{ data, isError, isLoading }`, none of which are
  // referentially compared.
  const isCachedFallback = !query.data && !!data && query.isFetched;
  return { ...query, data, isCachedFallback };
}
