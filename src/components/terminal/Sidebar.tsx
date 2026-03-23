import { useNavigate } from 'react-router-dom';
import { useAssets, usePlatformStats, usePairFilters } from '@/hooks/useAssets';
import { cn } from '@/utils/format';

export default function Sidebar() {
  const navigate = useNavigate();
  const { data: assets } = useAssets();
  const { data: stats } = usePlatformStats();
  const { data: filters } = usePairFilters();

  return (
    <div className="w-[200px] shrink-0 border-r border-border flex flex-col bg-bg-1 overflow-y-auto">
      {/* Asset prices */}
      <div className="border-b border-border">
        <div className="text-[11px] tracking-[0.14em] uppercase text-mint px-3 py-1.5 bg-mint-bg border-b border-border font-medium">
          MARKETS
        </div>
        {assets?.map((a, i) => (
          <div
            key={a.name}
            className={cn(
              'flex items-center justify-between px-3 py-2.5 cursor-pointer transition-colors hover:bg-white/[0.02]',
              i < (assets.length - 1) && 'border-b border-border',
            )}
          >
            <div>
              <div className="text-[14px] font-bold text-txt">{a.name}</div>
              <div
                className={cn(
                  'text-[12px] font-semibold tabular-nums mt-0.5',
                  a.change24h >= 0 ? 'text-mint' : 'text-red',
                )}
              >
                {a.change24h >= 0 ? '+' : ''}
                {a.change24h.toFixed(2)}%
              </div>
            </div>
            <div className="text-[14px] font-semibold text-txt tabular-nums">{a.priceUsd}</div>
          </div>
        ))}
      </div>

      {/* Platform stats — hidden from UI, data still fetched for later use */}

      {/* Pair filters */}
      {filters && (
        <div className="border-b border-border">
          <div className="text-[11px] tracking-[0.14em] uppercase text-txt-3 px-3 py-1.5 font-medium">
            PAIRS
          </div>
          {filters.map((f) => (
            <div key={`${f.asset}-${f.direction}`} className="flex items-center gap-1.5 px-3 py-1 cursor-pointer hover:bg-white/[0.02] transition-colors">
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: f.color }} />
              <span className="text-[13px] text-txt-2">
                {f.asset} {f.direction === 'long' ? 'Long' : 'Short'}
              </span>
              <span className="text-[11px] text-txt-3 ml-auto tabular-nums">{f.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Launch CTA */}
      <div className="px-3 py-3 mt-auto">
        <button
          className="w-full flex items-center gap-2.5 bg-mint/[0.05] border border-border-2 rounded-[3px] px-3 py-2.5 cursor-pointer transition-all font-mono text-left hover:bg-mint/[0.10] hover:border-mint/40 hover:shadow-inner-mint"
          onClick={() => navigate('/create')}
        >
          <span className="text-lg">⚡</span>
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] font-bold text-mint tracking-[0.05em] uppercase">
              create
            </span>
            <span className="text-[11px] text-txt-3">launch a levered token</span>
          </span>
        </button>
      </div>
    </div>
  );
}
