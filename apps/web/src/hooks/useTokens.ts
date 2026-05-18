import { useEffect, useMemo, useState } from "react";

import { useInfiniteQuery } from "@tanstack/react-query";

import { subscribeMockTokens } from "../dev/mockFeed";
import {
  tokenService,
  TOKENS_PAGE_SIZE,
  type TokenSort,
  type TokenTableFiltersInput,
} from "../services/tokenService";

import type { Token, TokenFilter } from "../services/types";

/**
 * Stable cache key for a `TokenTableFiltersInput` — strips `undefined`
 * fields so `{ underlying: "HYPE", leverage: undefined }` keys the same
 * as `{ underlying: "HYPE" }`. Keeps TanStack Query from spinning up a
 * fresh fetch every time the caller passes a new object literal that's
 * semantically identical.
 */
function tableFiltersKey(filters: TokenTableFiltersInput | undefined): {
  underlying?: string;
  leverage?: number;
  direction?: "long" | "short";
} {
  if (!filters) return {};
  const out: {
    underlying?: string;
    leverage?: number;
    direction?: "long" | "short";
  } = {};
  if (filters.underlying !== undefined) out.underlying = filters.underlying;
  if (filters.leverage !== undefined) out.leverage = filters.leverage;
  if (filters.direction !== undefined) out.direction = filters.direction;
  return out;
}

/**
 * Drop later duplicates by lowercased address while preserving the
 * first occurrence's position. The infinite-scroll list concatenates
 * page results without coordination, so when the API's trending pool
 * shifts between a page-N and page-(N+1) fetch — a real possibility on
 * the trending sort, where the rolling 24h volume ranking on the
 * indexer's `token_hourly_metrics` table can move tokens across page
 * boundaries as fresh trades land (closing/opening hour buckets) — the
 * same token can land in two pages and render as a visible duplicate row
 * (issue #877). Same address normalisation as the rest of the codebase
 * (lowercase) so a mixed-case API response can't sneak two copies past
 * the dedupe.
 *
 * Exported so the dedupe semantics can be unit-tested without the
 * React Query / hook harness.
 */
export function dedupeTokensByAddress(tokens: readonly Token[]): Token[] {
  const seen = new Set<string>();
  const out: Token[] = [];
  for (const t of tokens) {
    const key = t.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * `undefined` and `"trending"` produce the same server-side response —
 * both resolve to `sort=trending` in `filterToApiOptions` (see
 * `tokenService.ts`). Normalising the value before it lands in the
 * query key lets a caller that omits the filter (`useTokens()` from
 * `SearchModal`) share a single cache entry with one that passes
 * `"trending"` explicitly (`useInfiniteTokens("trending", …)` from
 * `TokenTable`). Without this, the two callers used to fire parallel
 * `/api/v1/tokens?sort=trending` requests on every paint and every
 * background refetch.
 *
 * Exported so the normalisation can be unit-tested without spinning
 * up a `QueryClient`.
 */
export function normalizeTokenFilter(
  filter: TokenFilter | undefined,
): TokenFilter {
  return filter ?? "trending";
}

/**
 * Background-refetch fallback for the token catalogue.
 *
 * Active refresh is driven by `useTokenListLiveFeed`, which invalidates
 * the `["tokens-infinite", …]` cache (and `["market-data"]`) on every
 * WS `trade` broadcast — throttled to 1 s — so on a tab with a healthy
 * WS connection the catalogue is already kept live without any
 * `refetchInterval` ticking at all. This fallback exists for the
 * degraded paths where the WS-driven path can't carry the update:
 *
 *   - `VITE_WS_URL` unset (local dev without the API Worker, preview
 *     builds without a WS endpoint) — the `useTokenListLiveFeed` effect
 *     no-ops.
 *   - The user's WS connection is wedged longer than the
 *     visibility/online wake probe takes to detect.
 *   - Backend writes that don't fan out a `trade` broadcast at all —
 *     admin moderation (`useTokenModeration`), `graduation`-channel
 *     events handled by `useGraduationFeed`'s own invalidator.
 *
 * Previously this hook polled every 10 s on top of the WS-driven
 * invalidations, which doubled the request rate against
 * `/api/v1/tokens` for every user without buying any extra liveness.
 * 60 s is "we'll catch a missed event within a minute" — plenty for
 * the degraded paths above, where the alternative is no refresh until
 * the user reloads the page.
 */
const FALLBACK_REFETCH_MS = 60_000;

/**
 * Single-shot view over the home-page token catalogue.
 *
 * Delegates to `useInfiniteTokens` so consumers that only need the top
 * of the list (the SearchModal trending strip, the RightPanel
 * "graduating soon" panel, the DevSimulator's token dropdown) share
 * the same TanStack Query cache entry as the home-page table when the
 * `(filter, tableFilters, sort)` tuple matches.
 *
 * The previous shape ran a parallel `useQuery` with a `["tokens", …]`
 * key against the same `/api/v1/tokens` endpoint, so on a homepage
 * with the SearchModal mounted (it always is, since `useSearchModal`
 * runs unconditionally) and the table on trending we'd fire two
 * `/api/v1/tokens?sort=trending` requests on first paint and again on
 * every 10 s refetch interval. The audit captured in the "duplicate
 * /api/v1/trades and /api/v1/tokens bursts" task. After this change
 * SearchModal + TokenTable on `trending` collapse onto one request;
 * RightPanel's `useTokens("graduating")` still owns its own cache
 * entry (the table is rarely on the `graduating` tab) but pays the
 * same single-shot cost as before.
 *
 * The returned `data` is the first page (≤ `TOKENS_PAGE_SIZE` rows) —
 * enough for SearchModal's `slice(0, 5)` trending strip and
 * RightPanel's `slice(0, GRADUATING_SOON_LIMIT)` (≤ 8) graduating
 * list. Consumers that need the full catalogue should use
 * `useInfiniteTokens` directly.
 */
export function useTokens(
  filter?: TokenFilter,
  tableFilters?: TokenTableFiltersInput,
  sort: TokenSort = "default",
) {
  const result = useInfiniteTokens(filter, tableFilters, sort);
  // Preserve the old `useQuery<Token[]>` shape so SearchModal /
  // RightPanel / DevSimulator continue to destructure `{ data, isLoading }`
  // unchanged. `result.data` is the raw `useInfiniteQuery` `{ pages }`
  // payload — truthy iff the first page has resolved, so a successful
  // empty-result fetch surfaces as `data: []` (not `undefined`) and
  // the consumer-side empty-state branch fires correctly instead of
  // rendering a stuck skeleton.
  const data = useMemo(
    () => (result.data ? result.tokens : undefined),
    [result.data, result.tokens],
  );
  return { ...result, data };
}

/**
 * Infinite-scroll variant of `useTokens` for the home-page token table.
 * Walks `/api/v1/tokens` page-by-page (page size = `TOKENS_PAGE_SIZE`) so
 * we render the catalogue in batches instead of loading every token up
 * front. `hasNextPage` becomes false once the server returns a short
 * page — that's the canonical "end of list" signal, matching how
 * `fetchAllTokens` walks the same endpoint.
 *
 * Returns a `tokens` array flattened across all fetched pages so
 * callers don't have to re-flatten on every render.
 *
 * `tableFilters` are forwarded to the API and participate in the
 * cache key so flipping a facet (e.g. Market: HYPE) triggers a fresh
 * paginated walk rather than re-using the unfiltered cache. `sort`
 * (TRENDING / GRADUATED only — the Sort dropdown is hidden on NEW
 * and GRADUATING) participates in the cache key for the same
 * reason: switching from `Trending` to `Mcap` must trigger a fresh
 * page-1 fetch, not splice mismatched rows onto the existing pages.
 */
export function useInfiniteTokens(
  filter?: TokenFilter,
  tableFilters?: TokenTableFiltersInput,
  sort: TokenSort = "default",
) {
  // Normalise `undefined` → `"trending"` so `useTokens()` (search modal)
  // shares the cache with `useInfiniteTokens("trending", …)` (table).
  // See `normalizeTokenFilter` JSDoc.
  const normalizedFilter = normalizeTokenFilter(filter);
  const filtersKey = tableFiltersKey(tableFilters);
  const query = useInfiniteQuery({
    queryKey: ["tokens-infinite", normalizedFilter, filtersKey, sort],
    queryFn: ({ pageParam }) =>
      tokenService.getTokensPage(
        normalizedFilter,
        pageParam,
        TOKENS_PAGE_SIZE,
        tableFilters,
        sort,
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // Short page ⇒ exhausted. Matches the server's pagination
      // contract: the API returns `< limit` rows iff there's nothing
      // more to fetch.
      if (lastPage.length < TOKENS_PAGE_SIZE) return undefined;
      return allPages.length * TOKENS_PAGE_SIZE;
    },
    refetchInterval: FALLBACK_REFETCH_MS,
  });

  // Dev-only easter egg: tokens injected via `DevSimulator` get
  // prepended to the rendered list so the new-token flash UI can be
  // exercised without a fresh on-chain `Zap.createToken` round-trip.
  // `subscribeMockTokens` is never emitted into outside dev mode, and
  // bundlers strip the subscribe call on `vite build`.
  const [mockTokens, setMockTokens] = useState<Token[]>([]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    return subscribeMockTokens((token) => {
      setMockTokens((prev) => [token, ...prev]);
    });
  }, []);

  const tokens = useMemo(() => {
    const fromQuery = query.data?.pages.flat() ?? [];
    // Always dedupe by address, even with zero mock tokens — see
    // `dedupeTokensByAddress` for the trending-pool-shift scenario that
    // makes the same token appear in two consecutive pages
    // (issue #877). The mock-merge path below keeps relying on the
    // same helper so the dev easter egg can't double-insert either.
    if (mockTokens.length === 0) return dedupeTokensByAddress(fromQuery);
    // Dev mock tokens bypass the API, so the server-side filters never
    // touch them. Apply the same predicates client-side so a mock HYPE
    // 2× Long row doesn't pollute a "Market: BTC" view in dev.
    const filteredMocks = mockTokens.filter((t) => {
      if (filtersKey.underlying && t.underlying !== filtersKey.underlying) {
        return false;
      }
      if (filtersKey.leverage !== undefined && t.leverage !== filtersKey.leverage) {
        return false;
      }
      if (filtersKey.direction && t.direction !== filtersKey.direction) {
        return false;
      }
      return true;
    });
    if (filteredMocks.length === 0) return dedupeTokensByAddress(fromQuery);
    // Mocks first so the dev easter egg's freshly-injected rows stay
    // pinned at the top, then real query pages — `dedupeTokensByAddress`
    // drops any later collisions while preserving that ordering.
    return dedupeTokensByAddress([...filteredMocks, ...fromQuery]);
  }, [
    query.data,
    mockTokens,
    filtersKey.underlying,
    filtersKey.leverage,
    filtersKey.direction,
  ]);

  return { ...query, tokens };
}
