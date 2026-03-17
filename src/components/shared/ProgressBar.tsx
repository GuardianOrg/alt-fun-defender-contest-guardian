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

  return (
    <div className="relative w-full">
      <div
        ref={trackRef}
        className={cn(
          'w-full rounded-[3px] relative cursor-pointer',
          size === 'sm' ? 'h-[12px]' : 'h-[14px]',
          'bg-white/[0.10]',
        )}
        onMouseEnter={() => setTooltip(true)}
        onMouseMove={(e) => setTipPos({ x: e.clientX + 12, y: e.clientY - 60 })}
        onMouseLeave={() => setTooltip(false)}
      >
        <div className="absolute inset-0 flex rounded-[3px] overflow-hidden">
          <div
            className={cn(
              'h-full bg-mint-dim rounded-l-[3px]',
              isGraduating && 'animate-gradpulse',
            )}
            style={{ width: `${buyPercent}%` }}
          />
          {leveragePercent > 0 && (
            <div
              className={cn(
                'h-full animate-ltb',
                isShort ? 'bg-[#ff6060] opacity-85' : 'bg-aqua opacity-90',
              )}
              style={{ width: `${leveragePercent}%` }}
            />
          )}
        </div>
      </div>

      {label && (
        <div className="flex items-center gap-1.5 mt-[5px]">
          <span className="text-[12px] font-semibold text-txt-2">{label}</span>
        </div>
      )}

      {showLegend && (
        <div className="flex gap-4 mt-[7px]">
          <div className="flex items-center gap-[5px] text-[12px] text-txt-3">
            <div className="w-2 h-2 rounded-sm bg-mint-dim shrink-0" />
            buy pressure{buyUsd && ` · ${buyUsd}`}
          </div>
          <div className="flex items-center gap-[5px] text-[12px] text-txt-3">
            <div
              className={cn(
                'w-2 h-2 rounded-sm shrink-0',
                isShort ? 'bg-[#ff5050]' : 'bg-aqua',
              )}
            />
            leverage appreciation{leverageUsd && ` · ${leverageUsd}`}
          </div>
        </div>
      )}

      {tooltip && leveragePercent > 0 && (
        <div
          className="fixed z-[999] pointer-events-none bg-[#1a3830] border border-border-2 rounded px-2.5 py-[7px] text-[11px] whitespace-nowrap font-mono"
          style={{ left: Math.min(tipPos.x, window.innerWidth - 200), top: tipPos.y }}
        >
          <div className="flex items-center gap-1.5 mb-[3px]">
            <div className="w-2 h-2 rounded-sm bg-mint-dim shrink-0" />
            <span className="text-txt-3">buy pressure</span>
            <span className="text-mint font-semibold ml-auto pl-3.5">{buyPercent}%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                'w-2 h-2 rounded-sm shrink-0',
                isShort ? 'bg-[#ff6060]' : 'bg-aqua',
              )}
            />
            <span className="text-txt-3">leverage boost</span>
            <span className="text-amber font-semibold ml-auto pl-3.5">{leveragePercent}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
