import { useState, useEffect, useRef } from "react";

import { tradeService } from "../services/tradeService";

import type { Trade } from "../services/types";

// Bound the "loading" window for the recent-trades feed. The WS / REST poll
// fan-in usually delivers within a few hundred ms; this timeout prevents
// the panel from shimmering forever during a WS reconnect or when the
// feed is genuinely empty (e.g. on a brand-new deployment with zero
// activity yet).
const TRADE_FEED_LOADING_TIMEOUT_MS = 1500;

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
    return () => {
      unsub();
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
    return () => {
      unsub();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [address, maxItems]);

  return { trades, isLoading };
}
