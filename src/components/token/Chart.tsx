import { useEffect, useRef, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type CandlestickData, type LineData, ColorType } from 'lightweight-charts';
import { cn, formatPercent } from '@/utils/format';
import type { Token } from '@/services/types';
import styles from './Chart.module.css';

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
      <div className={styles.toolbar}>
        <div className={styles.intervalGroup}>
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              className={cn(
                styles.intervalBtn,
                interval === iv && styles.intervalBtnActive,
              )}
              onClick={() => setInterval(iv)}
            >
              {iv}
            </button>
          ))}
        </div>

        <div className={styles.dividerSmall} />

        <label className={styles.overlayLabel}>
          <div
            className={cn(
              styles.toggleTrack,
              showOverlay && styles.toggleTrackOn,
            )}
            onClick={() => setShowOverlay(!showOverlay)}
          >
            <div
              className={cn(
                styles.toggleDot,
                showOverlay && styles.toggleDotOn,
              )}
            />
          </div>
          <span className={cn(
            styles.overlayText,
            showOverlay && styles.overlayTextOn,
          )}>
            {token.underlying}
          </span>
        </label>

        <div className={styles.dividerSmall} />

        <div className={styles.decompStats}>
          <span className={styles.decompLabel}>
            buys{' '}
            <span className={token.buyMomentum >= 0 ? styles.decompValueMint : styles.decompValueRed}>
              {formatPercent(token.buyMomentum)}
            </span>
          </span>
          <span className={styles.decompLabel}>
            lev{' '}
            <span className={styles.decompAmber}>{formatPercent(token.leverageBoost)}</span>
            <span className={styles.decompDetail}>({formatPercent(underlyingChg)}×{token.leverage})</span>
          </span>
        </div>

        <div className={styles.liveIndicator}>
          <div className={styles.liveDot} />
          <span className={styles.liveText}>live</span>
        </div>
      </div>
      <div ref={chartContainerRef} className={styles.chartArea} />
    </>
  );
}
