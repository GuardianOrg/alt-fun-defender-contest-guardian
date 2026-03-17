import { useLongTokens, useShortTokens } from '@/hooks/useTokens';
import { useUIStore } from '@/stores/uiStore';
import TokenRow from './TokenRow';

function ColumnHeader({ direction, count }: { direction: 'long' | 'short'; count: number }) {
  const isLong = direction === 'long';
  return (
    <div className="flex items-center h-[26px] shrink-0 border-b border-border-2">
      <div
        className={`text-sm font-semibold tracking-[0.1em] px-4 h-full flex items-center border-r border-border font-mono ${
          isLong ? 'bg-mint/[0.08] text-mint' : 'bg-red/[0.07] text-red'
        }`}
      >
        {isLong ? '▲ LONG' : '▼ SHORT'}
      </div>
      <div className="text-[11px] text-txt-2 px-3 border-r border-border h-full flex items-center font-mono">
        {count} tokens
      </div>
      <div className="text-[11px] text-white px-2.5 h-full flex items-center cursor-pointer border-r border-border font-bold">
        TRENDING ▾
      </div>
      <div className="text-[11px] text-txt-3 px-2.5 h-full flex items-center cursor-pointer border-r border-border hover:text-txt">
        NEWEST
      </div>
      <div className="text-[11px] text-txt-3 px-2.5 h-full flex items-center cursor-pointer border-r border-border hover:text-txt">
        % FILLED
      </div>
    </div>
  );
}

function TableHead() {
  return (
    <div className="grid grid-cols-[52px_1fr_80px_160px_60px] h-[22px] shrink-0 border-b border-border bg-bg-1">
      {['', 'TOKEN', '24H', 'PROGRESS', 'MCAP'].map((h, i) => (
        <div
          key={h || i}
          className={`text-[10px] tracking-[0.1em] uppercase text-txt-2 px-2 flex items-center border-r border-border last:border-r-0 font-mono ${
            i === 2 || i === 4 ? 'justify-end' : ''
          }`}
        >
          {h}
        </div>
      ))}
    </div>
  );
}

export default function TokenTable() {
  const activeFilter = useUIStore((s) => s.activeFilter);
  const { data: longTokens } = useLongTokens(activeFilter);
  const { data: shortTokens } = useShortTokens(activeFilter);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* LONG column */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <ColumnHeader direction="long" count={longTokens?.length ?? 0} />
        <TableHead />
        <div className="flex-1 overflow-y-auto">
          {longTokens?.map((t) => <TokenRow key={t.address} token={t} />)}
        </div>
      </div>

      {/* SHORT column */}
      <div className="flex-1 flex flex-col overflow-hidden border-l border-border">
        <ColumnHeader direction="short" count={shortTokens?.length ?? 0} />
        <TableHead />
        <div className="flex-1 overflow-y-auto">
          {shortTokens?.map((t) => <TokenRow key={t.address} token={t} />)}
        </div>
      </div>
    </div>
  );
}
