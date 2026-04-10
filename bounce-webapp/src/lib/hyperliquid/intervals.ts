/**
 * Intervals supported by Hyperliquid `candleSnapshot` and `candle` WebSocket.
 * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
 */
export const hyperliquidCandleIntervals = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
] as const;

export type HyperliquidCandleInterval = (typeof hyperliquidCandleIntervals)[number];

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Bar length in ms for mark alignment; `1M` uses a 30-day approximation. */
export const hyperliquidIntervalDurationMs: Record<
  HyperliquidCandleInterval,
  number
> = {
  "1m": MIN,
  "3m": 3 * MIN,
  "5m": 5 * MIN,
  "15m": 15 * MIN,
  "30m": 30 * MIN,
  "1h": HOUR,
  "2h": 2 * HOUR,
  "4h": 4 * HOUR,
  "8h": 8 * HOUR,
  "12h": 12 * HOUR,
  "1d": DAY,
  "3d": 3 * DAY,
  "1w": 7 * DAY,
  "1M": 30 * DAY,
};
