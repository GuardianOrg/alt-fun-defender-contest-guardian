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

/**
 * REST `/api/v1/trades*` response shape. Same as `PonderRouterTrade`
 * plus the resolved token display labels — populated by the API by
 * batching a single Ponder `tokens(address_in: …)` lookup after the
 * `routerTrades` query, so the web client doesn't have to do a second
 * GraphQL round-trip per trade (and so the first buy for a brand-new
 * token doesn't fall back to a truncated-address placeholder while the
 * client-side `prefetchTokenName` races the indexer's checkpoint —
 * issue #703).
 *
 * Both labels are optional: the indexer briefly carries empty strings
 * via the `Factory:PairCreated` placeholder row before
 * `Bonding:TokenLaunched` overwrites them, and we strip blank labels in
 * `tokenLabelOrUndefined` so the client doesn't cache a blank as
 * "resolved".
 */
export interface ApiTradeWithLabels extends PonderRouterTrade {
  tokenSymbol?: string;
  tokenName?: string;
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

/** Shape returned by the `feeClaims` query. USDC-denominated (6dp). */
export interface PonderFeeClaim {
  amount: string;
  isCreator: boolean;
  timestamp: string;
}

/** Shape returned by the `feeAccruals` query. USDC-denominated (6dp). */
export interface PonderFeeAccrual {
  id: string;
  tokenAddress: string;
  creator: string;
  creatorAmount: string;
  protocolAmount: string;
  isBuy: boolean;
  blockNumber: string;
  timestamp: string;
}
