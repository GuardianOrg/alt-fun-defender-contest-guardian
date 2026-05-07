import { useQuery } from "@tanstack/react-query";

import { tokenService } from "../services/tokenService";

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
