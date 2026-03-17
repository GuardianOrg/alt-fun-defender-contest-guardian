import { useTradeFeed } from '@/hooks/useTradeFeed';
import { useTokens } from '@/hooks/useTokens';
import { cn } from '@/utils/format';

export default function RightPanel() {
  const trades = useTradeFeed();
  const { data: tokens } = useTokens();

  const graduating = tokens?.filter((t) => t.status === 'graduating') ?? [];
  const ltMovers = tokens
    ?.filter((t) => t.leverageBoost > 0)
    ?.sort((a, b) => b.leverageBoost - a.leverageBoost)
    ?.slice(0, 3) ?? [];

  return (
    <div className="w-[220px] shrink-0 border-l border-border flex flex-col bg-bg-1 overflow-y-auto">
      {/* Recent trades */}
      <div className="border-b border-border">
        <div className="text-[10px] tracking-[0.15em] uppercase text-mint px-3 py-[7px] bg-mint-bg border-b border-border flex justify-between items-center">
          RECENT TRADES <span className="text-txt-3">LIVE</span>
        </div>
        <div>
          {trades.map((t) => {
            const isBuy = t.side === 'BUY';
            return (
              <div
                key={t.id}
                className="flex items-start gap-1.5 px-3 py-1.5 border-b border-border text-[12px] cursor-pointer transition-colors hover:bg-mint-bg"
              >
                <span className="text-txt-3 shrink-0 text-[11px]">{t.timestamp}</span>
                <div className="flex-1">
                  <div className="font-bold text-txt font-mono">{t.tokenName}</div>
                  <div className="text-txt-2 mt-px text-[11px]">{t.walletAddress}</div>
                </div>
                <span
                  className={cn(
                    'shrink-0 font-semibold font-mono',
                    isBuy ? 'text-mint' : 'text-red',
                  )}
                >
                  {isBuy ? '+' : '-'}${t.amountUsd.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Graduating soon */}
      {graduating.length > 0 && (
        <div className="border-b border-border">
          <div className="text-[10px] tracking-[0.15em] uppercase text-mint px-3 py-[7px] bg-mint-bg border-b border-border">
            GRADUATING SOON
          </div>
          {graduating.map((t) => (
            <div
              key={t.address}
              className="flex items-center justify-between px-3 py-1.5 border-b border-border last:border-b-0 text-[12px]"
            >
              <span className="text-txt-3 font-mono">{t.name}</span>
              <span className="font-medium text-amber font-mono">
                {t.curveFilled}% · {t.direction === 'long' ? 'LONG' : 'SHORT'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Top LT movers */}
      <div className="border-b border-border">
        <div className="text-[10px] tracking-[0.15em] uppercase text-mint px-3 py-[7px] bg-mint-bg border-b border-border">
          TOP LT MOVERS
        </div>
        {ltMovers.map((t) => (
          <div
            key={t.address}
            className="flex items-center justify-between px-3 py-1.5 border-b border-border last:border-b-0 text-[12px]"
          >
            <span className="text-txt-3 font-mono">{t.name}</span>
            <span className="font-medium text-mint font-mono">
              +{t.change24h}% {t.ltName.split(' ').slice(0, 2).join('')}
            </span>
          </div>
        ))}
      </div>

      {/* My positions */}
      <div>
        <div className="text-[10px] tracking-[0.15em] uppercase text-mint px-3 py-[7px] bg-mint-bg border-b border-border">
          MY POSITIONS
        </div>
        {[
          { name: 'PEPE2L', pnl: '+$184', cls: 'text-mint' },
          { name: 'WAVEBEAR', pnl: '+$92', cls: 'text-mint' },
          { name: 'DOOMER', pnl: '-$41', cls: 'text-red' },
        ].map((p) => (
          <div
            key={p.name}
            className="flex items-center justify-between px-3 py-1.5 border-b border-border text-[12px]"
          >
            <span className="text-txt-3 font-mono">{p.name}</span>
            <span className={cn('font-medium font-mono', p.cls)}>{p.pnl}</span>
          </div>
        ))}
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-border-2 text-[12px]">
          <span className="text-txt-3 font-mono">NET P&L</span>
          <span className="font-medium text-mint font-mono">+$235</span>
        </div>
      </div>
    </div>
  );
}
