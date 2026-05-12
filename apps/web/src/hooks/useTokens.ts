import { useMemo } from "react";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { tokenService, TOKENS_PAGE_SIZE } from "../services/tokenService";

import type { TokenFilter } from "../services/types";

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

  const tokens = useMemo(
    () => query.data?.pages.flat() ?? [],
    [query.data],
  );

  return { ...query, tokens };
}
