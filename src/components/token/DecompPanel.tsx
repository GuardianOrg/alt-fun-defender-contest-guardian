import { cn, formatPercent } from '@/utils/format';
import type { Token } from '@/services/types';

interface Props {
  token: Token;
}

export default function DecompPanel({ token }: Props) {
  const shareDecomp = () => {
    const txt = `${token.name} ${formatPercent(token.change24h)} today\n${formatPercent(token.buyMomentum)} buys · ${formatPercent(token.leverageBoost)} leverage boost\n\nperps × memes — bounce.fun`;
    navigator.clipboard.writeText(txt).catch(() => {});
  };

  const underlyingChg = token.leverageBoost / token.leverage;

  return (
    <div className="shrink-0 border-t border-border bg-bg-1 px-4 py-[9px] flex items-center gap-0">
      <div className="px-[18px] border-r border-border first:pl-0">
        <div
          className={cn(
            'font-display text-[19px] font-semibold leading-none',
            token.change24h >= 0 ? 'text-mint' : 'text-red',
          )}
        >
          {formatPercent(token.change24h)}
        </div>
        <div className="text-[11px] text-txt-3 tracking-[0.06em] uppercase mt-[3px]">
          total 24h
        </div>
      </div>
      <div className="px-[18px] border-r border-border">
        <div
          className={cn(
            'font-display text-[19px] font-semibold leading-none',
            token.buyMomentum >= 0 ? 'text-mint' : 'text-red',
          )}
        >
          {formatPercent(token.buyMomentum)}
        </div>
        <div className="text-[11px] text-txt-3 tracking-[0.06em] uppercase mt-[3px]">
          buy momentum
        </div>
        <div className="text-[11px] text-txt-3 mt-px">trade activity</div>
      </div>
      <div className="px-[18px] border-r border-border">
        <div className="font-display text-[19px] font-semibold leading-none text-amber">
          {formatPercent(token.leverageBoost)}
        </div>
        <div className="text-[11px] text-txt-3 tracking-[0.06em] uppercase mt-[3px]">
          leverage boost
        </div>
        <div className="text-[11px] text-txt-3 mt-px">
          {formatPercent(underlyingChg)} × {token.leverage}×
        </div>
      </div>
      <div className="ml-auto">
        <button
          className="inline-flex items-center gap-[5px] bg-bg-2 border border-border rounded-sm px-2.5 py-[5px] cursor-pointer text-[12px] text-txt-3 transition-all hover:border-border-2 hover:text-txt"
          onClick={shareDecomp}
        >
          ↗ share this breakdown
        </button>
      </div>
    </div>
  );
}
