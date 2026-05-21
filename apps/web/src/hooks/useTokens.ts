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

/** Stable cache key for table filters, with `undefined` fields stripped. */
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

/** Dedupe paginated results when a shifting sort moves a token across page boundaries. */
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

/** Normalise omitted filters so compact consumers share the trending cache. */
export function normalizeTokenFilter(
  filter: TokenFilter | undefined,
): TokenFilter {
  return filter ?? "trending";
}

// WS invalidation is primary; this catches missed events or no-WS environments.
const FALLBACK_REFETCH_MS = 60_000;

/**
 * Single-shot first-page view over the token catalogue. Delegates to
 * `useInfiniteTokens` so compact consumers share the table cache when keys match.
 */
export function useTokens(
  filter?: TokenFilter,
  tableFilters?: TokenTableFiltersInput,
  sort: TokenSort = "default",
) {
  const result = useInfiniteTokens(filter, tableFilters, sort);
  // Preserve the old first-page `data` shape without leaking table pagination into compact panels.
  const firstPage = result.data?.pages[0];
  const data = useMemo(
    () => (firstPage ? dedupeTokensByAddress(firstPage) : undefined),
    [firstPage],
  );
  return { ...result, data };
}

/** Infinite-scroll token catalogue; filters and sort participate in the cache key. */
export function useInfiniteTokens(
  filter?: TokenFilter,
  tableFilters?: TokenTableFiltersInput,
  sort: TokenSort = "default",
) {
  // Normalise omitted filter so search modal and trending table share cache.
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
      // Short page means exhausted.
      if (lastPage.length < TOKENS_PAGE_SIZE) return undefined;
      return allPages.length * TOKENS_PAGE_SIZE;
    },
    refetchInterval: FALLBACK_REFETCH_MS,
  });

  // Dev-only rows let `DevSimulator` exercise new-token flashes.
  const [mockTokens, setMockTokens] = useState<Token[]>([]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    return subscribeMockTokens((token) => {
      setMockTokens((prev) => [token, ...prev]);
    });
  }, []);

  const tokens = useMemo(() => {
    const fromQuery = query.data?.pages.flat() ?? [];
    // Always dedupe; rolling sorts can move a token between consecutive pages.
    if (mockTokens.length === 0) return dedupeTokensByAddress(fromQuery);
    // Mock rows bypass the API, so apply active filters client-side.
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
    // Mocks first so freshly injected rows stay pinned.
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
