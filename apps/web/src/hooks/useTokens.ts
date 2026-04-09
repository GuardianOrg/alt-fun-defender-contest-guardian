import { useQuery } from "@tanstack/react-query";

import { tokenService } from "../services/tokenService";

import type { Direction, TokenFilter } from "../services/types";

export function useTokens(filter?: TokenFilter) {
  return useQuery({
    queryKey: ["tokens", filter],
    queryFn: () => tokenService.getTokens(filter),
  });
}

export function useTokensByDirection(
  direction: Direction,
  filter?: TokenFilter,
) {
  return useQuery({
    queryKey: ["tokens", direction, filter],
    queryFn: () => tokenService.getTokensByDirection(direction, filter),
    refetchInterval: 10_000,
  });
}
