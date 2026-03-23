import { useAssets } from '@/hooks/useAssets';
import { cn } from '@/utils/format';

export default function AssetTape() {
  const { data: assets } = useAssets();
  if (!assets) return null;

  const doubled = [...assets, ...assets];

  return (
    <div className="h-[32px] overflow-hidden border-b border-border flex items-center bg-bg/80 shrink-0">
      <div className="text-[11px] tracking-[0.14em] uppercase text-mint bg-mint-bg px-3 h-full flex items-center border-r border-border-2 shrink-0 font-medium gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-mint animate-livep" />
        LIVE
      </div>
      <div className="overflow-hidden flex-1">
        <div className="flex items-center animate-scrolltape whitespace-nowrap">
          {doubled.map((a, i) => (
            <div key={`${a.name}-${i}`} className="contents">
              <div className="inline-flex items-center gap-2">
                <span className="text-[13px] font-medium text-txt-3 tracking-[0.06em]">{a.name}</span>
                <span className="text-[13px] font-bold text-txt tabular-nums">{a.priceUsd}</span>
                <span
                  className={cn(
                    'text-[13px] font-semibold tabular-nums',
                    a.change24h >= 0 ? 'text-mint' : 'text-red',
                  )}
                >
                  {a.change24h >= 0 ? '+' : ''}
                  {a.change24h}%
                </span>
              </div>
              <span className="inline-block w-px h-3 bg-border mx-5 align-middle" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
