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
 * Split a trade id `${txHash}-${logIndex}` into its parts. Returns a
 * null `logIndex` when the suffix isn't a finite integer so the
 * comparator below can fall back to a lexical compare instead of
 * silently treating malformed ids as `0` (which would collapse every
 * malformed row onto the same sort key).
 *
 * Indexer ids always have exactly one `-` between the 32-byte txHash
 * and the integer log index (see `apps/indexer/src/bonding.ts` —
 * `${event.transaction.hash}-${event.log.logIndex}`); txHashes are
 * lower-case hex without dashes so `lastIndexOf("-")` is the txHash /
 * logIndex split point.
 */
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

/**
 * Stable comparator for the trade-feed display order — newest first.
 *
 * Primary key is the on-chain `timestamp` (block timestamp, ISO-8601),
 * secondary key is the trade `id` which encodes `${txHash}-${logIndex}`
 * so two trades in the same block deterministically resolve by log
 * index — later log indices come first, mirroring the descending order
 * Ponder uses internally.
 *
 * Why we sort instead of relying on insertion order (issue #824): live
 * trades arrive via the WS push path and historical batches arrive via
 * the REST poll + `loadMore` path; under heavy trading the two streams
 * interleave such that prepending unconditionally lands an older REST
 * row above a newer WS row (e.g. when the initial REST poll resolves
 * AFTER a WS broadcast for a fresher trade has already been prepended).
 * The visible symptom was rows out of chronological order, which read
 * as "gaps" in the feed — sorting on every mutation pins the invariant
 * cheaply (n ≤ a few hundred in practice) and means no future caller
 * has to reason about which path inserted what when.
 */
export function compareTradesByTimestampDesc(a: Trade, b: Trade): number {
  const aMs = Date.parse(a.timestamp);
  const bMs = Date.parse(b.timestamp);
  // `Date.parse` returns NaN on malformed input. Treat NaN as the
  // smallest value (push to the bottom) so a corrupted row can't
  // throw off the rest of the list's order.
  const aValid = Number.isFinite(aMs);
  const bValid = Number.isFinite(bMs);
  if (aValid && bValid && aMs !== bMs) return bMs - aMs;
  if (aValid !== bValid) return aValid ? -1 : 1;
  if (a.id === b.id) return 0;
  // Same-block / same-timestamp tiebreaker: parse the trailing log
  // index numerically when both ids share a txHash, so trades 10 and
  // 2 in the same tx sort 10-before-2 (a plain lexical compare on the
  // full id would sort `0xhash-10` *after* `0xhash-2` because `1 < 2`
  // string-wise). Falls back to a lexical compare for cross-tx ids /
  // malformed suffixes so a degraded payload can never throw the
  // comparator into an inconsistent state.
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

/**
 * Returns a new array sorted newest-first. Always allocates so callers
 * can use the result directly in a `setState` updater without worrying
 * about identity-stability — React's reconciler keys on `t.id` so the
 * row-level DOM is preserved across re-orders.
 */
export function sortTradesByTimestampDesc(trades: Trade[]): Trade[] {
  // Native `Array#sort` is stable since ES2019, so a re-sort of an
  // already-sorted array is effectively a single linear scan in V8 —
  // cheap even with the upper-bound `trades` array we keep.
  return trades.slice().sort(compareTradesByTimestampDesc);
}

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
      // Sort after insert so chronologically-out-of-order arrivals (a
      // late initial-poll batch landing on top of an earlier-arrived WS
      // row, or a paginated `loadMore` row whose timestamp falls inside
      // the WS-prepended head) end up in the correct visual slot. See
      // `compareTradesByTimestampDesc` JSDoc + issue #824.
      setTrades((prev) => sortTradesByTimestampDesc([trade, ...prev]));
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
          // Sort the merged window so a paginated batch whose newest
          // row is fresher than the oldest WS-prepended row (race
          // window when many live trades land mid-`loadMore`) still
          // ends up in the right slot. See issue #824 +
          // `compareTradesByTimestampDesc` JSDoc.
          setTrades((prev) => sortTradesByTimestampDesc([...prev, ...fresh]));
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
      // Sort + cap on every arrival — same chronological-correctness
      // story as `useTradeFeed` (issue #824). The `slice(0, maxItems)`
      // cap runs AFTER the sort so the oldest rows that fall off the
      // tab are always the chronologically-oldest, not whichever ones
      // happened to land last in insertion order.
      setTrades((prev) =>
        sortTradesByTimestampDesc([trade, ...prev]).slice(0, maxItems),
      );
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
