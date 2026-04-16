import { useState, useEffect, useRef, useMemo, useCallback } from "react";

import { useQueries } from "@tanstack/react-query";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router";

import { useTokens } from "./useTokens";
import { tokenPath } from "../app/routes";
import { fetchSparkline, searchTokens } from "../services/api";
import { deriveDirection, deriveStatus, deriveUnderlying, ltDisplayName } from "../services/tokenService";
import { selectSearchOpen, setSearchOpen } from "../state/uiSlice";

import type { Token } from "../services/types";

const SPARKLINE_DEFER_MS = 300;

export function useSearchModal() {
  const open = useSelector(selectSearchOpen);
  const dispatch = useDispatch();
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { data: tokens } = useTokens();

  // Defer sparkline fetching so typing immediately after open skips them
  const [sparklineReady, setSparklineReady] = useState(false);
  useEffect(() => {
    if (!open || query.trim()) {
      setSparklineReady(false);
      return;
    }
    const timer = setTimeout(() => setSparklineReady(true), SPARKLINE_DEFER_MS);
    return () => clearTimeout(timer);
  }, [open, query]);

  const trendingTokens = useMemo(() => tokens?.slice(0, 5) ?? [], [tokens]);
  const sparklineQueries = useQueries({
    queries: trendingTokens.map((t) => ({
      queryKey: ["sparkline", t.address],
      queryFn: () => fetchSparkline(t.address, 20),
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      enabled: sparklineReady,
    })),
  });
  const sparklineMap = useMemo(() => {
    const map = new Map<string, number[]>();
    trendingTokens.forEach((t, i) => {
      const data = sparklineQueries[i]?.data;
      if (data && data.length >= 2) {
        map.set(t.address, data);
      }
    });
    return map;
  }, [trendingTokens, sparklineQueries]);
  const [searchResults, setSearchResults] = useState<Token[] | null>(null);

  // Reset highlight when query or results change
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [query]);

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const results = await searchTokens(query);
        if (cancelled) return;
        setSearchResults(results.map((r) => ({
          address: r.address,
          name: r.name,
          ticker: r.ticker,
          emoji: "",
          description: r.description,
          direction: deriveDirection(r),
          underlying: deriveUnderlying(r),
          leverage: (r.leverage as 2 | 3 | 5) ?? 2,
          ltName: ltDisplayName(r),
          buyMomentum: 0,
          leverageBoost: 0,
          curveFilled: 0,
          curveRaisedUsd: 0,
          volume24h: 0,
          athUsd: 0,
          status: deriveStatus(r),
          creatorAddress: r.creator,
          createdAt: r.createdAt,
        })));
      } catch {
        if (!cancelled) setSearchResults(null);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
    else setQuery("");
  }, [open]);

  const filtered = query.trim() ? searchResults : null;

  const goToToken = useCallback((address: string) => {
    dispatch(setSearchOpen(false));
    navigate(tokenPath(address));
  }, [dispatch, navigate]);

  const close = () => dispatch(setSearchOpen(false));

  // The navigable list: search results when typing, trending tokens otherwise
  const navigableItems = useMemo(() => {
    if (filtered) return filtered;
    return trendingTokens;
  }, [filtered, trendingTokens]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        dispatch(setSearchOpen(true));
      }
      if (e.key === "Escape") dispatch(setSearchOpen(false));

      if (!open) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          const max = navigableItems.length - 1;
          return prev < max ? prev + 1 : 0;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          const max = navigableItems.length - 1;
          return prev > 0 ? prev - 1 : max;
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < navigableItems.length) {
          const token = navigableItems[highlightedIndex];
          if (token) {
            goToToken(token.address);
          }
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [dispatch, open, navigableItems, highlightedIndex, goToToken]);

  return {
    open,
    query,
    setQuery,
    inputRef,
    trendingTokens,
    sparklineMap,
    filtered,
    goToToken,
    close,
    highlightedIndex,
    setHighlightedIndex,
  };
}
