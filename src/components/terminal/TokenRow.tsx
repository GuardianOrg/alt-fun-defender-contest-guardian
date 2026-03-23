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
        'grid grid-cols-[52px_1fr_72px_1fr_80px] h-[58px] cursor-pointer border-b group',
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
      {/* Icon */}
      <div className="flex items-center justify-center border-r border-border">
        {token.image ? (
          <img
            src={token.image}
            alt={token.name}
            className="w-8 h-8 rounded-md object-cover transition-transform duration-200 group-hover:scale-110"
          />
        ) : (
          <span className="text-[28px] leading-none transition-transform duration-200 group-hover:scale-110">
            {token.emoji}
          </span>
        )}
      </div>

      {/* Name + LT pair + graduating badge — PRIMARY tier */}
      <div className="flex flex-col justify-center gap-0.5 px-3 border-r border-border overflow-hidden">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[15px] font-bold text-txt tracking-[0.04em] uppercase truncate">
            {token.name}
          </span>
          <span
            className={cn(
              'text-[12px] font-bold px-1.5 py-0.5 rounded shrink-0 tabular-nums',
              isShort
                ? 'text-red bg-red/[0.10]'
                : 'text-mint bg-mint/[0.10]',
            )}
          >
            {token.leverage}×
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
            'text-[12px] font-mono truncate',
            isShort ? 'text-red/60' : 'text-mint/60',
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
            'font-mono text-[15px] font-bold tabular-nums',
            up ? 'text-mint' : 'text-red',
          )}
        >
          {formatPercent(token.change24h)}
        </span>
      </div>

      {/* Progress bar */}
      <div className="flex items-center px-3 border-r border-border overflow-hidden">
        <ProgressBar
          buyPercent={buyW}
          leveragePercent={levW}
          isShort={isShort}
          isGraduating={isGraduating}
        />
      </div>

      {/* MCAP — PRIMARY tier */}
      <div className="flex items-center justify-end px-3">
        <span className="font-mono text-[15px] font-semibold text-txt tabular-nums">
          {formatUsd(token.mcapUsd)}
        </span>
      </div>
    </div>
  );
}
