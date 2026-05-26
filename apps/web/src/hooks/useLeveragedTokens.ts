import { useMemo } from "react";

import { getLeverageOptions } from "@launchpad/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchLeveragedTokens } from "../services/api";

import type { LiveLeveragedToken } from "@launchpad/shared";

/**
 * Live snapshot of BounceTech's leveraged-token directory. Surfaces every
 * field the indexing API exposes — most callers only care about
 * `mintPaused` (gates buys) and `exchangeRate` (already pre-baked into the
 * curve numbers our own API returns).
 *
 * The 30s refetch matches BounceTech's own UI cadence — pause events are
 * incident-driven (we'd rather show a "buys paused" banner ~30s late than
 * burn through their rate-limit polling per second). `staleTime: 15_000`
 * lets multiple subscribers on the same page share one underlying request.
 */
export function useLeveragedTokens() {
  return useQuery({
    queryKey: ["leveragedTokens"],
    queryFn: fetchLeveragedTokens,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/**
 * Case-insensitive lookup for a single LT in the directory. Returns
 * `undefined` while the query is loading or if the LT isn't present —
 * callers must treat the missing case as "unknown" rather than "not
 * paused" so we never flip a paused banner off mid-fetch.
 */
export function findLeveragedTokenByAddress(
  lts: readonly LiveLeveragedToken[] | undefined,
  ltAddress: string | undefined,
): LiveLeveragedToken | undefined {
  if (!ltAddress || !lts) return undefined;
  const target = ltAddress.toLowerCase();
  return lts.find((lt) => lt.address.toLowerCase() === target);
}

/**
 * `true` only when we know the LT is mint-paused. `false` is returned for
 * unknown / loading / missing — the caller should keep the buy UI enabled
 * (default state) until BounceTech has spoken. Returning `null` here would
 * force every call site to handle a third state with no extra UX value;
 * the worst-case is the user gets a clean revert from BounceTech rather
 * than a pre-emptive lockout, which is the same fallback as before this
 * code existed.
 */
export function useIsMintPaused(ltAddress: string | undefined): boolean {
  const lt = useLeveragedToken(ltAddress);
  return lt?.mintPaused === true;
}

/** Convenience selector for components that want the whole LT record. */
export function useLeveragedToken(
  ltAddress: string | undefined,
): LiveLeveragedToken | undefined {
  const { data } = useLeveragedTokens();
  return useMemo(
    () => findLeveragedTokenByAddress(data, ltAddress),
    [data, ltAddress],
  );
}

export function useLeverageOptions(
  asset?: string,
  isLong?: boolean,
): number[] {
  const { data } = useLeveragedTokens();
  return useMemo(
    () => getLeverageOptions(data ?? [], asset, isLong),
    [data, asset, isLong],
  );
}
