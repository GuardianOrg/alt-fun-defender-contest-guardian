import { useState } from 'react';
import Badge from '@/components/shared/Badge';
import { cn, formatUsd, formatPercent } from '@/utils/format';
import type { Token } from '@/services/types';

interface Props {
  token: Token;
}

export default function HeroSection({ token }: Props) {
  const [copied, setCopied] = useState(false);
  const up = token.change24h >= 0;
  const athPct = token.athUsd > 0 ? Math.round((token.mcapUsd / token.athUsd) * 100) : 0;
  const changeUsd = (token.mcapUsd * token.change24h) / (100 + token.change24h);

  const copyCA = () => {
    navigator.clipboard.writeText(token.address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-start gap-6 px-[18px] py-3.5 pb-3 border-b border-border bg-bg-1 shrink-0">
      {/* Left block */}
      <div className="shrink-0">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 rounded-[10px] bg-bg-2 border border-border-2 flex items-center justify-center text-2xl">
            {token.emoji}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="font-display text-xl font-bold tracking-[0.04em] text-txt leading-none">
                {token.name}
              </div>
              <span className="text-[12px] font-semibold px-2 py-[2px] rounded-sm bg-mint-bg text-mint tracking-[0.04em]">
                ⚡ {token.ltName}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-[5px] flex-wrap">
              <span className="text-[12px] text-txt-3">
                by {token.creatorAddress} · {token.createdAt}
              </span>
              <div className="flex gap-1">
                {['𝕏', 'TG', '🌐'].map((s) => (
                  <span
                    key={s}
                    className="text-[12px] text-txt-3 cursor-pointer px-[7px] py-[2px] border border-border rounded-sm transition-all hover:text-mint hover:border-border-2"
                  >
                    {s}
                  </span>
                ))}
              </div>
              <div
                className="flex items-center gap-[5px] bg-bg-2 border border-border rounded-sm px-2 py-[3px] cursor-pointer transition-all hover:border-mint hover:bg-mint-bg"
                onClick={copyCA}
              >
                <span className={cn('text-[12px]', copied ? 'text-mint' : 'text-txt-3')}>
                  {token.address.slice(0, 6)}…{token.address.slice(-4)}
                </span>
                <span className={cn('text-[13px]', copied ? 'text-mint' : 'text-txt-3')}>
                  {copied ? '✓' : '⎘'}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-2.5">
          <div className="text-[11px] tracking-[0.1em] uppercase text-txt-3 mb-[2px]">
            Market Cap
          </div>
          <div className="font-display text-4xl font-bold text-txt leading-none">
            {formatUsd(token.mcapUsd)}
          </div>
          <div className="text-[13px] mt-1 font-medium">
            <span className={up ? 'text-mint' : 'text-red'}>
              {up ? '+' : ''}${Math.abs(Math.round(changeUsd)).toLocaleString()} ({formatPercent(token.change24h)})
            </span>{' '}
            <span className="text-txt-3">24h</span>
          </div>
        </div>
      </div>

      {/* Right block */}
      <div className="flex-1 flex flex-col gap-3 pt-1">
        <div className="flex items-center gap-3">
          <Badge variant="ath">
            <div className="w-[5px] h-[5px] rounded-full bg-amber" />
            ATH {formatUsd(token.athUsd)}
          </Badge>
          <div className="flex-1 flex items-center gap-2">
            <div className="flex-1 h-[5px] bg-white/[0.07] rounded-[3px] overflow-hidden">
              <div
                className="h-full rounded-[3px]"
                style={{
                  width: `${athPct}%`,
                  background: 'linear-gradient(90deg, #2ab88a, #f0b429)',
                }}
              />
            </div>
            <span className="text-[11px] text-txt-3 whitespace-nowrap">{athPct}% of ATH</span>
          </div>
        </div>
        <div className="flex gap-0">
          <div className="px-4 border-r border-border text-center first:pl-0">
            <div className="font-display text-base font-semibold leading-none">
              {formatUsd(token.volume24h)}
            </div>
            <div className="text-[11px] text-txt-3 tracking-[0.06em] uppercase mt-[3px]">
              24h vol
            </div>
          </div>
          <div className="px-4 text-center">
            <div className="font-display text-base font-semibold leading-none">
              {token.curveFilled}%
            </div>
            <div className="text-[11px] text-txt-3 tracking-[0.06em] uppercase mt-[3px]">
              curve filled
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
