import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '@/stores/uiStore';
import { useTokens } from '@/hooks/useTokens';
import { cn } from '@/utils/format';
import type { Token } from '@/services/types';

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
    <svg width="110" height="32" viewBox="0 0 110 32" preserveAspectRatio="none" className="block">
      <polygon points={`1,32 ${coords} 109,32`} fill={col} opacity="0.1" />
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
      className="shrink-0 w-[130px] bg-white/[0.03] border border-border rounded p-2.5 cursor-pointer transition-all hover:border-border-2 hover:bg-mint/[0.05]"
      onClick={onClick}
    >
      <div className="flex items-center gap-[7px] mb-2">
        <div className="w-[26px] h-[26px] rounded-[5px] bg-white/[0.06] flex items-center justify-center text-sm">
          {token.emoji}
        </div>
        <div>
          <div className="text-[13px] font-bold text-txt">{token.name}</div>
          <div className="text-[11px] text-mint/70 mt-px">{token.ltName}</div>
        </div>
      </div>
      <Sparkline up={up} />
      <div className="text-[13px] font-semibold text-txt">
        ${token.mcapUsd >= 1_000_000
          ? `${(token.mcapUsd / 1_000_000).toFixed(2)}M`
          : `${(token.mcapUsd / 1_000).toFixed(1)}K`}
      </div>
      <div className={cn('text-[12px] font-semibold mt-px', up ? 'text-mint' : 'text-red')}>
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
      className="fixed inset-0 z-[1000] bg-black/65 backdrop-blur-sm flex items-start justify-center pt-20"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-[580px] max-h-[520px] bg-[#0f2420] border border-border-2 rounded-md overflow-hidden flex flex-col animate-modalin">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
          <span className="text-base text-txt-2">⌕</span>
          <input
            ref={inputRef}
            className="flex-1 bg-transparent border-0 outline-0 font-mono text-sm text-txt placeholder:text-txt-3"
            placeholder="Search tokens, tickers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          <span
            className="text-[11px] text-txt-3 bg-white/[0.06] border border-border rounded-sm px-1.5 py-[2px] cursor-pointer"
            onClick={() => setOpen(false)}
          >
            esc
          </span>
        </div>

        {!filtered ? (
          <div className="p-4 overflow-y-auto flex-1">
            <div className="text-[10px] tracking-[0.14em] uppercase text-txt-3 mb-2.5">
              TRENDING
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {tokens?.slice(0, 5).map((t) => (
                <TrendingCard key={t.address} token={t} onClick={() => goToToken(t.address)} />
              ))}
            </div>
            <div className="text-[10px] tracking-[0.14em] uppercase text-txt-3 mt-3.5">
              RECENTLY VIEWED
            </div>
            <div className="text-[13px] text-txt-3 py-1 pb-2">No recently viewed tokens</div>
            <div className="flex gap-4 mt-4 pt-3 border-t border-border">
              <span className="text-[12px] text-txt-3 flex items-center gap-[5px]">
                <kbd className="font-mono text-[11px] bg-white/[0.06] border border-border rounded-sm px-[5px] py-px text-txt-2">
                  ↵
                </kbd>{' '}
                select
              </span>
              <span className="text-[12px] text-txt-3 flex items-center gap-[5px]">
                <kbd className="font-mono text-[11px] bg-white/[0.06] border border-border rounded-sm px-[5px] py-px text-txt-2">
                  esc
                </kbd>{' '}
                close
              </span>
            </div>
          </div>
        ) : (
          <div className="py-2 overflow-y-auto flex-1">
            {filtered.length > 0 ? (
              filtered.map((t) => (
                <div
                  key={t.address}
                  className="flex items-center gap-2.5 px-4 py-2 cursor-pointer transition-colors hover:bg-mint/[0.06]"
                  onClick={() => goToToken(t.address)}
                >
                  <div className="w-7 h-7 rounded-[5px] bg-white/[0.06] flex items-center justify-center text-[15px]">
                    {t.emoji}
                  </div>
                  <div>
                    <div className="text-[13px] font-bold text-txt">{t.name}</div>
                    <div className="text-[12px] text-txt-3">{t.ltName}</div>
                  </div>
                  <div className="text-right ml-auto">
                    <div
                      className={cn(
                        'text-[13px] font-bold',
                        t.change24h >= 0 ? 'text-mint' : 'text-red',
                      )}
                    >
                      {t.change24h >= 0 ? '+' : ''}
                      {t.change24h}%
                    </div>
                    <div className="text-[12px] text-txt-3 mt-px">
                      ${t.mcapUsd >= 1_000_000
                        ? `${(t.mcapUsd / 1_000_000).toFixed(2)}M`
                        : `${(t.mcapUsd / 1_000).toFixed(1)}K`}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-4 text-[13px] text-txt-3">No tokens found</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
