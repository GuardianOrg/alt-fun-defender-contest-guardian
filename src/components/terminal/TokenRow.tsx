import { useNavigate } from 'react-router-dom';
import ProgressBar from '@/components/shared/ProgressBar';
import Badge from '@/components/shared/Badge';
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
        'grid grid-cols-[52px_1fr_80px_160px_60px] h-14 cursor-pointer border-b',
        isGraduating
          ? cn(
              'border-l-[3px] relative',
              isShort
                ? 'border-l-red bg-red/[0.03] animate-rowfs border-border-2'
                : 'border-l-mint bg-mint/[0.04] animate-rowf border-border-2',
              isShort ? 'hover:!bg-red/10' : 'hover:!bg-mint/[0.12]',
            )
          : cn(
              'border-l-[3px] border-border bg-transparent transition-colors hover:bg-bg-2',
              isShort
                ? isLtMover
                  ? 'border-l-amber'
                  : 'border-l-red'
                : isLtMover
                  ? 'border-l-amber'
                  : 'border-l-mint-dim',
            ),
      )}
      onClick={() => navigate(`/token/${token.address}`)}
    >
      {isGraduating && (
        <Badge
          variant={isShort ? 'graduating-short' : 'graduating'}
          className="absolute top-1 right-1.5 z-10"
        >
          GRADUATING
        </Badge>
      )}
      <div className="flex items-center justify-center px-2.5 border-r border-border overflow-hidden">
        <span className="text-[28px] leading-none">{token.emoji}</span>
      </div>
      <div className="flex flex-col items-start justify-center gap-[3px] px-2.5 border-r border-border overflow-hidden">
        <span className="font-mono text-[13px] font-bold text-txt tracking-[0.08em] uppercase">
          {token.name}
        </span>
        <span
          className={cn(
            'text-[12px] font-normal font-mono',
            isShort ? 'text-red/70' : 'text-mint/70',
          )}
        >
          {token.ltName.toUpperCase()}
          {isGraduated && ' · GRAD'}
        </span>
      </div>
      <div className="flex items-center justify-end px-2.5 border-r border-border overflow-hidden">
        <span
          className={cn('font-mono text-sm font-bold tracking-[0.04em]', up ? 'text-mint' : 'text-red')}
        >
          {formatPercent(token.change24h)}
        </span>
      </div>
      <div className="flex flex-col justify-center gap-[5px] px-3 border-r border-border overflow-hidden relative">
        <ProgressBar
          buyPercent={buyW}
          leveragePercent={levW}
          isShort={isShort}
          isGraduating={isGraduating}
        />
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[12px] font-semibold text-txt-2">
            {isGraduated ? (
              <span className="text-mint">100% graduated</span>
            ) : (
              <>
                {token.curveFilled}%
                {isLtMover && (
                  <span className="text-amber text-[11px] ml-1">
                    ⚡ {token.underlying}
                  </span>
                )}
              </>
            )}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-end px-2.5 overflow-hidden">
        <span className="font-mono text-[13px] font-semibold text-txt-2 tracking-[0.04em]">
          {formatUsd(token.mcapUsd)}
        </span>
      </div>
    </div>
  );
}
