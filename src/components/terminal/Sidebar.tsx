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
        <div className="text-[10px] tracking-[0.15em] uppercase text-mint px-3 py-[7px] bg-mint-bg border-b border-border">
          MARKETS
        </div>
        {assets?.map((a, i) => (
          <div
            key={a.name}
            className={cn(
              'flex items-center justify-between px-3 py-[7px] cursor-pointer transition-colors hover:bg-mint-bg',
              i < (assets.length - 1) && 'border-b border-border',
            )}
          >
            <div className="text-[13px] font-semibold text-txt">{a.name}</div>
            <div className="text-right">
              <div className="text-[13px] font-medium text-txt">{a.priceUsd}</div>
              <div
                className={cn(
                  'text-[12px] font-semibold',
                  a.change24h >= 0 ? 'text-mint' : 'text-red',
                )}
              >
                {a.change24h >= 0 ? '+' : ''}
                {a.change24h.toFixed(2)}%
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Platform stats */}
      {stats && (
        <div className="border-b border-border">
          <div className="text-[10px] tracking-[0.15em] uppercase text-mint px-3 py-[7px] bg-mint-bg border-b border-border">
            PLATFORM STATS
          </div>
          {[
            { label: 'tokens live', value: stats.tokensLive, cls: 'text-mint' },
            { label: 'graduating', value: stats.graduating, cls: 'text-amber' },
            { label: '24h volume', value: stats.volume24h, cls: '' },
            { label: 'graduated today', value: stats.graduatedToday, cls: 'text-mint' },
            { label: 'total raised', value: stats.totalRaised, cls: '' },
          ].map((s) => (
            <div
              key={s.label}
              className="flex items-center justify-between px-3 py-1.5 border-b border-border text-[12px]"
            >
              <span className="text-txt-3">{s.label}</span>
              <span className={cn('font-semibold text-txt', s.cls)}>{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Pair filters */}
      {filters && (
        <div className="border-b-0">
          <div className="text-[10px] tracking-[0.15em] uppercase text-txt-3 px-3 py-[7px] pb-1">
            PAIRS
          </div>
          {filters.map((f) => (
            <div key={`${f.asset}-${f.direction}`} className="flex items-center gap-1.5 px-3 py-1 cursor-pointer">
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: f.color }} />
              <span className="text-[12px] text-txt-2">
                {f.asset} {f.direction === 'long' ? 'Long' : 'Short'}
              </span>
              <span className="text-[11px] text-txt-3 ml-auto">{f.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Launch CTA */}
      <div className="px-3 py-3.5 mt-auto">
        <button
          className="w-full flex items-center gap-2.5 bg-mint-bg border border-border-2 rounded-[3px] px-3 py-2.5 cursor-pointer transition-all font-mono text-left hover:bg-mint/[0.15] hover:border-mint"
          onClick={() => navigate('/create')}
        >
          <span className="text-lg">⚡</span>
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] font-bold text-mint tracking-[0.05em] uppercase">
              create
            </span>
            <span className="text-[11px] text-txt-3">launch a levered memecoin</span>
          </span>
        </button>
      </div>
    </div>
  );
}
