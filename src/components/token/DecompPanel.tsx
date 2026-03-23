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
    <div className="shrink-0 border-t border-border bg-bg-1">
      <div className="px-5 py-3 flex items-center gap-2.5">
        {/* Total 24h card */}
        <div
          className={cn(
            'flex-1 bg-bg-2/40 border rounded-lg px-3.5 py-2.5',
            token.change24h >= 0 ? 'border-mint/15' : 'border-red/15',
          )}
        >
          <div className="text-[11px] text-txt-3 tracking-[0.08em] uppercase mb-1.5">total 24h</div>
          <div
            className={cn(
              'font-display text-xl font-bold leading-none tabular-nums',
              token.change24h >= 0 ? 'text-mint' : 'text-red',
            )}
          >
            {formatPercent(token.change24h)}
          </div>
        </div>

        {/* Buy momentum card */}
        <div className="flex-1 bg-bg-2/40 border border-border rounded-lg px-3.5 py-2.5">
          <div className="text-[11px] text-txt-3 tracking-[0.08em] uppercase mb-1.5">buy momentum</div>
          <div
            className={cn(
              'font-display text-xl font-bold leading-none tabular-nums',
              token.buyMomentum >= 0 ? 'text-mint' : 'text-red',
            )}
          >
            {formatPercent(token.buyMomentum)}
          </div>
          <div className="text-[11px] text-txt-3 mt-1">trade activity</div>
        </div>

        {/* Leverage boost card */}
        <div className="flex-1 bg-amber/[0.04] border border-amber/15 rounded-lg px-3.5 py-2.5">
          <div className="text-[11px] text-txt-3 tracking-[0.08em] uppercase mb-1.5">leverage boost</div>
          <div className="font-display text-xl font-bold leading-none text-amber tabular-nums">
            {formatPercent(token.leverageBoost)}
          </div>
          <div className="text-[11px] text-txt-3 mt-1 tabular-nums">
            {formatPercent(underlyingChg)} × {token.leverage}×
          </div>
        </div>

        {/* Share button */}
        <button
          className="shrink-0 flex items-center gap-1.5 bg-bg-2/50 border border-border rounded-lg px-3 py-2.5 cursor-pointer text-[11px] text-txt-3 transition-all hover:border-border-2 hover:text-txt hover:bg-bg-2 self-stretch"
          onClick={shareDecomp}
        >
          <span className="text-sm">↗</span>
          share
        </button>
      </div>
    </div>
  );
}
