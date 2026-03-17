import { useEffect, useRef, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type CandlestickData, type LineData, ColorType } from 'lightweight-charts';
import { cn } from '@/utils/format';
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

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(234,250,244,0.22)',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 9,
      },
      grid: {
        vertLines: { color: 'rgba(77,232,180,0.06)' },
        horzLines: { color: 'rgba(77,232,180,0.06)' },
      },
      crosshair: { vertLine: { color: 'rgba(77,232,180,0.3)' }, horzLine: { color: 'rgba(77,232,180,0.3)' } },
      rightPriceScale: { borderColor: 'rgba(77,232,180,0.13)' },
      timeScale: { borderColor: 'rgba(77,232,180,0.13)' },
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
      <div className="flex items-center px-3 h-8 border-b border-border bg-bg-1 shrink-0">
        {INTERVALS.map((iv) => (
          <div
            key={iv}
            className={cn(
              'text-[12px] text-txt-3 px-2.5 h-full flex items-center cursor-pointer border-r border-border transition-colors',
              'first:border-l first:border-l-border',
              'hover:text-txt',
              interval === iv && 'text-mint font-semibold',
            )}
            onClick={() => setInterval(iv)}
          >
            {iv}
          </div>
        ))}
        <div className="w-px bg-border h-4 mx-2" />
        <label className="text-[12px] text-txt-3 px-2.5 h-full flex items-center gap-[5px] cursor-pointer hover:text-txt-2">
          <input
            type="checkbox"
            checked={showOverlay}
            onChange={(e) => setShowOverlay(e.target.checked)}
            className="accent-mint"
          />
          {token.underlying} overlay
        </label>
      </div>
      <div ref={chartContainerRef} className="flex-1 relative overflow-hidden" />
    </>
  );
}
