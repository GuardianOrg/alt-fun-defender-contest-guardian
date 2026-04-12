import { useEffect, useState } from "react";

import { fetchOhlcv } from "../services/api";

import type { CandlestickData, LineData } from "lightweight-charts";

function generateCandles(
  count: number,
  startPrice: number,
  changePct: number,
  vol: number,
): CandlestickData[] {
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
      time: (baseTime + i * 60) as unknown as CandlestickData["time"],
      open: o,
      high: h,
      low: l,
      close: c,
    });
  }
  return data;
}

function generateOverlay(
  count: number,
  startPrice: number,
  changePct: number,
): LineData[] {
  const data: LineData[] = [];
  let v = startPrice;
  const tr = changePct / count;
  const baseTime = Math.floor(Date.now() / 1000) - count * 60;

  for (let i = 0; i < count; i++) {
    const n = (Math.random() - 0.48) * 1.2;
    v = v * (1 + tr / 100 + n / 100);
    data.push({
      time: (baseTime + i * 60) as unknown as LineData["time"],
      value: v,
    });
  }
  return data;
}

function getPointCount(interval: string): number {
  return interval === "1m"
    ? 120
    : interval === "5m"
      ? 96
      : interval === "15m"
        ? 72
        : interval === "1h"
          ? 60
          : 48;
}

async function fetchChartCandles(
  address: string,
  interval: string,
): Promise<CandlestickData[]> {
  try {
    const candles = await fetchOhlcv(address, interval);
    if (candles.length === 0) return [];
    return candles.map((c) => ({
      time: c.time as unknown as CandlestickData["time"],
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
  } catch {
    return [];
  }
}

interface UseChartDataResult {
  candles: CandlestickData[];
  overlayData: LineData[];
  loading: boolean;
}

export function useChartData(
  address: string,
  interval: string,
  change24h: number,
  showOverlay: boolean,
): UseChartDataResult {
  const [candles, setCandles] = useState<CandlestickData[]>([]);
  const [overlayData, setOverlayData] = useState<LineData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchChartCandles(address, interval).then((apiCandles) => {
      if (cancelled) return;
      if (apiCandles.length > 0) {
        setCandles(apiCandles);
      } else {
        const pts = getPointCount(interval);
        setCandles(
          generateCandles(pts, 0.0001, change24h, interval === "1m" ? 3 : 1.8),
        );
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [address, interval, change24h]);

  useEffect(() => {
    if (showOverlay) {
      const pts = getPointCount(interval);
      setOverlayData(generateOverlay(pts, 14, 8.2));
    } else {
      setOverlayData([]);
    }
  }, [showOverlay, interval]);

  return { candles, overlayData, loading };
}
