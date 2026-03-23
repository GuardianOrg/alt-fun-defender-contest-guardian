import { cn } from '@/utils/format';
import { UNDERLYING_ASSETS, LEVERAGE_OPTIONS } from '@/config/constants';
import { MOCK_ASSET_DATA } from '@/services/mock/assets';
import StepHeader from './StepHeader';
import type { Direction } from '@/services/types';
import type { UnderlyingAsset, Leverage } from '@/config/constants';

interface Props {
  direction: Direction;
  asset: UnderlyingAsset;
  leverage: Leverage;
  onDirectionChange: (d: Direction) => void;
  onAssetChange: (a: UnderlyingAsset) => void;
  onLeverageChange: (l: Leverage) => void;
}

function ltName(asset: UnderlyingAsset, lev: Leverage, dir: Direction) {
  return `${asset} ${lev}× ${dir === 'long' ? 'Long' : 'Short'}`;
}

function ltChg(asset: UnderlyingAsset, lev: Leverage, dir: Direction) {
  const data = MOCK_ASSET_DATA[asset];
  return dir === 'long' ? data.chg * lev : -data.chg * lev;
}

export default function PairSelector({
  direction,
  asset,
  leverage,
  onDirectionChange,
  onAssetChange,
  onLeverageChange,
}: Props) {
  const isLong = direction === 'long';
  const chg = ltChg(asset, leverage, direction);

  return (
    <div>
      <StepHeader step={1} title="Choose your pair" subtitle="Pick a direction and underlying asset." />

      {/* Direction cards */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <button
          className={cn(
            'p-5 rounded-xl border cursor-pointer font-mono text-left relative overflow-hidden transition-all duration-200',
            isLong
              ? 'border-mint/40 bg-gradient-to-br from-mint/[0.08] to-transparent shadow-inner-mint'
              : 'border-border bg-bg-2/60 hover:border-border-2 hover:bg-bg-3/50',
          )}
          onClick={() => onDirectionChange('long')}
        >
          <div className="flex items-start justify-between mb-2.5">
            <div
              className={cn(
                'font-display text-2xl font-bold tracking-[0.06em] leading-none',
                isLong ? 'text-mint' : 'text-txt-3',
              )}
            >
              LONG
            </div>
            <svg width="52" height="28" viewBox="0 0 52 28" fill="none">
              <polyline
                points="0,24 10,20 20,14 30,10 40,5 52,2"
                stroke={isLong ? '#4de8b4' : 'rgba(234,250,244,0.15)'}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polygon
                points="0,28 0,24 10,20 20,14 30,10 40,5 52,2 52,28"
                fill={isLong ? 'rgba(77,232,180,0.12)' : 'rgba(234,250,244,0.03)'}
              />
            </svg>
          </div>
          <div className="text-[13px] text-txt-3 leading-[1.5] mb-3">
            token moves up when underlying pumps
          </div>
          <div
            className={cn(
              'inline-block text-[11px] tracking-[0.08em] uppercase px-2.5 py-[3px] rounded-md font-semibold',
              isLong ? 'bg-mint/[0.10] text-mint' : 'bg-white/[0.04] text-txt-4',
            )}
          >
            bullish
          </div>
        </button>

        <button
          className={cn(
            'p-5 rounded-xl border cursor-pointer font-mono text-left relative overflow-hidden transition-all duration-200',
            !isLong
              ? 'border-red/40 bg-gradient-to-br from-red/[0.08] to-transparent'
              : 'border-border bg-bg-2/60 hover:border-border-2 hover:bg-bg-3/50',
          )}
          onClick={() => onDirectionChange('short')}
        >
          <div className="flex items-start justify-between mb-2.5">
            <div
              className={cn(
                'font-display text-2xl font-bold tracking-[0.06em] leading-none',
                !isLong ? 'text-red' : 'text-txt-3',
              )}
            >
              SHORT
            </div>
            <svg width="52" height="28" viewBox="0 0 52 28" fill="none">
              <polyline
                points="0,4 10,7 20,12 30,17 40,22 52,26"
                stroke={!isLong ? '#f05050' : 'rgba(234,250,244,0.15)'}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polygon
                points="0,0 0,4 10,7 20,12 30,17 40,22 52,26 52,0"
                fill={!isLong ? 'rgba(240,80,80,0.10)' : 'rgba(234,250,244,0.03)'}
              />
            </svg>
          </div>
          <div className="text-[13px] text-txt-3 leading-[1.5] mb-3">
            token moves up when underlying dumps
          </div>
          <div
            className={cn(
              'inline-block text-[11px] tracking-[0.08em] uppercase px-2.5 py-[3px] rounded-md font-semibold',
              !isLong ? 'bg-red/[0.08] text-red' : 'bg-white/[0.04] text-txt-4',
            )}
          >
            bearish
          </div>
        </button>
      </div>

      {/* Asset grid */}
      <label className="text-[11px] tracking-[0.08em] uppercase text-txt-3 mb-2 block font-medium">
        Underlying asset
      </label>
      <div className="grid grid-cols-3 gap-2">
        {UNDERLYING_ASSETS.map((a) => {
          const data = MOCK_ASSET_DATA[a];
          const up = data.chg >= 0;
          const selected = a === asset;
          return (
            <button
              key={a}
              className={cn(
                'py-2.5 px-3 rounded-lg cursor-pointer border text-center transition-all duration-150 font-mono',
                selected
                  ? isLong
                    ? 'border-mint/40 bg-mint/[0.06] shadow-inner-mint'
                    : 'border-red/40 bg-red/[0.06]'
                  : 'border-border bg-bg-2/50 hover:border-border-2 hover:bg-bg-3/50',
              )}
              onClick={() => onAssetChange(a)}
            >
              <div className="text-sm font-bold text-txt">{a}</div>
              <div className={cn('text-[13px] mt-[2px] tabular-nums', up ? 'text-mint' : 'text-red')}>
                {up ? '+' : ''}
                {data.chg.toFixed(2)}%
              </div>
            </button>
          );
        })}
      </div>

      {/* Leverage */}
      <label className="text-[11px] tracking-[0.08em] uppercase text-txt-3 mt-4 mb-2 block font-medium">
        Leverage
      </label>
      <div className="flex gap-2">
        {LEVERAGE_OPTIONS.map((l) => (
          <button
            key={l}
            className={cn(
              'flex-1 py-2.5 rounded-lg cursor-pointer border font-mono text-[13px] font-semibold text-center transition-all duration-150',
              leverage === l
                ? isLong
                  ? 'border-mint/40 text-mint bg-mint/[0.06] shadow-inner-mint'
                  : 'border-red/40 text-red bg-red/[0.06]'
                : 'border-border text-txt-3 bg-bg-2/50 hover:text-txt hover:border-border-2',
            )}
            onClick={() => onLeverageChange(l)}
          >
            {l}×
          </button>
        ))}
      </div>

      {/* Pair summary card */}
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-3 rounded-xl border mt-4 transition-all',
          isLong ? 'border-mint/20 bg-gradient-to-r from-mint/[0.06] to-transparent' : 'border-red/20 bg-gradient-to-r from-red/[0.06] to-transparent',
        )}
      >
        <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', isLong ? 'bg-mint' : 'bg-red')} />
        <span className="text-sm font-semibold text-txt">
          {ltName(asset, leverage, direction)}
        </span>
        <span className="text-[13px] text-txt-3 ml-auto tabular-nums">
          {chg >= 0 ? '+' : ''}
          {chg.toFixed(1)}% today
        </span>
      </div>

      {/* Hyperliquid badge */}
      <div className="inline-flex items-center gap-2 text-[11px] font-medium text-txt-3 tracking-[0.04em] mt-3 px-3 py-2 border border-border rounded-lg bg-bg-2/30">
        <svg width="16" height="12" viewBox="0 0 36 24" fill="none">
          <path
            d="M14 2 L2 12 L14 22"
            stroke="#4de8b4"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M22 2 L34 12 L22 22"
            stroke="#4de8b4"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        powered by Hyperliquid perps
      </div>
    </div>
  );
}
