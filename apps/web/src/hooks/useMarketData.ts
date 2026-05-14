import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { fetchMarketData } from "../services/api";

import type { MarketDataEntry, MarketDataMap } from "../services/api";

const MARKET_DATA_STALE_TIME = 30_000;
const MARKET_DATA_REFETCH_INTERVAL = 30_000;

/**
 * Normalise + dedupe + sort an addresses array so two consumers that
 * pass the same set in different orders / casings share a React Query
 * cache entry. Sorted-join is the canonical form for the queryKey.
 */
function normaliseAddresses(addresses: readonly string[]): string[] {
  const set = new Set<string>();
  for (const addr of addresses) set.add(addr.toLowerCase());
  return [...set].sort();
}

/**
 * Fetch market-data for a *bounded* set of token addresses (`mcapUsd`,
 * `priceUsd`, `change24h`, `volume24hUsd`, …). Replaces the legacy
 * `useMarketData()` no-arg hook that fanned out to the full-catalogue
 * `GET /api/v1/market-data` dump — every consumer in the app reads
 * market-data as an address-keyed lookup against a known visible slice
 * (home table page, search results, portfolio held positions), so the
 * hook now requires those addresses up front.
 *
 * Address list is deduped + lowercased + sorted internally so the
 * queryKey is stable across consumer-side call-site ordering — pass an
 * unsorted page of addresses without thinking about it.
 *
 * Server caps at 200 addresses per call; consumers that need more should
 * page their callers (or open an issue — at that point a different
 * shape is probably warranted).
 *
 * Exposes both raw-row access (`getTokenMarketData` for `change24h` /
 * `volume24hUsd` / `past24hPriceUsd`) and the price-shaped projections
 * (`getPrice` / `getMcap`) the held-positions / mcap-overlay paths
 * historically pulled off a separate `useTokenPrices(addresses)` hook.
 * The two hooks fired the same `POST /api/v1/market-data` request with
 * different React Query cache keys (`["market-data", …]` vs
 * `["token-prices", …]`) — every page load doubled the upstream load
 * and every WS-driven invalidation refetched the payload twice. Pulling
 * both selector flavours off the single underlying query collapses that
 * fan-out (and keeps the WS invalidation in `useTokenListLiveFeed`
 * pointed at one cache key instead of two).
 */
export function useMarketData(addresses: readonly string[]) {
  // `useMemo` so an inline `[...]` literal at the call site doesn't
  // bust the queryKey on every parent render. `addresses` is the only
  // input that changes; everything else in the key is constant.
  const normalised = useMemo(
    () => normaliseAddresses(addresses),
    [addresses],
  );

  const query = useQuery({
    queryKey: ["market-data", normalised],
    queryFn: () => fetchMarketData(normalised),
    staleTime: MARKET_DATA_STALE_TIME,
    refetchInterval: MARKET_DATA_REFETCH_INTERVAL,
    // Empty-address calls short-circuit on the server but `useQuery`
    // still fires the fetch. Skip the fetch entirely for an empty
    // page so we don't pay the React Query loading-state cycle for
    // nothing.
    enabled: normalised.length > 0,
  });

  const data = query.data ?? ({} as MarketDataMap);

  const getTokenMarketData = (
    address: string,
  ): MarketDataEntry | undefined => {
    return data[address.toLowerCase()];
  };

  // Price / mcap selectors mirror the legacy `useTokenPrices` contract:
  // a missing entry OR a `null` server-side value collapses to `0` so
  // callers (`useBalances` derives `valueUsd = amount × pricePerToken`)
  // can multiply unconditionally. `null` is the indexer-degraded
  // sentinel — treating it as "unknown, try again next poll" matches
  // the dust-filter behaviour in `buildHeldTokens`, which already
  // relies on a `0` price collapsing every row to sub-threshold and
  // skipping the panel render until prices land.
  const getPrice = (address: string): number => {
    return data[address.toLowerCase()]?.priceUsd ?? 0;
  };

  const getMcap = (address: string): number => {
    return data[address.toLowerCase()]?.mcapUsd ?? 0;
  };

  return {
    data,
    isLoading: query.isLoading,
    isError: query.isError,
    getTokenMarketData,
    getPrice,
    getMcap,
    /**
     * Wall-clock ms when TanStack last filled the query (initial fetch
     * or refetch). Live overlay hooks (`useLiveTokenVolume24h`) use this
     * to decide when to drop their accumulated WS deltas — the next
     * polled snapshot already includes those trades.
     */
    dataUpdatedAt: query.dataUpdatedAt,
  };
}
