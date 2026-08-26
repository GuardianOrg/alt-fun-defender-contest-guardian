import { useQuery } from "@tanstack/react-query";

import { fetchTokenLocks } from "../services/api";
import { indexTokenLocks } from "../utils/locks";

import type { ApiTokenLock } from "../services/api";

/**
 * Locks only change when a creator creates one or a cliff passes, so there is
 * nothing to poll for — deliberately no `refetchInterval`, unlike the
 * balance- and price-driven hooks. A long `staleTime` means the whole app
 * shares one request per session per mount tree.
 */
const STALE_TIME_MS = 5 * 60 * 1000;

/**
 * One retry, then give up. A failed lock read renders as "no badge", which is
 * the same conservative outcome as a token genuinely having no lock — so
 * hammering the endpoint buys nothing.
 */
const RETRY_COUNT = 1;

const EMPTY = new Map<string, ApiTokenLock>();

/**
 * Supply locks for every token that has one, keyed by lowercased address.
 *
 * Every subscriber shares a single query, so calling this per row is cheap.
 * An absent entry means "no active lock" — the API only returns locks that
 * are non-cancelable, unlock in one cliff, still have over a week to run, and
 * cover at least a tenth of supply (see `apps/api/src/lib/token-locks.ts`).
 */
export function useTokenLocks(): {
  locks: Map<string, ApiTokenLock>;
  getLock: (address: string) => ApiTokenLock | undefined;
} {
  const { data } = useQuery({
    queryKey: ["token-locks"],
    queryFn: async () => {
      const { locks } = await fetchTokenLocks();
      return indexTokenLocks(locks);
    },
    staleTime: STALE_TIME_MS,
    retry: RETRY_COUNT,
  });

  const locks = data ?? EMPTY;
  return { locks, getLock: (address) => locks.get(address.toLowerCase()) };
}
