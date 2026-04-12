/** Shared type definitions for Ponder GraphQL response shapes. */

/** Shape returned by the `routerTrades` query. Individual queries may only
 *  request a subset of these fields — use `Pick<>` at the call-site when the
 *  full shape is not needed. */
export interface PonderRouterTrade {
  id: string;
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  usdcAmount: string;
  tokenAmount: string;
  blockNumber: string;
  timestamp: string;
}

/** Shape returned by the `graduations` query. */
export interface PonderGraduation {
  tokenAddress: string;
  timestamp: string;
}

/** Shape returned by the `tokens` query. */
export interface PonderToken {
  address: string;
  timestamp: string;
}

/** Shape returned by the `feeClaims` query. */
export interface PonderFeeClaim {
  amount: string;
  isCreator: boolean;
  timestamp: string;
}
