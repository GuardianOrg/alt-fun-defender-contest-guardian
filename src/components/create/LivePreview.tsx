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
    norm.forEach((y, i) => ctx.lineTo((i / (norm.length - 1)) * 106 + 1, 32 - y));
    ctx.lineTo(107, 32);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    norm.forEach((y, i) =>
      i === 0 ? ctx.moveTo(1, 32 - y) : ctx.lineTo((i / (norm.length - 1)) * 106 + 1, 32 - y),
    );
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }, [asset, isUp, assetChg]);

  return (
    <div className="px-6 py-7 bg-bg-1 overflow-y-auto">
      <div className="text-[11px] tracking-[0.14em] uppercase text-txt-3 mb-4 font-medium">preview</div>

      {/* Token card */}
      <div className="border border-border-2 rounded-[10px] overflow-hidden bg-bg-2 mb-5">
        <div className="flex items-center gap-2.5 p-3.5">
          <div className="w-10 h-10 rounded-lg bg-bg-3 border border-border flex items-center justify-center text-[22px] shrink-0 overflow-hidden">
            {imagePreview ? (
              <img src={imagePreview} className="w-full h-full object-cover" alt="" />
            ) : (
              '?'
            )}
          </div>
          <div>
            <div className="font-display text-[17px] font-semibold text-txt tracking-[0.03em]">
              {displayName}
            </div>
            <div className="text-[13px] text-txt-3 mt-[2px]">
              <span className={isLong ? 'text-mint' : 'text-red'}>{ltName}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chart card */}
      <div className="border border-border rounded-md overflow-hidden bg-bg-2">
        <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold text-txt">{asset} / USD</div>
            <div className="text-[11px] text-txt-3">your token moves {leverage}× this</div>
          </div>
          <div
            className={cn('text-[13px] font-semibold tabular-nums', isUp ? 'text-mint' : 'text-red')}
          >
            {isUp ? '+' : ''}
            {assetChg.toFixed(2)}%
          </div>
        </div>
        <div className="p-2">
          <canvas ref={canvasRef} width={308} height={120} />
        </div>
      </div>

      {/* Info box */}
      <div
        className={cn(
          'border rounded-[3px] px-3 py-2.5 mt-3.5 text-[13px] text-txt-3 leading-[1.6]',
          isLong ? 'bg-mint-bg border-border' : 'bg-red-bg border-red/20',
        )}
      >
        <b className={isLong ? 'text-mint font-semibold' : 'text-red font-semibold'}>
          {ltName}
        </b>{' '}
        — if {asset} {isLong ? 'rises' : 'falls'} 10%, your token moves{' '}
        {isLong ? 'up' : 'down'} ~{leverage * 10}% with zero buys.
      </div>
    </div>
  );
}
