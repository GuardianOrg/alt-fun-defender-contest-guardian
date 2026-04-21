/**
 * WebSocket broadcast payload emitted by the indexer on every
 * `Bonding:Trade` event (see `apps/indexer/src/bonding.ts`). The same shape
 * is returned by the Ponder GraphQL `trades` query consumed as a polling
 * fallback in `apps/web/src/services/ponder.ts`, so the frontend uses a
 * single type for both transports.
 *
 * All bigint-valued fields (`ltAmount`, `tokenAmount`, `curveSupply`,
 * `ltReserve`) are serialised as decimal strings at their on-chain scale —
 * 1e18 for token/LT amounts and the virtual AMM reserves. `timestamp` is a
 * Unix seconds-since-epoch string (from `event.block.timestamp`), NOT a
 * 1e18-scaled value. `id` is the `${txHash}-${logIndex}` trade identifier.
 */
export interface TradeBroadcast {
  id: string;
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  /** LT amount in/out, 1e18-scaled decimal string. */
  ltAmount: string;
  /** Token amount in/out, 1e18-scaled decimal string. */
  tokenAmount: string;
  /** Block timestamp in Unix seconds (decimal string, NOT 1e18-scaled). */
  timestamp: string;
  /**
   * Post-trade bonding curve state (virtual AMM reserves, 1e18-scaled).
   * Always included on WS broadcasts and Ponder GraphQL `trades` responses;
   * optional so consumers that don't persist the reserves (e.g. legacy
   * fixtures) still satisfy the type.
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
  /** ISO-8601 timestamp (converted client-side from the broadcast's Unix
   *  seconds string). */
  timestamp: string;
  tokenAddress: string;
  tokenName: string;
  /**
   * Post-trade bonding curve state (virtual AMM reserves, 1e18-scaled decimal
   * strings). Populated from both the WS `trade` channel (indexer broadcast)
   * and the Ponder GraphQL polling fallback — optional only so legacy
   * fixtures / consumers that don't persist the reserves still satisfy the
   * type. Used by `useChartData` to recompute the curve ratio live for the
   * chart.
   */
  curveSupply?: string;
  ltReserve?: string;
}
