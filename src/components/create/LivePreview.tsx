import { useEffect, useRef } from 'react';
import { cn } from '@/utils/format';
import { MOCK_ASSET_DATA } from '@/services/mock/assets';
import type { Direction } from '@/services/types';
import type { UnderlyingAsset, Leverage } from '@/config/constants';

interface Props {
  name: string;
  ticker: string;
  direction: Direction;
  asset: UnderlyingAsset;
  leverage: Leverage;
  imagePreview: string | null;
}

export default function LivePreview({
  name,
  ticker,
  direction,
  asset,
  leverage,
  imagePreview,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isLong = direction === 'long';
  const ltName = `${asset} ${leverage}× ${isLong ? 'Long' : 'Short'}`;
  const displayName = ticker
    ? `${(name || 'YOUR TOKEN').toUpperCase()} (${ticker.toUpperCase()})`
    : (name || 'your token').toUpperCase();
  const data = MOCK_ASSET_DATA[asset];
  const assetChg = data.chg;
  const isUp = assetChg >= 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const color = isUp ? '#4de8b4' : '#f05050';
    const pts = Array.from({ length: 60 }, (_, i) => {
      const noise = (Math.random() - 0.48) * 1.8;
      const trend = (assetChg / 100) * (i / 60) * 0.8;
      return noise + trend;
    });
    let v = 0;
    const lineData = pts.map((p) => {
      v += p;
      return v;
    });
    const mn = Math.min(...lineData);
    const mx = Math.max(...lineData);
    const norm = lineData.map((p) => ((p - mn) / (mx - mn || 1)) * 26 + 3);

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, isUp ? 'rgba(77,232,180,0.18)' : 'rgba(240,80,80,0.14)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.beginPath();
    ctx.moveTo(1, 32);
    norm.forEach((y, i) => ctx.lineTo((i / (norm.length - 1)) * (W - 2) + 1, 32 - y));
    ctx.lineTo(W - 1, 32);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    norm.forEach((y, i) =>
      i === 0 ? ctx.moveTo(1, 32 - y) : ctx.lineTo((i / (norm.length - 1)) * (W - 2) + 1, 32 - y),
    );
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }, [asset, isUp, assetChg]);

  return (
    <div className="bg-gradient-to-b from-bg-1 to-bg border-l border-border overflow-y-auto">
      <div className="px-6 py-7">
        <div className="text-[11px] tracking-[0.14em] uppercase text-txt-3 mb-5 font-medium flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-mint animate-livep" />
          live preview
        </div>

        {/* Token card */}
        <div
          className={cn(
            'border rounded-xl overflow-hidden mb-5 transition-all duration-300',
            isLong
              ? 'border-mint/20 bg-gradient-to-br from-mint/[0.04] to-bg-2'
              : 'border-red/20 bg-gradient-to-br from-red/[0.04] to-bg-2',
          )}
        >
          <div className="flex items-center gap-3 p-4">
            <div className="w-12 h-12 rounded-xl bg-bg-3 border border-border flex items-center justify-center text-2xl shrink-0 overflow-hidden shadow-panel">
              {imagePreview ? (
                <img src={imagePreview} className="w-full h-full object-cover" alt="" />
              ) : (
                <span className="opacity-40">?</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="font-display text-lg font-bold text-txt tracking-[0.03em] truncate">
                {displayName}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={cn(
                    'text-[11px] font-semibold px-2 py-[2px] rounded-md border',
                    isLong
                      ? 'text-mint/80 bg-mint/[0.06] border-mint/15'
                      : 'text-red/80 bg-red/[0.06] border-red/15',
                  )}
                >
                  ⚡ {ltName}
                </span>
              </div>
            </div>
          </div>

          {/* Mini stats */}
          <div className="grid grid-cols-3 border-t border-border/50">
            <div className="px-3 py-2.5 text-center border-r border-border/50">
              <div className="text-sm font-bold text-txt tabular-nums">{leverage}×</div>
              <div className="text-[11px] text-txt-4 mt-0.5">leverage</div>
            </div>
            <div className="px-3 py-2.5 text-center border-r border-border/50">
              <div className="text-sm font-bold text-txt">{asset}</div>
              <div className="text-[11px] text-txt-4 mt-0.5">underlying</div>
            </div>
            <div className="px-3 py-2.5 text-center">
              <div className={cn('text-sm font-bold', isLong ? 'text-mint' : 'text-red')}>
                {isLong ? 'LONG' : 'SHORT'}
              </div>
              <div className="text-[11px] text-txt-4 mt-0.5">direction</div>
            </div>
          </div>
        </div>

        {/* Chart card */}
        <div className="border border-border rounded-xl overflow-hidden bg-bg-2/60">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-txt">{asset} / USD</div>
              <div className="text-[11px] text-txt-3 mt-0.5">your token moves {leverage}× this</div>
            </div>
            <div
              className={cn(
                'text-sm font-bold tabular-nums px-2 py-1 rounded-md',
                isUp ? 'text-mint bg-mint/[0.06]' : 'text-red bg-red/[0.06]',
              )}
            >
              {isUp ? '+' : ''}
              {assetChg.toFixed(2)}%
            </div>
          </div>
          <div className="p-3">
            <canvas ref={canvasRef} width={328} height={120} className="w-full" />
          </div>
        </div>

        {/* Info box */}
        <div
          className={cn(
            'border rounded-xl px-4 py-3 mt-4 text-[13px] text-txt-3 leading-[1.6]',
            isLong ? 'bg-mint/[0.03] border-mint/10' : 'bg-red/[0.03] border-red/10',
          )}
        >
          <b className={cn('font-semibold', isLong ? 'text-mint' : 'text-red')}>
            {ltName}
          </b>{' '}
          — if {asset} {isLong ? 'rises' : 'falls'} 10%, your token moves{' '}
          {isLong ? 'up' : 'down'} ~{leverage * 10}% with zero buys.
        </div>

        {/* How it works */}
        <div className="mt-5 space-y-2">
          <div className="text-[11px] tracking-[0.08em] uppercase text-txt-3 font-medium mb-2">how it works</div>
          {[
            { icon: '1', text: 'Token deploys to bonding curve' },
            { icon: '2', text: 'Users buy/sell with USDC atomically' },
            { icon: '3', text: 'At $69K MCAP, token graduates to DEX' },
          ].map((step) => (
            <div key={step.icon} className="flex items-center gap-3 text-[13px] text-txt-2">
              <div className="w-5 h-5 rounded-full bg-bg-3 border border-border flex items-center justify-center text-[11px] text-txt-3 font-semibold shrink-0">
                {step.icon}
              </div>
              {step.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
