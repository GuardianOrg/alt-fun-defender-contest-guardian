import { useEffect, useRef, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type CandlestickData, type LineData, ColorType } from 'lightweight-charts';
import { cn, formatPercent } from '@/utils/format';
import type { Token } from '@/services/types';

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1D'] as const;

function generateCandles(count: number, startPrice: number, changePct: number, vol: number): CandlestickData[] {
  const data: CandlestickData[] = [];
  let v = startPrice;
  const tr = changePct / count;
  const baseTime = Math.floor(Date.now() / 1000) - count * 60;

  for (let i = 0; i < count; i++) {
    const n = (Math.random() - 0.48) * vol;
    v = Math.max(v * (1 + tr / 100 + n / 100), startPrice * 0.2);
    const o = v;
    const c = v * (1 + (Math.random() - 0.5) * 0.008);
    const h = Math.max(o, c) * (1 + Math.random() * 0.005);
    const l = Math.min(o, c) * (1 - Math.random() * 0.005);
    data.push({
      time: (baseTime + i * 60) as unknown as CandlestickData['time'],
      open: o,
      high: h,
      low: l,
      close: c,
    });
  }
  return data;
}

function generateOverlay(count: number, startPrice: number, changePct: number): LineData[] {
  const data: LineData[] = [];
  let v = startPrice;
  const tr = changePct / count;
  const baseTime = Math.floor(Date.now() / 1000) - count * 60;

  for (let i = 0; i < count; i++) {
    const n = (Math.random() - 0.48) * 1.2;
    v = v * (1 + tr / 100 + n / 100);
    data.push({
      time: (baseTime + i * 60) as unknown as LineData['time'],
      value: v,
    });
  }
  return data;
}

interface Props {
  token: Token;
}

export default function Chart({ token }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const [interval, setInterval] = useState<string>('1m');
  const [showOverlay, setShowOverlay] = useState(false);

  const underlyingChg = token.leverageBoost / token.leverage;

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(234,250,244,0.22)',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(77,232,180,0.05)' },
        horzLines: { color: 'rgba(77,232,180,0.05)' },
      },
      crosshair: { vertLine: { color: 'rgba(77,232,180,0.25)' }, horzLine: { color: 'rgba(77,232,180,0.25)' } },
      rightPriceScale: { borderColor: 'rgba(77,232,180,0.10)' },
      timeScale: { borderColor: 'rgba(77,232,180,0.10)' },
    });

    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#4de8b4',
      downColor: '#f05050',
      borderUpColor: '#4de8b4',
      borderDownColor: '#f05050',
      wickUpColor: '#4de8b4',
      wickDownColor: '#f05050',
    });
    candleSeriesRef.current = candleSeries;

    const pts =
      interval === '1m' ? 120 : interval === '5m' ? 96 : interval === '15m' ? 72 : interval === '1h' ? 60 : interval === '4h' ? 48 : 30;
    candleSeries.setData(generateCandles(pts, 0.0001, token.change24h, interval === '1m' ? 3 : 1.8));
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [interval, token.change24h]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (lineSeriesRef.current) {
      chart.removeSeries(lineSeriesRef.current);
      lineSeriesRef.current = null;
    }

    if (showOverlay) {
      const pts =
        interval === '1m' ? 120 : interval === '5m' ? 96 : interval === '15m' ? 72 : interval === '1h' ? 60 : interval === '4h' ? 48 : 30;
      const lineSeries = chart.addLineSeries({
        color: 'rgba(240,180,41,0.5)',
        lineWidth: 1,
        priceScaleId: 'overlay',
      });
      lineSeries.setData(generateOverlay(pts, 14, 8.2));
      lineSeriesRef.current = lineSeries;
    }
  }, [showOverlay, interval]);

  return (
    <>
      {/* Toolbar — intervals + decomp stats + overlay */}
      <div className="flex items-center px-4 h-8 border-b border-border bg-bg-1 shrink-0 gap-1">
        {/* Interval pills */}
        <div className="flex items-center bg-bg-2/60 rounded-md p-0.5 gap-px">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              className={cn(
                'px-2 py-0.5 rounded text-[11px] font-mono font-medium cursor-pointer border-0 transition-all duration-150',
                interval === iv
                  ? 'bg-mint/[0.12] text-mint'
                  : 'bg-transparent text-txt-3 hover:text-txt hover:bg-white/[0.04]',
              )}
              onClick={() => setInterval(iv)}
            >
              {iv}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-border mx-1.5" />

        {/* Overlay toggle */}
        <label className="flex items-center gap-1.5 cursor-pointer group">
          <div
            className={cn(
              'w-6 h-3.5 rounded-full relative transition-all duration-200',
              showOverlay ? 'bg-amber/30' : 'bg-white/[0.08]',
            )}
            onClick={() => setShowOverlay(!showOverlay)}
          >
            <div
              className={cn(
                'absolute top-[3px] w-2 h-2 rounded-full transition-all duration-200',
                showOverlay
                  ? 'left-3 bg-amber'
                  : 'left-[3px] bg-txt-3',
              )}
            />
          </div>
          <span className={cn(
            'text-[11px] font-mono transition-colors',
            showOverlay ? 'text-amber' : 'text-txt-4 group-hover:text-txt-3',
          )}>
            {token.underlying}
          </span>
        </label>

        <div className="w-px h-4 bg-border mx-1.5" />

        {/* Decomp stats — inline, secondary */}
        <div className="flex items-center gap-3 text-[11px] tabular-nums">
          <span className="text-txt-4">
            buys{' '}
            <span className={cn('font-semibold', token.buyMomentum >= 0 ? 'text-mint' : 'text-red')}>
              {formatPercent(token.buyMomentum)}
            </span>
          </span>
          <span className="text-txt-4">
            lev{' '}
            <span className="text-amber font-semibold">{formatPercent(token.leverageBoost)}</span>
            <span className="text-txt-4 ml-0.5">({formatPercent(underlyingChg)}×{token.leverage})</span>
          </span>
        </div>

        {/* Live indicator */}
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-mint animate-livep" />
          <span className="text-[11px] text-txt-4 font-mono">live</span>
        </div>
      </div>
      <div ref={chartContainerRef} className="flex-1 relative overflow-hidden" />
    </>
  );
}
