import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { applyGraduationRatchet } from "./graduationRatchet";
import { cacheTokenDetail, readCachedToken } from "./tokenDetailCache";
import { useWallet } from "./useWallet";
import {
  applyTokenOverride,
  getTokenOverride,
  subscribeTokenOverrides,
} from "../dev/devTokenOverrides";
import { tokenService } from "../services/tokenService";

import type { Token } from "../services/types";

/** Prefer the freshest in-session list row before falling back to localStorage. */
function findCachedTokenInLists(
  queryClient: QueryClient,
  address: string | undefined,
): Token | undefined {
  if (!address) return undefined;
  const target = address.toLowerCase();
  // `["tokens"]` is no longer populated; list consumers share `["tokens-infinite"]`.
  for (const [, data] of queryClient.getQueriesData<{
    pages: Token[][];
  }>({ queryKey: ["tokens-infinite"] })) {
    const pages = data?.pages;
    if (!pages) continue;
    for (const page of pages) {
      const hit = page.find((t) => t.address.toLowerCase() === target);
      if (hit) return hit;
    }
  }
  return undefined;
}

// Safety poll for the short graduating window when the graduation WS event is missed.
const GRADUATING_POLL_INTERVAL_MS = 3_000;

/** Pure helper for testing the graduating-window refetch safety net. */
export function tokenRefetchInterval(token: Token | undefined): number | false {
  return token?.status === "graduating" ? GRADUATING_POLL_INTERVAL_MS : false;
}

export function useToken(address: string | undefined) {
  // Wallet in key enables holder-only access to hidden-token detail pages.
  const { address: wallet } = useWallet();
  const queryClient = useQueryClient();
  // Placeholder is read only at query mount, so snapshot once per address.
  const placeholder = useMemo(
    () =>
      findCachedTokenInLists(queryClient, address) ?? readCachedToken(address),
    [queryClient, address],
  );
  const query = useQuery({
    queryKey: ["token", address, wallet ?? null],
    queryFn: () => {
      if (!address) throw new Error("Address required");
      return tokenService.getToken(address, wallet);
    },
    enabled: !!address,
    refetchInterval: (query) => tokenRefetchInterval(query.state.data),
    placeholderData: placeholder,
  });

  // Dev override stays outside TanStack Query so live data keeps refreshing underneath.
  const override = useSyncExternalStore(
    subscribeTokenOverrides,
    () => (import.meta.env.DEV ? getTokenOverride(address) : undefined),
    () => undefined,
  );

  const data = useMemo(() => {
    const rawData = query.data ?? placeholder;
    if (!rawData) return rawData;
    // Ratchet graduated state first; dev override may intentionally layer over it.
    const ratcheted = applyGraduationRatchet(rawData);
    if (!override) return ratcheted;
    return applyTokenOverride(ratcheted, override);
  }, [query.data, placeholder, override]);

  useEffect(() => {
    if (!data) return;
    cacheTokenDetail(data);
  }, [data]);

  // Return transformed data without mutating TanStack Query's owned reference.
  const isCachedFallback = !query.data && !!data && query.isFetched;
  return { ...query, data, isCachedFallback };
}
