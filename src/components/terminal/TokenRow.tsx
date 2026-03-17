import { useNavigate } from 'react-router-dom';
import ProgressBar from '@/components/shared/ProgressBar';
import { cn, formatUsd, formatPercent } from '@/utils/format';
import type { Token } from '@/services/types';

interface Props {
  token: Token;
}

export default function TokenRow({ token }: Props) {
  const navigate = useNavigate();
  const isGraduating = token.status === 'graduating';
  const isGraduated = token.status === 'graduated';
  const isShort = token.direction === 'short';
  const up = token.change24h >= 0;
  const buyW = Math.min(
    token.curveFilled - (token.leverageBoost > 0 ? token.leverageBoost : 0),
    token.curveFilled,
  );
  const levW = token.curveFilled - buyW;
  const isLtMover = token.leverageBoost > 15;

  return (
    <div
      className={cn(
        'grid grid-cols-[44px_1fr_68px_1fr_76px] h-[54px] cursor-pointer border-b group',
        isGraduating
          ? cn(
              'border-l-[3px]',
              isShort
                ? 'border-l-red bg-red/[0.03] animate-rowfs border-border'
                : 'border-l-mint bg-mint/[0.03] animate-rowf border-border',
              isShort ? 'hover:!bg-red/[0.08]' : 'hover:!bg-mint/[0.08]',
            )
          : cn(
              'border-l-[3px] border-border bg-transparent transition-colors',
              'hover:bg-white/[0.02]',
              isShort
                ? isLtMover
                  ? 'border-l-amber'
                  : 'border-l-red/60'
                : isLtMover
                  ? 'border-l-amber'
                  : 'border-l-mint-dim/50',
            ),
      )}
      onClick={() => navigate(`/token/${token.address}`)}
    >
      {/* Emoji */}
      <div className="flex items-center justify-center border-r border-border">
        <span className="text-[22px] leading-none">{token.emoji}</span>
      </div>

      {/* Name + LT pair + graduating badge — PRIMARY tier */}
      <div className="flex flex-col justify-center gap-0.5 px-3 border-r border-border overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-txt tracking-[0.04em] uppercase truncate">
            {token.name}
          </span>
          {isGraduating && (
            <span
              className={cn(
                'text-[9px] tracking-[0.08em] uppercase px-1.5 py-px rounded-sm border animate-badgep shrink-0',
                isShort ? 'text-red border-red/50' : 'text-mint border-mint/50',
              )}
            >
              GRAD
            </span>
          )}
        </div>
        <span
          className={cn(
            'text-[10px] font-mono truncate',
            isShort ? 'text-red/40' : 'text-mint/40',
          )}
        >
          {token.ltName.toUpperCase()}
          {isGraduated && ' · GRADUATED'}
        </span>
      </div>

      {/* 24h change — PRIMARY tier */}
      <div className="flex items-center justify-end px-3 border-r border-border">
        <span
          className={cn(
            'font-mono text-sm font-bold tabular-nums',
            up ? 'text-mint' : 'text-red',
          )}
        >
          {formatPercent(token.change24h)}
        </span>
      </div>

      {/* Progress bar + label — SECONDARY tier */}
      <div className="flex flex-col justify-center gap-1 px-3 border-r border-border overflow-hidden">
        <ProgressBar
          buyPercent={buyW}
          leveragePercent={levW}
          isShort={isShort}
          isGraduating={isGraduating}
        />
        <span className="font-mono text-[10px] text-txt-3 truncate tabular-nums">
          {isGraduated ? (
            <span className="text-mint/70">100% graduated</span>
          ) : (
            <>
              {token.curveFilled}%
              {isLtMover && (
                <span className="text-amber/80 ml-1">
                  ⚡ {token.underlying}
                </span>
              )}
            </>
          )}
        </span>
      </div>

      {/* MCAP — PRIMARY tier */}
      <div className="flex items-center justify-end px-3">
        <span className="font-mono text-sm font-semibold text-txt tabular-nums">
          {formatUsd(token.mcapUsd)}
        </span>
      </div>
    </div>
  );
}
