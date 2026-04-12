import { useState, useEffect, useRef, useMemo } from "react";

import { useQueries } from "@tanstack/react-query";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router";

import { useTokens } from "./useTokens";
import { tokenPath } from "../app/routes";
import { fetchOhlcv, searchTokens } from "../services/api";
import { deriveDirection, deriveStatus, deriveUnderlying, ltDisplayName } from "../services/tokenService";
import { selectSearchOpen, setSearchOpen } from "../state/uiSlice";

import type { Token } from "../services/types";

export function useSearchModal() {
  const open = useSelector(selectSearchOpen);
  const dispatch = useDispatch();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { data: tokens } = useTokens();

  const trendingTokens = useMemo(() => tokens?.slice(0, 5) ?? [], [tokens]);
  const sparklineQueries = useQueries({
    queries: trendingTokens.map((t) => ({
      queryKey: ["sparkline", t.address],
      queryFn: async () => {
        const candles = await fetchOhlcv(t.address, "1h");
        return candles.map((c) => c.close);
      },
      staleTime: 60_000,
      enabled: open && !query.trim(),
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
          mcapUsd: 0,
          change24h: 0,
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
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        dispatch(setSearchOpen(true));
      }
      if (e.key === "Escape") dispatch(setSearchOpen(false));
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [dispatch]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
    else setQuery("");
  }, [open]);

  const filtered = query.trim() ? searchResults : null;

  const goToToken = (address: string) => {
    dispatch(setSearchOpen(false));
    navigate(tokenPath(address));
  };

  const close = () => dispatch(setSearchOpen(false));

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
  };
}
