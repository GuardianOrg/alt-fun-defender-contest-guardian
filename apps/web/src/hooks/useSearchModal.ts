import { useState, useEffect, useRef, useMemo, useCallback } from "react";

import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router";

import { useRecentlyViewed } from "./useRecentlyViewed";
import { useTokens } from "./useTokens";
import { tokenPath } from "../app/routes";
import { searchTokens } from "../services/api";
import { fromApiToken } from "../services/tokenService";
import { selectSearchOpen, setSearchOpen } from "../state/uiSlice";

import type { Token } from "../services/types";

export function useSearchModal() {
  const open = useSelector(selectSearchOpen);
  const dispatch = useDispatch();
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { data: tokens, isLoading: tokensLoading } = useTokens();
  const recentlyViewedAddresses = useRecentlyViewed();

  const trendingTokens = useMemo(() => tokens?.slice(0, 5) ?? [], [tokens]);

  const recentlyViewedTokens = useMemo(() => {
    if (!tokens || recentlyViewedAddresses.length === 0) return [];
    const byAddress = new Map(
      tokens.map((t) => [t.address.toLowerCase(), t] as const),
    );
    return recentlyViewedAddresses
      .map((a) => byAddress.get(a.toLowerCase()))
      .filter((t): t is Token => Boolean(t));
  }, [tokens, recentlyViewedAddresses]);

  const [searchResults, setSearchResults] = useState<Token[] | null>(null);

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
        setSearchResults(results.map(fromApiToken));
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

  const navigableItems = useMemo(() => {
    if (filtered) return filtered;
    return [...trendingTokens, ...recentlyViewedTokens];
  }, [filtered, trendingTokens, recentlyViewedTokens]);

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
    recentlyViewedTokens,
    filtered,
    goToToken,
    close,
    highlightedIndex,
    setHighlightedIndex,
    tokensLoading: tokensLoading && !tokens,
  };
}
