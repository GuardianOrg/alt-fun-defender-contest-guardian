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
    <div className="shrink-0 border-t border-border bg-bg-1 px-5 py-2.5 flex items-center gap-0">
      <div className="px-4 border-r border-border first:pl-0">
        <div
          className={cn(
            'font-display text-lg font-semibold leading-none tabular-nums',
            token.change24h >= 0 ? 'text-mint' : 'text-red',
          )}
        >
          {formatPercent(token.change24h)}
        </div>
        <div className="text-[11px] text-txt-3 tracking-[0.06em] uppercase mt-1">
          total 24h
        </div>
      </div>
      <div className="px-4 border-r border-border">
        <div
          className={cn(
            'font-display text-lg font-semibold leading-none tabular-nums',
            token.buyMomentum >= 0 ? 'text-mint' : 'text-red',
          )}
        >
          {formatPercent(token.buyMomentum)}
        </div>
        <div className="text-[11px] text-txt-3 tracking-[0.06em] uppercase mt-1">
          buy momentum
        </div>
        <div className="text-[11px] text-txt-3 mt-px">trade activity</div>
      </div>
      <div className="px-4 border-r border-border">
        <div className="font-display text-lg font-semibold leading-none text-amber tabular-nums">
          {formatPercent(token.leverageBoost)}
        </div>
        <div className="text-[11px] text-txt-3 tracking-[0.06em] uppercase mt-1">
          leverage boost
        </div>
        <div className="text-[11px] text-txt-3 mt-px tabular-nums">
          {formatPercent(underlyingChg)} × {token.leverage}×
        </div>
      </div>
      <div className="ml-auto">
        <button
          className="inline-flex items-center gap-1.5 bg-bg-2/60 border border-border rounded-sm px-2.5 py-1.5 cursor-pointer text-[13px] text-txt-3 transition-all hover:border-border-2 hover:text-txt hover:bg-bg-2"
          onClick={shareDecomp}
        >
          ↗ share this breakdown
        </button>
      </div>
    </div>
  );
}
