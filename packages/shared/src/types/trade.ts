/**
 * WebSocket broadcast payload emitted by the indexer on every
 * `Bonding:Trade` event (see `apps/indexer/src/bonding.ts`). The same shape
 * is returned by the Ponder GraphQL `trades` query consumed as a polling
 * fallback in `apps/web/src/services/ponder.ts`, so the frontend uses a
 * single type for both transports.
 *
 * All numeric fields are 1e18-scaled bigint strings matching the on-chain
 * representation.
 */
export interface TradeBroadcast {
  id: string;
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  ltAmount: string;
  tokenAmount: string;
  timestamp: string;
  /**
   * Post-trade bonding curve state. Always included on WS broadcasts and
   * Ponder REST responses; optional so consumers that don't persist the
   * reserves (e.g. legacy fixtures) still satisfy the type.
   */
  curveSupply?: string;
  ltReserve?: string;
}

/**
 * Client-facing trade as rendered in the feed / trades tab. Derived from
 * `TradeBroadcast` by `ponderTradeToTrade` in `apps/web/src/services/
 * tradeFormatter.ts` — the USD amount is computed from `ltAmount` using the
 * live LT exchange rate, which is why it lives on the client rather than
 * being broadcast directly.
 */
export interface Trade {
  id: string;
  side: "BUY" | "SELL";
  amountUsd: number;
  tokensAmount: string;
  walletAddress: string;
  timestamp: string;
  tokenAddress: string;
  tokenName: string;
  /**
   * Post-trade bonding curve state. Present on trades sourced from the WS
   * `trade` channel (indexer broadcast), absent on trades sourced from the
   * Ponder REST polling fallback. Used by `useChartData` to recompute the
   * curve ratio live for the chart — formatted as 1e18-scaled bigint strings
   * matching the on-chain representation.
   */
  curveSupply?: string;
  ltReserve?: string;
}
