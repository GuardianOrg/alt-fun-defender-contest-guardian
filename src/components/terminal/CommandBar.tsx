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
            'text-[12px] tracking-[0.05em] text-txt-3 px-3 h-[30px] flex items-center cursor-pointer',
            'border-r border-border bg-transparent border-t-0 border-b-0 border-l-0 font-mono transition-all',
            'hover:text-txt',
            activeFilter === tab.filter && 'text-white bg-mint/[0.12] font-bold',
          )}
          onClick={() => setActiveFilter(tab.filter)}
        >
          {tab.label}
        </button>
      ))}
      <div className="ml-auto flex items-center gap-3">
        <div className="w-1.5 h-1.5 rounded-full bg-mint animate-livep" />
        <span className="text-[13px] text-txt-3">{tokenCount} tokens live</span>
      </div>
    </div>
  );
}
