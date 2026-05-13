import { useEffect, useMemo, useState } from "react";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { subscribeMockTokens } from "../dev/mockFeed";
import { tokenService, TOKENS_PAGE_SIZE } from "../services/tokenService";

import type { Token, TokenFilter } from "../services/types";

/**
 * Token list for the home page + search modal. The server handles all
 * sorting — including the trending score — so the client just consumes the
 * order the API returns. That keeps the ranking honest at any catalogue
 * size (previously, sorting client-side over a 100-token window would
 * silently drop out-of-window trending tokens).
 */
export function useTokens(filter?: TokenFilter) {
  return useQuery({
    queryKey: ["tokens", filter],
    queryFn: () => tokenService.getTokens(filter),
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
 */
export function useInfiniteTokens(filter?: TokenFilter) {
  const query = useInfiniteQuery({
    queryKey: ["tokens-infinite", filter],
    queryFn: ({ pageParam }) =>
      tokenService.getTokensPage(filter, pageParam, TOKENS_PAGE_SIZE),
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
    if (mockTokens.length === 0) return fromQuery;
    // De-duplicate by address — a real API response that happens to
    // include a mock-shaped address (the random hex is statistically
    // unique, but make the merge robust to refetch overlap anyway).
    const seen = new Set<string>();
    const merged: Token[] = [];
    for (const t of mockTokens) {
      const key = t.address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }
    for (const t of fromQuery) {
      const key = t.address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }
    return merged;
  }, [query.data, mockTokens]);

  return { ...query, tokens };
}
