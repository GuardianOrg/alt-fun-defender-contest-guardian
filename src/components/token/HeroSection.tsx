import { useState } from 'react';
import { cn, formatUsd, formatPercent } from '@/utils/format';
import type { Token } from '@/services/types';

interface Props {
  token: Token;
}

export default function HeroSection({ token }: Props) {
  const [copied, setCopied] = useState(false);
  const up = token.change24h >= 0;

  const copyCA = () => {
    navigator.clipboard.writeText(token.address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareToken = () => {
    const text = `${token.emoji} ${token.name} · ${formatPercent(token.change24h)} today\n${token.ltName} — leveraged tokens\n\nbounce.fun`;
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div className="shrink-0 flex items-center px-4 py-2.5 border-b border-border bg-bg-1 gap-4 overflow-hidden">
      {/* Token identity */}
      <div className="w-11 h-11 rounded-xl bg-bg-2 border border-border-2 flex items-center justify-center text-2xl shrink-0 shadow-panel overflow-hidden">
        {token.image ? (
          <img src={token.image} alt={token.name} className="w-full h-full object-cover" />
        ) : (
          token.emoji
        )}
      </div>

      {/* Name + LT + meta */}
      <div className="shrink-0 min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-display text-base font-bold tracking-[0.04em] text-txt leading-none">
            {token.name}
          </div>
          <span className="text-[11px] font-semibold px-1.5 py-[2px] rounded-md bg-mint/[0.08] text-mint/80 tracking-[0.04em] border border-mint/15">
            ⚡ {token.ltName}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[11px] text-txt-4">
            by {token.creatorAddress}
          </span>
          <div className="flex gap-0.5">
            {['𝕏', 'TG'].map((s) => (
              <span
                key={s}
                className="text-[11px] text-txt-4 cursor-pointer px-1 rounded transition-colors hover:text-mint"
              >
                {s}
              </span>
            ))}
          </div>
          <div
            className="flex items-center gap-1 px-1.5 rounded cursor-pointer text-[11px] transition-colors hover:text-mint"
            onClick={copyCA}
          >
            <span className={cn('font-mono', copied ? 'text-mint' : 'text-txt-4')}>
              {copied ? '✓' : `${token.address.slice(0, 4)}…${token.address.slice(-3)} ⎘`}
            </span>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-8 bg-border shrink-0" />

      {/* MCAP + change */}
      <div className="shrink-0">
        <div className="font-display text-xl font-bold text-txt tabular-nums leading-none">
          {formatUsd(token.mcapUsd)}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className={cn('text-[13px] font-semibold tabular-nums', up ? 'text-mint' : 'text-red')}>
            {formatPercent(token.change24h)}
          </span>
          <span className="text-[11px] text-txt-4">24h</span>
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-8 bg-border shrink-0" />

      {/* Secondary stats */}
      <div className="flex items-center gap-3 text-[11px] text-txt-3 shrink-0">
        <span className="tabular-nums">Vol <span className="text-txt-2">{formatUsd(token.volume24h)}</span></span>
        <span>Curve <span className="text-txt-2">{token.curveFilled}%</span></span>
        <span>Lev <span className="text-amber">{token.leverage}×</span></span>
      </div>

      {/* Share button — right side */}
      <div className="ml-auto shrink-0">
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-transparent text-[11px] text-txt-3 font-mono cursor-pointer transition-all duration-150 hover:border-border-2 hover:text-txt hover:bg-white/[0.03]"
          onClick={shareToken}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
          Share
        </button>
      </div>
    </div>
  );
}
