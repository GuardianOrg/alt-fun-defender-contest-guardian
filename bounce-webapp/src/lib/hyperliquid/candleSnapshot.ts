import type { HyperliquidCandleInterval } from "./intervals";

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";

export type RawHyperliquidCandle = {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
};

export type FetchHyperliquidCandlesParams = {
  coin: string;
  interval: HyperliquidCandleInterval;
  startTimeMs: number;
  endTimeMs: number;
};

/**
 * POST `candleSnapshot` to Hyperliquid `info`. Consumed by the TradingView datafeed and
 * `useHyperliquidLineChart` (position mini charts).
 */
export async function fetchHyperliquidCandleSnapshot(
  params: FetchHyperliquidCandlesParams,
  fetchImpl: typeof fetch = fetch,
): Promise<RawHyperliquidCandle[]> {
  const res = await fetchImpl(HL_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: {
        coin: params.coin,
        interval: params.interval,
        startTime: params.startTimeMs,
        endTime: params.endTimeMs,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Hyperliquid candleSnapshot failed: ${res.status} ${res.statusText}`,
    );
  }

  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Hyperliquid candleSnapshot: response is not an array");
  }

  return data as RawHyperliquidCandle[];
}
