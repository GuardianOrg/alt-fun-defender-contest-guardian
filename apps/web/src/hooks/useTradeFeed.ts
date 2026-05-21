import { useState, useEffect, useRef, useCallback } from "react";

import { subscribeMockTrades } from "../dev/mockFeed";
import { fetchRouterTradesGlobal } from "../services/api";
import {
  hasResolvedTokenName,
  ingestResolvedTokenName,
  prefetchTokenName,
  resolveTokenName,
  subscribeTokenName,
} from "../services/tokenNames";
import { routerTradeToTrade } from "../services/tradeFormatter";
import { tradeService } from "../services/tradeService";

import type { Trade } from "../services/types";

// Bound the initial skeleton window for empty or reconnecting feeds.
const TRADE_FEED_LOADING_TIMEOUT_MS = 1500;

// Retry unresolved token names until freshly-deployed tokens reach the indexer.
const TOKEN_NAME_RETRY_INTERVAL_MS = 5000;

// Mirrors the live REST poll batch size; the API caps `limit` at 100.
const TRADES_PAGE_SIZE = 50;

/** Split `${txHash}-${logIndex}`; malformed suffixes fall back to lexical sorting. */
function parseTradeId(id: string): { txHash: string; logIndex: number | null } {
  const cut = id.lastIndexOf("-");
  if (cut === -1) return { txHash: id, logIndex: null };
  const txHash = id.slice(0, cut);
  const raw = id.slice(cut + 1);
  const parsed = Number(raw);
  return {
    txHash,
    logIndex: Number.isInteger(parsed) ? parsed : null,
  };
}

/** Newest-first comparator across interleaved WS, poll, and pagination arrivals. */
export function compareTradesByTimestampDesc(a: Trade, b: Trade): number {
  const aMs = Date.parse(a.timestamp);
  const bMs = Date.parse(b.timestamp);
  // Malformed timestamps sort to the bottom.
  const aValid = Number.isFinite(aMs);
  const bValid = Number.isFinite(bMs);
  if (aValid && bValid && aMs !== bMs) return bMs - aMs;
  if (aValid !== bValid) return aValid ? -1 : 1;
  if (a.id === b.id) return 0;
  // Same-tx tie-breaker must compare log indexes numerically.
  const aParsed = parseTradeId(a.id);
  const bParsed = parseTradeId(b.id);
  if (
    aParsed.txHash === bParsed.txHash &&
    aParsed.logIndex !== null &&
    bParsed.logIndex !== null &&
    aParsed.logIndex !== bParsed.logIndex
  ) {
    return bParsed.logIndex - aParsed.logIndex;
  }
  return a.id > b.id ? -1 : 1;
}

/** Return a new newest-first array for state updates. */
export function sortTradesByTimestampDesc(trades: Trade[]): Trade[] {
  return trades.slice().sort(compareTradesByTimestampDesc);
}

/** Patch fallback token names once the real symbol reaches the cache. */
function patchTradesWithResolvedName(
  trades: Trade[],
  lowercasedAddress: string,
  name: string,
): Trade[] {
  let changed = false;
  const next = trades.map((trade) => {
    if (
      trade.tokenAddress.toLowerCase() === lowercasedAddress &&
      trade.tokenName !== name
    ) {
      changed = true;
      return { ...trade, tokenName: name };
    }
    return trade;
  });
  return changed ? next : trades;
}

export interface UseTradeFeedResult {
  trades: Trade[];
  /** True until the first trade arrives or the safety timeout elapses. */
  isLoading: boolean;
  /** True while a `loadMore` REST round-trip is in flight. */
  isFetchingMore: boolean;
  /** False once the latest `loadMore` page comes back short. */
  hasMore: boolean;
  /** Fetch the next page of older trades; safe for repeated observer calls. */
  loadMore: () => void;
}

export function useTradeFeed(): UseTradeFeedResult {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors state for intervals/callbacks without re-arming effects.
  const tradesRef = useRef<Trade[]>(trades);
  useEffect(() => {
    tradesRef.current = trades;
  }, [trades]);
  // Dedupe across live WS, initial REST poll, and paginated REST pages.
  const seenIdsRef = useRef<Set<string>>(new Set());
  // Mutable mirrors let `loadMore` stay stable for IntersectionObserver consumers.
  const isFetchingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);

  useEffect(() => {
    setTrades([]);
    setIsLoading(true);
    setHasMore(true);
    hasMoreRef.current = true;
    setIsFetchingMore(false);
    isFetchingMoreRef.current = false;
    seenIdsRef.current = new Set();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(
      () => setIsLoading(false),
      TRADE_FEED_LOADING_TIMEOUT_MS,
    );

    const handleNew = (trade: Trade) => {
      // Check outside `setTrades` so a re-invoked updater cannot double-add.
      if (seenIdsRef.current.has(trade.id)) return;
      seenIdsRef.current.add(trade.id);
      // Sort after insert because WS, poll, and pagination can interleave.
      setTrades((prev) => sortTradesByTimestampDesc([trade, ...prev]));
      setIsLoading(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const unsub = tradeService.subscribeFeed(handleNew);

    // DevSimulator mock trades.
    const unsubMock = import.meta.env.DEV
      ? subscribeMockTrades(handleNew)
      : () => {};

    // Heal truncated-address fallback names when the symbol cache resolves.
    const unsubNames = subscribeTokenName((lowercasedAddress, name) => {
      setTrades((prev) => patchTradesWithResolvedName(prev, lowercasedAddress, name));
    });

    // Retry unresolved names; `prefetchTokenName` is a no-op after cache hit.
    const retryInterval = setInterval(() => {
      const unresolved = new Set<string>();
      for (const trade of tradesRef.current) {
        if (!hasResolvedTokenName(trade.tokenAddress)) {
          unresolved.add(trade.tokenAddress);
        }
      }
      for (const address of unresolved) {
        void prefetchTokenName(address);
      }
    }, TOKEN_NAME_RETRY_INTERVAL_MS);

    return () => {
      unsub();
      unsubMock();
      unsubNames();
      clearInterval(retryInterval);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const loadMore = useCallback(() => {
    if (isFetchingMoreRef.current || !hasMoreRef.current) return;
    // Wait for initial poll before paginating; the sentinel can be visible during skeletons.
    if (tradesRef.current.length === 0) return;
    isFetchingMoreRef.current = true;
    setIsFetchingMore(true);
    // Offset is self-correcting: overlaps from live arrivals are filtered by `seenIdsRef`.
    const offset = tradesRef.current.length;
    void (async () => {
      try {
        const batch = await fetchRouterTradesGlobal(TRADES_PAGE_SIZE, offset);
        const fresh: Trade[] = [];
        for (const raw of batch) {
          if (seenIdsRef.current.has(raw.id)) continue;
          seenIdsRef.current.add(raw.id);
          // Seed the name cache from API-enriched labels.
          ingestResolvedTokenName(raw.tokenAddress, raw.tokenSymbol);
          ingestResolvedTokenName(raw.tokenAddress, raw.tokenName);
          const mapped = routerTradeToTrade(raw);
          const apiLabel =
            raw.tokenSymbol?.trim() || raw.tokenName?.trim() || "";
          mapped.tokenName = apiLabel || resolveTokenName(raw.tokenAddress);
          fresh.push(mapped);
        }
        if (fresh.length > 0) {
          // Sort merged window because live trades may land mid-page fetch.
          setTrades((prev) => sortTradesByTimestampDesc([...prev, ...fresh]));
        }
        // Short page means exhausted.
        if (batch.length < TRADES_PAGE_SIZE) {
          hasMoreRef.current = false;
          setHasMore(false);
        }
      } catch (err) {
        console.warn("[useTradeFeed] loadMore failed:", err);
      } finally {
        isFetchingMoreRef.current = false;
        setIsFetchingMore(false);
      }
    })();
  }, []);

  return { trades, isLoading, isFetchingMore, hasMore, loadMore };
}

export interface UseTokenTradesResult {
  trades: Trade[];
  /** True until the first trade arrives or the short timeout elapses. */
  isLoading: boolean;
}

// Bound token-trade skeletons for genuinely quiet tokens.
const TRADES_LOADING_TIMEOUT_MS = 1500;

export function useTokenTrades(
  address: string | undefined,
  maxItems = 30,
): UseTokenTradesResult {
  const [trades, setTrades] = useState<Trade[]>(() =>
    address ? tradeService.getInitialTrades(address) : [],
  );
  const [isLoading, setIsLoading] = useState<boolean>(() => !!address);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!address) {
      setTrades([]);
      setIsLoading(false);
      return;
    }
    setTrades(tradeService.getInitialTrades(address));
    setIsLoading(true);

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(
      () => setIsLoading(false),
      TRADES_LOADING_TIMEOUT_MS,
    );

    const unsub = tradeService.subscribeTokenTrades(address, (trade) => {
      // Sort before capping so the oldest rows fall off first.
      setTrades((prev) =>
        sortTradesByTimestampDesc([trade, ...prev]).slice(0, maxItems),
      );
      setIsLoading(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    });

    // Mirror DevSimulator mock trades into the current token tab.
    const normalized = address.toLowerCase();
    const unsubMock = import.meta.env.DEV
      ? subscribeMockTrades((trade) => {
          if (trade.tokenAddress.toLowerCase() !== normalized) return;
          setTrades((prev) =>
            sortTradesByTimestampDesc([trade, ...prev]).slice(0, maxItems),
          );
          setIsLoading(false);
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
        })
      : () => {};

    // Heal per-token fallback names the same way as the global feed.
    const unsubNames = subscribeTokenName((lowercasedAddress, name) => {
      setTrades((prev) => patchTradesWithResolvedName(prev, lowercasedAddress, name));
    });

    return () => {
      unsub();
      unsubMock();
      unsubNames();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [address, maxItems]);

  return { trades, isLoading };
}
