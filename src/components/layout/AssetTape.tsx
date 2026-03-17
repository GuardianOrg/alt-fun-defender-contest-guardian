import { useAssets } from '@/hooks/useAssets';
import { cn } from '@/utils/format';

export default function AssetTape() {
  const { data: assets } = useAssets();
  if (!assets) return null;

  const doubled = [...assets, ...assets];

  return (
    <div className="h-[34px] overflow-hidden border-b border-border flex items-center bg-black/20 shrink-0">
      <div className="text-[11px] tracking-[0.15em] uppercase text-mint bg-mint-bg px-3.5 h-full flex items-center border-r border-border-2 shrink-0">
        MARKETS
      </div>
      <div className="overflow-hidden flex-1">
        <div className="flex items-center animate-scrolltape whitespace-nowrap">
          {doubled.map((a, i) => (
            <div key={`${a.name}-${i}`} className="contents">
              <div className="inline-flex items-center gap-2.5">
                <span className="text-[13px] font-semibold text-txt-2 tracking-[0.08em]">{a.name}</span>
                <span className="text-sm font-bold text-txt">{a.priceUsd}</span>
                <span
                  className={cn(
                    'text-[13px] font-semibold',
                    a.change24h >= 0 ? 'text-mint' : 'text-red',
                  )}
                >
                  {a.change24h >= 0 ? '+' : ''}
                  {a.change24h}%
                </span>
              </div>
              <span className="inline-block w-px h-3.5 bg-border mx-6 align-middle" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
