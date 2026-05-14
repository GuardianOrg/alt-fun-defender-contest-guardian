import { useEffect, useMemo, useState } from "react";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { subscribeMockTokens } from "../dev/mockFeed";
import {
  tokenService,
  TOKENS_PAGE_SIZE,
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
 * the trending sort, where a 500-candidate pool is re-scored every
 * request and the indexer's `tokenMetrics.baseScore` index can move
 * tokens across page boundaries as fresh trades land — the same token
 * can land in two pages and render as a visible duplicate row
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
 * Token list for the home page + search modal. The server handles all
 * sorting — including the trending score — so the client just consumes the
 * order the API returns. That keeps the ranking honest at any catalogue
 * size (previously, sorting client-side over a 100-token window would
 * silently drop out-of-window trending tokens).
 */
export function useTokens(
  filter?: TokenFilter,
  tableFilters?: TokenTableFiltersInput,
) {
  return useQuery({
    queryKey: ["tokens", filter, tableFiltersKey(tableFilters)],
    queryFn: () => tokenService.getTokens(filter, tableFilters),
    refetchInterval: 10_000,
  });
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
 * paginated walk rather than re-using the unfiltered cache.
 */
export function useInfiniteTokens(
  filter?: TokenFilter,
  tableFilters?: TokenTableFiltersInput,
) {
  const filtersKey = tableFiltersKey(tableFilters);
  const query = useInfiniteQuery({
    queryKey: ["tokens-infinite", filter, filtersKey],
    queryFn: ({ pageParam }) =>
      tokenService.getTokensPage(
        filter,
        pageParam,
        TOKENS_PAGE_SIZE,
        tableFilters,
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // Short page ⇒ exhausted. Matches the server's pagination
      // contract: the API returns `< limit` rows iff there's nothing
      // more to fetch.
      if (lastPage.length < TOKENS_PAGE_SIZE) return undefined;
      return allPages.length * TOKENS_PAGE_SIZE;
    },
    refetchInterval: 10_000,
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
