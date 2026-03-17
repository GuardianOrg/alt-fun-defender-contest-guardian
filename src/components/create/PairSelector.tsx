import { cn } from '@/utils/format';
import { UNDERLYING_ASSETS, LEVERAGE_OPTIONS } from '@/config/constants';
import { MOCK_ASSET_DATA } from '@/services/mock/assets';
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
    <div className="mb-7">
      <div className="text-[11px] tracking-[0.14em] uppercase text-mint mb-1">step 1</div>
      <div className="font-display text-xl font-semibold text-txt tracking-[0.03em] mb-1">
        Choose your pair
      </div>
      <div className="text-[13px] text-txt-3 mb-4">Pick a direction and underlying asset.</div>

      {/* Direction tabs */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          className={cn(
            'p-4 rounded border cursor-pointer font-mono text-left relative overflow-hidden transition-all',
            isLong
              ? 'border-mint bg-gradient-to-br from-mint/10 to-mint/[0.03]'
              : 'border-border bg-bg-2 hover:border-border-2 hover:bg-bg-3',
          )}
          onClick={() => onDirectionChange('long')}
        >
          <div className="flex items-start justify-between mb-2">
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
                stroke="#4de8b4"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polygon
                points="0,28 0,24 10,20 20,14 30,10 40,5 52,2 52,28"
                fill="rgba(77,232,180,0.12)"
              />
            </svg>
          </div>
          <div className="text-[12px] text-txt-3 leading-[1.5] mb-2.5">
            token moves up when underlying pumps
          </div>
          <div
            className={cn(
              'inline-block text-[11px] tracking-[0.08em] uppercase px-2 py-[2px] rounded-sm',
              isLong ? 'bg-mint/[0.12] text-mint' : 'bg-white/[0.05] text-txt-4',
            )}
          >
            bullish
          </div>
        </button>

        <button
          className={cn(
            'p-4 rounded border cursor-pointer font-mono text-left relative overflow-hidden transition-all',
            !isLong
              ? 'border-red bg-gradient-to-br from-red/10 to-red/[0.03]'
              : 'border-border bg-bg-2 hover:border-border-2 hover:bg-bg-3',
          )}
          onClick={() => onDirectionChange('short')}
        >
          <div className="flex items-start justify-between mb-2">
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
                stroke="#f05050"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polygon
                points="0,0 0,4 10,7 20,12 30,17 40,22 52,26 52,0"
                fill="rgba(240,80,80,0.1)"
              />
            </svg>
          </div>
          <div className="text-[12px] text-txt-3 leading-[1.5] mb-2.5">
            token moves up when underlying dumps
          </div>
          <div
            className={cn(
              'inline-block text-[11px] tracking-[0.08em] uppercase px-2 py-[2px] rounded-sm',
              !isLong ? 'bg-red/10 text-red' : 'bg-white/[0.05] text-txt-4',
            )}
          >
            bearish
          </div>
        </button>
      </div>

      {/* Asset grid */}
      <label className="text-[12px] tracking-[0.06em] uppercase text-txt-3 mb-1.5 block">
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
                'py-2.5 px-2 rounded-[3px] cursor-pointer border text-center transition-all font-mono',
                selected
                  ? isLong
                    ? 'border-mint bg-mint-bg'
                    : 'border-red bg-red-bg'
                  : 'border-border bg-bg-2 hover:border-border-2',
              )}
              onClick={() => onAssetChange(a)}
            >
              <div className="text-sm font-bold text-txt">{a}</div>
              <div className={cn('text-[12px] mt-[2px]', up ? 'text-mint' : 'text-red')}>
                {up ? '+' : ''}
                {data.chg.toFixed(2)}%
              </div>
            </button>
          );
        })}
      </div>

      {/* Leverage */}
      <label className="text-[12px] tracking-[0.06em] uppercase text-txt-3 mt-3.5 mb-2 block">
        Leverage
      </label>
      <div className="flex gap-2">
        {LEVERAGE_OPTIONS.map((l) => (
          <button
            key={l}
            className={cn(
              'flex-1 py-2 rounded-[3px] cursor-pointer border font-mono text-[13px] font-semibold text-center transition-all',
              leverage === l
                ? isLong
                  ? 'border-mint text-mint bg-mint-bg'
                  : 'border-red text-red bg-red-bg'
                : 'border-border text-txt-3 bg-bg-2 hover:text-txt hover:border-border-2',
            )}
            onClick={() => onLeverageChange(l)}
          >
            {l}×
          </button>
        ))}
      </div>

      {/* Pair summary */}
      <div
        className={cn(
          'flex items-center gap-2.5 px-3 py-2.5 rounded-[3px] border mt-3',
          isLong ? 'border-border-2 bg-mint-bg' : 'border-red/30 bg-red-bg',
        )}
      >
        <div className={cn('w-2 h-2 rounded-full shrink-0', isLong ? 'bg-mint' : 'bg-red')} />
        <span className="text-[13px] font-semibold text-txt">
          {ltName(asset, leverage, direction)}
        </span>
        <span className="text-[12px] text-txt-3 ml-auto">
          {chg >= 0 ? '+' : ''}
          {chg.toFixed(1)}% today
        </span>
      </div>

      {/* Hyperliquid badge */}
      <div className="inline-flex items-center gap-2 text-[13px] font-medium text-txt-2 tracking-[0.04em] mt-3 px-3.5 py-2 border border-border-2 rounded-[3px] bg-mint/[0.06]">
        <svg width="18" height="14" viewBox="0 0 36 24" fill="none">
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
