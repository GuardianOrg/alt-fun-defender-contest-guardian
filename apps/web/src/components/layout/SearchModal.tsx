import { useState, useEffect, useRef, useMemo } from "react";

import { useQueries } from "@tanstack/react-query";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router";

import styles from "./SearchModal.module.css";
import { tokenPath } from "../../app/routes";
import { COLORS } from "../../config/colors";
import { useTokens } from "../../hooks/useTokens";
import { fetchOhlcv, searchTokens } from "../../services/api";
import { deriveDirection, deriveStatus, deriveUnderlying, ltDisplayName } from "../../services/tokenService";
import { selectSearchOpen, setSearchOpen } from "../../state/uiSlice";
import { cn } from "../../utils/format";
import ModalOverlay from "../shared/ModalOverlay";

import type { Token } from "../../services/types";

function normalizePoints(pts: number[]): string {
  if (pts.length < 2) return "1,16 109,16";
  const mn = Math.min(...pts);
  const mx = Math.max(...pts);
  const norm = pts.map((p) => ((p - mn) / (mx - mn || 1)) * 26 + 3);
  return norm
    .map((y, i) => `${(i / (norm.length - 1)) * 108 + 1},${32 - y}`)
    .join(" ");
}

function Sparkline({ up, data }: { up: boolean; data?: number[] }) {
  const coords = useMemo(() => {
    if (data && data.length >= 2) {
      return normalizePoints(data);
    }
    const pts = Array.from({ length: 12 }, (_, i) => (up ? i * 2.2 : -i * 2));
    return normalizePoints(pts);
  }, [up, data]);
  const col = up ? COLORS.mint : COLORS.red;
  return (
    <svg
      width="110"
      height="32"
      viewBox="0 0 110 32"
      preserveAspectRatio="none"
      className={styles.sparkline}
    >
      <polygon points={`1,32 ${coords} 109,32`} fill={col} opacity="0.08" />
      <polyline
        points={coords}
        fill="none"
        stroke={col}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrendingCard({
  token,
  sparklineData,
  onClick,
}: {
  token: Token;
  sparklineData?: number[];
  onClick: () => void;
}) {
  const up = token.change24h >= 0;
  return (
    <div className={styles.trendingCard} onClick={onClick}>
      <div className={styles.trendingCardHeader}>
        <div className={styles.trendingCardIcon}>
          {token.image ? (
            <img
              src={token.image}
              alt={token.name}
              className={styles.trendingCardImg}
            />
          ) : (
            token.emoji
          )}
        </div>
        <div>
          <div className={styles.trendingCardName}>{token.name}</div>
          <div className={styles.trendingCardLtName}>{token.ltName}</div>
        </div>
      </div>
      <Sparkline up={up} data={sparklineData} />
      <div className={styles.trendingCardMcap}>
        $
        {token.mcapUsd >= 1_000_000
          ? `${(token.mcapUsd / 1_000_000).toFixed(2)}M`
          : `${(token.mcapUsd / 1_000).toFixed(1)}K`}
      </div>
      <div
        className={cn(
          styles.trendingCardChange,
          up ? styles.changeUp : styles.changeDown,
        )}
      >
        {up ? "+" : ""}
        {token.change24h}%
      </div>
    </div>
  );
}

export default function SearchModal() {
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

  if (!open) return null;

  const filtered = query.trim() ? searchResults : null;

  const goToToken = (address: string) => {
    dispatch(setSearchOpen(false));
    navigate(tokenPath(address));
  };

  return (
    <ModalOverlay onClose={() => dispatch(setSearchOpen(false))}>
      <div className={styles.modal}>
        <div className={styles.searchBar}>
          <span className={styles.searchIcon}>&#x2315;</span>
          <input
            ref={inputRef}
            className={styles.searchInput}
            placeholder="Search tokens, tickers\u2026"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          <span
            className={styles.escBadge}
            onClick={() => dispatch(setSearchOpen(false))}
          >
            esc
          </span>
        </div>

        {!filtered ? (
          <div className={styles.defaultContent}>
            <div className={styles.sectionLabel}>TRENDING</div>
            <div className={styles.trendingRow}>
              {trendingTokens.map((t) => (
                <TrendingCard
                  key={t.address}
                  token={t}
                  sparklineData={sparklineMap.get(t.address)}
                  onClick={() => goToToken(t.address)}
                />
              ))}
            </div>
            <div className={styles.recentLabel}>RECENTLY VIEWED</div>
            <div className={styles.recentText}>No recently viewed tokens</div>
            <div className={styles.shortcuts}>
              <span className={styles.shortcutItem}>
                <kbd className={styles.kbd}>&#x21B5;</kbd>
                select
              </span>
              <span className={styles.shortcutItem}>
                <kbd className={styles.kbd}>esc</kbd>
                close
              </span>
            </div>
          </div>
        ) : (
          <div className={styles.resultsWrap}>
            {filtered.length > 0 ? (
              filtered.map((t) => (
                <div
                  key={t.address}
                  className={styles.resultRow}
                  onClick={() => goToToken(t.address)}
                >
                  <div className={styles.resultIcon}>{t.emoji}</div>
                  <div>
                    <div className={styles.resultName}>{t.name}</div>
                    <div className={styles.resultLtName}>{t.ltName}</div>
                  </div>
                  <div className={styles.resultRight}>
                    <div
                      className={cn(
                        styles.resultChange,
                        t.change24h >= 0 ? styles.changeUp : styles.changeDown,
                      )}
                    >
                      {t.change24h >= 0 ? "+" : ""}
                      {t.change24h}%
                    </div>
                    <div className={styles.resultMcap}>
                      $
                      {t.mcapUsd >= 1_000_000
                        ? `${(t.mcapUsd / 1_000_000).toFixed(2)}M`
                        : `${(t.mcapUsd / 1_000).toFixed(1)}K`}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.noResults}>No tokens found</div>
            )}
          </div>
        )}
      </div>
    </ModalOverlay>
  );
}
