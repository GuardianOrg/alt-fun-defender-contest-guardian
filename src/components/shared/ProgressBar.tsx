import { useState, useRef } from 'react';
import { cn } from '@/utils/format';

interface ProgressBarProps {
  buyPercent: number;
  leveragePercent: number;
  isShort?: boolean;
  isGraduating?: boolean;
  label?: string;
  showLegend?: boolean;
  buyUsd?: string;
  leverageUsd?: string;
  size?: 'sm' | 'md';
}

export default function ProgressBar({
  buyPercent,
  leveragePercent,
  isShort = false,
  isGraduating = false,
  label,
  showLegend = false,
  buyUsd,
  leverageUsd,
  size = 'sm',
}: ProgressBarProps) {
  const [tooltip, setTooltip] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });

  const buyPctDisplay = Math.round(buyPercent);
  const levPctDisplay = Math.round(leveragePercent * 10) / 10;

  return (
    <div className="relative w-full">
      <div
        ref={trackRef}
        className={cn(
          'w-full rounded-full relative cursor-pointer',
          leveragePercent > 0 ? 'overflow-visible' : 'overflow-hidden',
          size === 'sm' ? 'h-[8px]' : 'h-[10px]',
          'bg-white/[0.06]',
        )}
        onMouseEnter={() => setTooltip(true)}
        onMouseMove={(e) => setTipPos({ x: e.clientX + 12, y: e.clientY - 60 })}
        onMouseLeave={() => setTooltip(false)}
      >
        {/* Buy pressure segment */}
        <div
          className={cn(
            'absolute top-0 left-0 h-full rounded-l-full',
            'bg-mint-dim bar-glow-mint',
            isGraduating && 'animate-gradpulse',
          )}
          style={{ width: `${buyPercent}%` }}
        />
        {/* Leverage boost segment — white fire glow */}
        {leveragePercent > 0 && (
          <div
            className={cn(
              'absolute top-0 h-full leverage-fire',
              isShort ? 'leverage-fire-red' : 'leverage-fire-mint',
            )}
            style={{
              left: `${buyPercent}%`,
              width: `${leveragePercent}%`,
            }}
          />
        )}
      </div>

      {label && (
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[13px] font-semibold text-txt-2">{label}</span>
        </div>
      )}

      {showLegend && (
        <div className="flex gap-4 mt-2">
          <div className="flex items-center gap-1.5 text-[11px] text-txt-3">
            <div className="w-2 h-2 rounded-full bg-mint-dim bar-glow-mint shrink-0" />
            buy pressure{buyUsd && ` · ${buyUsd}`}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-txt-3">
            <div className={cn('w-2 h-2 rounded-full shrink-0 leverage-fire-dot', isShort ? 'leverage-fire-dot-red' : 'leverage-fire-dot-mint')} />
            leverage boost{leverageUsd && ` · ${leverageUsd}`}
          </div>
        </div>
      )}

      {tooltip && leveragePercent > 0 && (
        <div
          className="fixed z-[999] pointer-events-none bg-bg-2 border border-border-2 rounded px-3 py-2 text-[11px] whitespace-nowrap font-mono shadow-panel"
          style={{ left: Math.min(tipPos.x, window.innerWidth - 200), top: tipPos.y }}
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="w-[6px] h-[6px] rounded-full bg-mint-dim shrink-0" />
            <span className="text-txt-3">buy pressure</span>
            <span className="text-mint font-semibold ml-auto pl-4 tabular-nums">{buyPctDisplay}%</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'w-[6px] h-[6px] rounded-full shrink-0',
                isShort ? 'bg-red' : 'bg-aqua',
              )}
            />
            <span className="text-txt-3">leverage boost</span>
            <span className="text-amber font-semibold ml-auto pl-4 tabular-nums">{levPctDisplay}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
