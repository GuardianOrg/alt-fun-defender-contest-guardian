import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '@/stores/uiStore';
import { useTokens } from '@/hooks/useTokens';
import { cn } from '@/utils/format';
import type { Token } from '@/services/types';
import styles from './SearchModal.module.css';

function Sparkline({ up }: { up: boolean }) {
  const pts = Array.from({ length: 12 }, (_, i) => {
    const n = (Math.random() - 0.5) * 10;
    const tr = up ? i * 2.2 : -i * 2;
    return tr + n;
  });
  const mn = Math.min(...pts);
  const mx = Math.max(...pts);
  const norm = pts.map((p) => ((p - mn) / (mx - mn || 1)) * 26 + 3);
  const coords = norm.map((y, i) => `${(i / (norm.length - 1)) * 108 + 1},${32 - y}`).join(' ');
  const col = up ? '#4de8b4' : '#f05050';
  return (
    <svg width="110" height="32" viewBox="0 0 110 32" preserveAspectRatio="none" className={styles.sparkline}>
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

function TrendingCard({ token, onClick }: { token: Token; onClick: () => void }) {
  const up = token.change24h >= 0;
  return (
    <div
      className={styles.trendingCard}
      onClick={onClick}
    >
      <div className={styles.trendingCardHeader}>
        <div className={styles.trendingCardIcon}>
          {token.image ? (
            <img src={token.image} alt={token.name} className={styles.trendingCardImg} />
          ) : (
            token.emoji
          )}
        </div>
        <div>
          <div className={styles.trendingCardName}>{token.name}</div>
          <div className={styles.trendingCardLtName}>{token.ltName}</div>
        </div>
      </div>
      <Sparkline up={up} />
      <div className={styles.trendingCardMcap}>
        ${token.mcapUsd >= 1_000_000
          ? `${(token.mcapUsd / 1_000_000).toFixed(2)}M`
          : `${(token.mcapUsd / 1_000).toFixed(1)}K`}
      </div>
      <div className={cn(styles.trendingCardChange, up ? styles.changeUp : styles.changeDown)}>
        {up ? '+' : ''}
        {token.change24h}%
      </div>
    </div>
  );
}

export default function SearchModal() {
  const open = useUIStore((s) => s.searchOpen);
  const setOpen = useUIStore((s) => s.setSearchOpen);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { data: tokens } = useTokens();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [setOpen]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
    else setQuery('');
  }, [open]);

  if (!open) return null;

  const filtered = query.trim()
    ? tokens?.filter(
        (t) =>
          t.name.toLowerCase().includes(query.toLowerCase()) ||
          t.ltName.toLowerCase().includes(query.toLowerCase()),
      )
    : null;

  const goToToken = (address: string) => {
    setOpen(false);
    navigate(`/token/${address}`);
  };

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className={styles.modal}>
        <div className={styles.searchBar}>
          <span className={styles.searchIcon}>⌕</span>
          <input
            ref={inputRef}
            className={styles.searchInput}
            placeholder="Search tokens, tickers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          <span
            className={styles.escBadge}
            onClick={() => setOpen(false)}
          >
            esc
          </span>
        </div>

        {!filtered ? (
          <div className={styles.defaultContent}>
            <div className={styles.sectionLabel}>
              TRENDING
            </div>
            <div className={styles.trendingRow}>
              {tokens?.slice(0, 5).map((t) => (
                <TrendingCard key={t.address} token={t} onClick={() => goToToken(t.address)} />
              ))}
            </div>
            <div className={styles.recentLabel}>
              RECENTLY VIEWED
            </div>
            <div className={styles.recentText}>No recently viewed tokens</div>
            <div className={styles.shortcuts}>
              <span className={styles.shortcutItem}>
                <kbd className={styles.kbd}>↵</kbd>
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
                  <div className={styles.resultIcon}>
                    {t.emoji}
                  </div>
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
                      {t.change24h >= 0 ? '+' : ''}
                      {t.change24h}%
                    </div>
                    <div className={styles.resultMcap}>
                      ${t.mcapUsd >= 1_000_000
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
    </div>
  );
}
