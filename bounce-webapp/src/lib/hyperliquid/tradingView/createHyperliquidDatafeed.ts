/**
 * TradingView Charting Library datafeed backed by Hyperliquid `candleSnapshot` REST + `candle` WebSocket.
 *
 * Flow:
 * 1. The widget calls `onReady` → we advertise all Hyperliquid-backed TradingView resolutions.
 * 2. `resolveSymbol` → static `LibrarySymbolInfo` for the Hyperliquid `coin` ticker (UTC, 24×7 session).
 * 3. `getBars` → maps TV `periodParams.from`/`to` (**Unix seconds**) to ms and POSTs `candleSnapshot`.
 *    Bars use **UTC ms** `time` (option A in docs/mint-advanced-chart-architecture.md).
 * 4. `getMarks` → user trades for the active coin from `marksContext` (mint/redeem markers + token symbol).
 * 5. `subscribeBars` / `unsubscribeBars` → {@link HyperliquidCandleStreamHub} opens Hyperliquid’s `candle`
 *    WebSocket subscription and forwards updates into TV’s realtime callback (same wire shape as REST).
 *
 * Used by the mint page `AdvancedChart` component.
 */

import { fetchHyperliquidCandleSnapshot } from "../candleSnapshot";
import { HyperliquidCandleStreamHub } from "./candleStreamHub";
import { hyperliquidIntervalDurationMs } from "./hyperliquidCandleIntervals";
import {
  rawHyperliquidCandleToTradingViewBar,
  sortAndMergeBarsByTime,
} from "./rawCandleToTradingViewBar";
import {
  HYPERLIQUID_TRADING_VIEW_RESOLUTIONS,
  tradingViewResolutionToHyperliquidInterval,
} from "./resolutions";
import { buildDatafeedMarksFromTrades } from "./tradeMarksForDatafeed";

import type { IBasicDataFeed } from "../../../../public/charting_library/charting_library";
import type {
  Bar,
  DatafeedConfiguration,
  LibrarySymbolInfo,
  Mark,
  ResolutionString,
} from "../../../../public/charting_library/datafeed-api";
import type { Trade } from "../../../hooks/Indexer/useTrades";

export type TradeMarksContext = {
  getTrades: () => Trade[] | undefined;
};

export type HyperliquidDatafeedOptions = {
  fetchImpl?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
  /** Fired on each live candle tick (e.g. update mint header price). */
  onRealtimeBar?: (bar: Bar) => void;
  /** Mint user trades for {@link IDatafeedChartApi.getMarks}; `getTrades` should read a live ref. */
  marksContext?: TradeMarksContext;
};

const EXCHANGE = "Hyperliquid";

function buildLibrarySymbolInfo(coin: string): LibrarySymbolInfo {
  return {
    name: coin,
    ticker: coin,
    description: `${coin} · ${EXCHANGE}`,
    type: "crypto",
    session: "24x7",
    session_display: "24x7",
    timezone: "Etc/UTC",
    exchange: EXCHANGE,
    listed_exchange: EXCHANGE,
    format: "price",
    pricescale: 100_000_000,
    minmov: 1,
    has_intraday: true,
    has_daily: true,
    has_weekly_and_monthly: true,
    daily_multipliers: ["1"],
    visible_plots_set: "ohlc",
    supported_resolutions: [...HYPERLIQUID_TRADING_VIEW_RESOLUTIONS],
    data_status: "streaming",
  };
}

function onReadyConfiguration(): DatafeedConfiguration {
  return {
    supported_resolutions: [...HYPERLIQUID_TRADING_VIEW_RESOLUTIONS],
    exchanges: [
      { value: EXCHANGE, name: EXCHANGE, desc: `${EXCHANGE} perpetuals` },
    ],
    symbols_types: [{ name: "Crypto", value: "crypto" }],
    supports_marks: true,
  };
}

export type HyperliquidDatafeedHandle = {
  datafeed: IBasicDataFeed;
  /** Call when unmounting the widget so the WebSocket and visibility listener are released. */
  dispose: () => void;
};

export function createHyperliquidDatafeed(
  options?: HyperliquidDatafeedOptions,
): HyperliquidDatafeedHandle {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const WebSocketImpl = options?.WebSocketImpl ?? WebSocket;
  const onRealtimeBar = options?.onRealtimeBar;
  const marksContext = options?.marksContext;
  const hub = new HyperliquidCandleStreamHub({ WebSocketImpl });

  const datafeed: IBasicDataFeed = {
    onReady: (callback) => {
      callback(onReadyConfiguration());
    },

    searchSymbols: (_userInput, _exchange, _symbolType, onResult) => {
      onResult([]);
    },

    resolveSymbol: (symbolName, onResolve, onError) => {
      const name = symbolName.trim();
      if (!name) {
        onError("Empty symbol");
        return;
      }
      onResolve(buildLibrarySymbolInfo(name));
    },

    getBars: (symbolInfo, resolution, periodParams, onResult, onError) => {
      const interval = tradingViewResolutionToHyperliquidInterval(
        resolution as ResolutionString,
      );
      if (!interval) {
        onError(`Unsupported resolution: ${String(resolution)}`);
        return;
      }

      const coin = symbolInfo.ticker ?? symbolInfo.name;
      const startTimeMs = periodParams.from * 1000;
      const endTimeMs = periodParams.to * 1000;

      void (async () => {
        try {
          const raw = await fetchHyperliquidCandleSnapshot(
            { coin, interval, startTimeMs, endTimeMs },
            fetchImpl,
          );

          const bars = sortAndMergeBarsByTime(
            raw.map(rawHyperliquidCandleToTradingViewBar),
          );

          if (bars.length === 0) {
            onResult([], { noData: true });
            return;
          }

          onResult(bars);
        } catch (err) {
          onError(err instanceof Error ? err.message : String(err));
        }
      })();
    },

    getMarks: (symbolInfo, from, to, onDataCallback, resolution) => {
      setTimeout(() => {
        const interval = tradingViewResolutionToHyperliquidInterval(
          resolution as ResolutionString,
        );
        if (!interval || !marksContext) {
          onDataCallback([]);
          return;
        }

        const coin = symbolInfo.ticker ?? symbolInfo.name;
        const trades = marksContext.getTrades() ?? [];
        const intervalMs = hyperliquidIntervalDurationMs[interval];
        const fromSec = Math.min(from, to);
        const toSec = Math.max(from, to);

        const marks: Mark[] = buildDatafeedMarksFromTrades({
          trades,
          coin,
          fromSec,
          toSec,
          intervalMs,
        });

        onDataCallback(marks);
      }, 0);
    },

    subscribeBars: (
      symbolInfo,
      resolution,
      onTick,
      listenerGuid,
      onResetCacheNeededCallback,
    ) => {
      const interval = tradingViewResolutionToHyperliquidInterval(
        resolution as ResolutionString,
      );
      if (!interval) return;

      const coin = symbolInfo.ticker ?? symbolInfo.name;
      hub.addListener(listenerGuid, coin, interval, {
        onTick: (bar) => {
          if (onRealtimeBar) {
            try {
              onRealtimeBar(bar);
            } catch (err) {
              console.error("onRealtimeBar callback threw an error:", err);
            }
          }
          onTick(bar);
        },
        onResetCacheNeededCallback,
      });
    },

    unsubscribeBars: (listenerGuid) => {
      hub.removeListener(listenerGuid);
    },
  };

  return {
    datafeed,
    dispose: () => hub.dispose(),
  };
}
