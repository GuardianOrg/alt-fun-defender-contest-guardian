import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { useTokenPrices } from "./useTokenPrices";
import { tokenService } from "../services/tokenService";

import type { Direction, Token, TokenFilter } from "../services/types";

/**
 * Apply the live mcap-aware "trending" ordering when the caller asks for it
 * (explicitly or by default). Other filters already preserve the server order.
 */
function useMcapSortedTokens(
  tokens: Token[] | undefined,
  filter: TokenFilter | undefined,
): Token[] | undefined {
  const { prices } = useTokenPrices();

  return useMemo(() => {
    if (!tokens) return tokens;
    if (filter !== "trending" && filter !== undefined) return tokens;

    const mcapOf = (t: Token): number => {
      const live = prices[t.address.toLowerCase()]?.mcapUsd;
      return typeof live === "number" && live > 0 ? live : t.mcapUsd;
    };

    const graduated = tokens.filter((t) => t.status === "graduated");
    const active = tokens.filter((t) => t.status !== "graduated");
    active.sort((a, b) => mcapOf(b) - mcapOf(a));
    const king = graduated.sort((a, b) => mcapOf(b) - mcapOf(a))[0];
    return king ? [king, ...active] : active;
  }, [tokens, filter, prices]);
}

export function useTokens(filter?: TokenFilter) {
  const query = useQuery({
    queryKey: ["tokens", filter],
    queryFn: () => tokenService.getTokens(filter),
  });
  const sorted = useMcapSortedTokens(query.data, filter);
  return { ...query, data: sorted };
}

export function useTokensByDirection(
  direction: Direction,
  filter?: TokenFilter,
) {
  const query = useQuery({
    queryKey: ["tokens", direction, filter],
    queryFn: () => tokenService.getTokensByDirection(direction, filter),
    refetchInterval: 10_000,
  });
  const sorted = useMcapSortedTokens(query.data, filter);
  return { ...query, data: sorted };
}
