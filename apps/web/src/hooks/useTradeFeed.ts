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

// Bound the "loading" window for the recent-trades feed. The WS / REST poll
// fan-in usually delivers within a few hundred ms; this timeout prevents
// the panel from shimmering forever during a WS reconnect or when the
// feed is genuinely empty (e.g. on a brand-new deployment with zero
// activity yet).
const TRADE_FEED_LOADING_TIMEOUT_MS = 1500;

// Interval for retrying the Ponder name lookup for trades that are still
// showing the truncated-address fallback. Recently-deployed tokens can
// take a few seconds to land in the indexer; without a retry the WS-only
// path would freeze the fallback in place until the next trade arrives
// for that token (which may be never, if the feed scrolls past it).
// 5s balances responsiveness against indexer load: Ponder GraphQL hits
// are cheap and the retry only runs while at least one row is unresolved.
const TOKEN_NAME_RETRY_INTERVAL_MS = 5000;

/**
 * Page size for the recent-trades feed (issue #807). Mirrors the hardcoded
 * batch the live REST poll inside `tradeFeed.ts → subscribeFeed` already
 * uses (50), so the initial display matches one server page exactly and
 * `loadMore` requests cleanly cover the next 50 older trades. The API
 * caps `limit` at 100, so this leaves headroom for tuning without a
 * server-side change.
 */
const TRADES_PAGE_SIZE = 50;

/**
 * Replace `tokenName` on every trade whose `tokenAddress` matches
 * `lowercasedAddress`. Returns the same array reference when nothing
 * changed so React can skip the re-render. Used by both `useTradeFeed`
 * and `useTokenTrades` to heal rows rendered with the truncated-address
 * fallback once the real symbol lands in the cache.
 */
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
  /**
   * True until the first trade arrives OR a short safety timeout elapses.
   * Lets consumers render a placeholder during the initial WS / poll
   * window without leaving skeletons up indefinitely when the feed is
   * genuinely empty / disconnected.
   */
  isLoading: boolean;
  /**
   * True while a `loadMore` REST round-trip is in flight. Drives the
   * page-skeleton row(s) at the bottom of the feed so the user sees the
   * scroll-triggered fetch is making progress.
   */
  isFetchingMore: boolean;
  /**
   * False once the most recent `loadMore` page came back short — the
   * canonical "end of list" signal, mirroring `useInfiniteTokens`.
   */
  hasMore: boolean;
  /**
   * Fetch the next page of older trades and append them to `trades`.
   * No-op when `isFetchingMore` is true or `hasMore` is false; safe to
   * call from an `IntersectionObserver` callback that fires repeatedly.
   */
  loadMore: () => void;
}

export function useTradeFeed(): UseTradeFeedResult {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref mirrors `trades` so the retry interval and `loadMore` callback
  // can read the current address set / page count without re-arming on
  // every state change.
  const tradesRef = useRef<Trade[]>(trades);
  useEffect(() => {
    tradesRef.current = trades;
  }, [trades]);
  // Cross-source dedupe set: tracks every trade id we've surfaced via
  // either `subscribeFeed` (live WS + initial REST poll) or `loadMore`
  // (older REST pages). The live poll inside `tradeFeed.ts` already
  // dedupes against itself, so this set's job is the boundary case
  // where a freshly-arrived live trade and an older paginated batch
  // happen to overlap (e.g. a fast-moving feed where the next page
  // shifts under us mid-fetch).
  const seenIdsRef = useRef<Set<string>>(new Set());
  // Mutable mirror of `isFetchingMore` / `hasMore` so the `loadMore`
  // callback can short-circuit re-entrant invocations without a fresh
  // identity (which would re-arm the `IntersectionObserver` in the
  // consumer).
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
      // Cross-source dedupe — see `seenIdsRef` JSDoc. The check happens
      // outside `setTrades` so React's reconciliation can't double-add
      // on a re-invoked updater (StrictMode / batched updates).
      if (seenIdsRef.current.has(trade.id)) return;
      seenIdsRef.current.add(trade.id);
      setTrades((prev) => [trade, ...prev]);
      // First trade arrived — drop the loading flag immediately so the
      // real row renders without a stale skeleton flash.
      setIsLoading(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const unsub = tradeService.subscribeFeed(handleNew);

    // Dev-only easter egg (`DevSimulator`). The mock bus is inert in
    // production: nothing emits into it, and `import.meta.env.DEV` lets
    // bundlers strip this branch on `vite build`.
    const unsubMock = import.meta.env.DEV
      ? subscribeMockTrades(handleNew)
      : () => {};

    // Heal rows that were appended with the truncated-address fallback
    // once their real symbol lands in `tokenNameMap`. Without this, a
    // freshly-deployed token's row stays frozen on the address until a
    // *new* trade for that token arrives (which may never happen if the
    // feed scrolls past it).
    const unsubNames = subscribeTokenName((lowercasedAddress, name) => {
      setTrades((prev) => patchTradesWithResolvedName(prev, lowercasedAddress, name));
    });

    // Periodically re-trigger `prefetchTokenName` for any rows still
    // showing the truncated-address fallback. `prefetchTokenName` is a
    // no-op once the cache hits, so this is cheap; when the Ponder
    // indexer eventually catches up to a freshly-deployed token, the
    // resolved name flows back through `subscribeTokenName` above and
    // patches the row in place.
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
    // Skip pagination while the initial REST poll inside `tradeFeed.ts
    // → subscribeFeed` hasn't yet delivered the first page. Without
    // this guard, an `IntersectionObserver` triggering against a
    // sentinel that's visible above the initial-skeleton placeholders
    // (sentinel renders from first mount now — see RightPanel issue
    // #841) would call `fetchRouterTradesGlobal(50, 0)` and duplicate
    // the work the live-feed poll is already doing. `seenIdsRef` would
    // dedupe the rows, so this is a correctness-safe optimisation, not
    // a safety net.
    if (tradesRef.current.length === 0) return;
    isFetchingMoreRef.current = true;
    setIsFetchingMore(true);
    // Server-side `offset` is "skip this many newest trades". Using the
    // current display count is a self-correcting cursor: live trades
    // arriving between this snapshot and the response shift the page
    // window, but any overlap is filtered by `seenIdsRef` below — so
    // the next page never duplicates a trade already on screen.
    const offset = tradesRef.current.length;
    void (async () => {
      try {
        const batch = await fetchRouterTradesGlobal(TRADES_PAGE_SIZE, offset);
        const fresh: Trade[] = [];
        for (const raw of batch) {
          if (seenIdsRef.current.has(raw.id)) continue;
          seenIdsRef.current.add(raw.id);
          // Mirror `tradeFeed.ts → subscribeFeed`: seed the name cache
          // from the API-enriched labels (issue #703) so subsequent
          // surfaces watching this address pick up the resolved name
          // without a redundant Ponder round-trip.
          ingestResolvedTokenName(raw.tokenAddress, raw.tokenSymbol);
          ingestResolvedTokenName(raw.tokenAddress, raw.tokenName);
          const mapped = routerTradeToTrade(raw);
          const apiLabel =
            raw.tokenSymbol?.trim() || raw.tokenName?.trim() || "";
          mapped.tokenName = apiLabel || resolveTokenName(raw.tokenAddress);
          fresh.push(mapped);
        }
        if (fresh.length > 0) {
          setTrades((prev) => [...prev, ...fresh]);
        }
        // Short page is the canonical "end of list" signal — same
        // contract `useInfiniteTokens` uses against `/api/v1/tokens`.
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
  /**
   * True until the first trade arrives OR a short timeout elapses. Lets the
   * tab render skeleton rows during the initial poll/WS window without
   * flashing skeletons forever for genuinely-quiet tokens.
   */
  isLoading: boolean;
}

// How long to keep showing skeleton rows for a brand-new token detail page
// before declaring the trade list "settled". The token-trades poll runs
// immediately on subscribe (`tradeFeed.ts` → `void poll()`) and typically
// resolves within a few hundred ms; this bounds the placeholder window so
// tokens with zero trades don't shimmer indefinitely.
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
      setTrades((prev) => [trade, ...prev].slice(0, maxItems));
      // First trade arrived — drop the loading flag immediately so the real
      // row renders without a stale skeleton flash.
      setIsLoading(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    });

    // Mirror the global-feed easter egg for the per-token tab: mock
    // trades whose `tokenAddress` matches the current detail page
    // flow into this list too, so the row-level flash UI can be
    // exercised from a token detail view as well as the homepage.
    const normalized = address.toLowerCase();
    const unsubMock = import.meta.env.DEV
      ? subscribeMockTrades((trade) => {
          if (trade.tokenAddress.toLowerCase() !== normalized) return;
          setTrades((prev) => [trade, ...prev].slice(0, maxItems));
          setIsLoading(false);
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
        })
      : () => {};

    // Heal the per-token trade rows the same way `useTradeFeed` does:
    // `subscribeTokenTrades` already filters to this address, so we only
    // need to listen for the single name that matters. Patching is still
    // delegated to `patchTradesWithResolvedName` for the address-match
    // guard (the listener fires for *every* resolution, not just this
    // token's).
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
