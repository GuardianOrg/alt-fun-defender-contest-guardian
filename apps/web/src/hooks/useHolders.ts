import { useQuery } from "@tanstack/react-query";

import { tradeService } from "../services/tradeService";

import type { Holder } from "../services/types";

// Poll cadence for the holders tab. Holder balances move on every
// `Token.Transfer` (every buy/sell through `Zap`, plus wallet-to-wallet
// transfers), so a one-shot fetch on tab mount goes stale the moment the
// curve sees activity. 5s is the product floor from issue #452 (sibling
// cadence to creator rewards #454 and 24h volume #453) and is cheap:
// `/api/v1/holders/:address` is sourced from the indexer's `tokenBalances`
// index (see PR #412), so each poll is one Worker-edge request that
// fans out to a single Postgres scan.
const REFETCH_INTERVAL_MS = 5_000;

/**
 * Fetch the top holders for a token and keep them refreshed on a 5s
 * cadence. TanStack Query pauses `refetchInterval` automatically while the
 * tab is hidden, so a backgrounded token detail page does not burn API
 * quota.
 */
export function useHolders(address: string | undefined) {
  return useQuery<Holder[]>({
    queryKey: ["holders", address],
    queryFn: () => {
      if (!address) throw new Error("Address required");
      return tradeService.getHolders(address);
    },
    enabled: !!address,
    refetchInterval: REFETCH_INTERVAL_MS,
    // The previous one-shot `useEffect` always rendered an empty list
    // until the first response landed; preserve that UX by defaulting
    // to `[]` rather than `undefined` while the first fetch is in flight.
    placeholderData: [],
  });
}
