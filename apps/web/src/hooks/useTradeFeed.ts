import { useState, useEffect, useRef } from "react";

import { subscribeMockTrades } from "../dev/mockFeed";
import {
  hasResolvedTokenName,
  prefetchTokenName,
  subscribeTokenName,
} from "../services/tokenNames";
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
}

export function useTradeFeed(maxItems = 14): UseTradeFeedResult {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref mirrors `trades` so the retry interval can read the current
  // address set without re-arming the interval on every state change.
  const tradesRef = useRef<Trade[]>(trades);
  useEffect(() => {
    tradesRef.current = trades;
  }, [trades]);

  useEffect(() => {
    setIsLoading(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(
      () => setIsLoading(false),
      TRADE_FEED_LOADING_TIMEOUT_MS,
    );

    const unsub = tradeService.subscribeFeed((trade) => {
      setTrades((prev) => [trade, ...prev].slice(0, maxItems));
      // First trade arrived — drop the loading flag immediately so the
      // real row renders without a stale skeleton flash.
      setIsLoading(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    });

    // Dev-only easter egg (`DevSimulator`). The mock bus is inert in
    // production: nothing emits into it, and `import.meta.env.DEV` lets
    // bundlers strip this branch on `vite build`.
    const unsubMock = import.meta.env.DEV
      ? subscribeMockTrades((trade) => {
          setTrades((prev) => [trade, ...prev].slice(0, maxItems));
          setIsLoading(false);
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
        })
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
  }, [maxItems]);

  return { trades, isLoading };
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
