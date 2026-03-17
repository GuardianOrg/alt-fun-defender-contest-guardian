import { useUIStore } from '@/stores/uiStore';
import type { TokenFilter } from '@/services/types';
import { cn } from '@/utils/format';

const TABS: { label: string; filter: TokenFilter }[] = [
  { label: 'TRENDING', filter: 'trending' },
  { label: 'NEW', filter: 'new' },
  { label: '⚡ LT MOVERS', filter: 'lt-movers' },
  { label: 'GRADUATING', filter: 'graduating' },
  { label: 'ALL', filter: 'all' },
];

interface Props {
  tokenCount: number;
}

export default function CommandBar({ tokenCount }: Props) {
  const activeFilter = useUIStore((s) => s.activeFilter);
  const setActiveFilter = useUIStore((s) => s.setActiveFilter);

  return (
    <div className="flex items-center h-[30px] border-b border-border bg-bg-1 px-4 shrink-0">
      <span className="text-[11px] tracking-[0.1em] uppercase text-txt-3 mr-3">VIEW</span>
      {TABS.map((tab) => (
        <button
          key={tab.filter}
          className={cn(
            'relative text-[13px] tracking-[0.04em] text-txt-3 px-3 h-[30px] flex items-center cursor-pointer',
            'border-0 bg-transparent font-mono transition-all duration-150',
            'hover:text-txt hover:bg-white/[0.03]',
            activeFilter === tab.filter && 'text-txt bg-white/[0.04] font-bold',
          )}
          onClick={() => setActiveFilter(tab.filter)}
        >
          {tab.label}
          {activeFilter === tab.filter && (
            <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-mint rounded-full" />
          )}
        </button>
      ))}
      <div className="ml-auto flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-mint animate-livep" />
        <span className="text-[13px] text-txt-3 tabular-nums">{tokenCount} tokens live</span>
      </div>
    </div>
  );
}
