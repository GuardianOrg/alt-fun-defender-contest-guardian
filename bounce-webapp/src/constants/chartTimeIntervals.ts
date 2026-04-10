// If you change this, check whether to update mintPersistConfig key in store.ts
export const chartTimeIntervals = [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
] as const;

export const intervalMsMap: Record<ChartTimeInterval, number> = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

export type ChartTimeInterval = (typeof chartTimeIntervals)[number];
