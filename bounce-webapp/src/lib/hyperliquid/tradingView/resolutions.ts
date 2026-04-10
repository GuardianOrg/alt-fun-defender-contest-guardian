import {
  hyperliquidCandleIntervals,
  type HyperliquidCandleInterval,
} from "./hyperliquidCandleIntervals";

import type { ResolutionString } from "../../../types/chartingLibrary";

/**
 * Hyperliquid interval ↔ TradingView resolution (minutes as string, or 1D / 3D / 1W / 1M).
 */
const HL_TO_TV: Record<HyperliquidCandleInterval, ResolutionString> = {
  "1m": "1" as ResolutionString,
  "3m": "3" as ResolutionString,
  "5m": "5" as ResolutionString,
  "15m": "15" as ResolutionString,
  "30m": "30" as ResolutionString,
  "1h": "60" as ResolutionString,
  "2h": "120" as ResolutionString,
  "4h": "240" as ResolutionString,
  "8h": "480" as ResolutionString,
  "12h": "720" as ResolutionString,
  "1d": "1D" as ResolutionString,
  "3d": "3D" as ResolutionString,
  "1w": "1W" as ResolutionString,
  "1M": "1M" as ResolutionString,
};

const TV_TO_HL: Partial<Record<string, HyperliquidCandleInterval>> = {};
for (const interval of hyperliquidCandleIntervals) {
  TV_TO_HL[String(HL_TO_TV[interval])] = interval;
}

/**
 * All TradingView resolutions we can serve from Hyperliquid (no client-side resampling).
 * Passed to `onReady` and `LibrarySymbolInfo.supported_resolutions`.
 */
export const HYPERLIQUID_TRADING_VIEW_RESOLUTIONS: ResolutionString[] =
  hyperliquidCandleIntervals.map((i) => HL_TO_TV[i]);

export function tradingViewResolutionToHyperliquidInterval(
  resolution: ResolutionString,
): HyperliquidCandleInterval | null {
  return TV_TO_HL[String(resolution)] ?? null;
}
