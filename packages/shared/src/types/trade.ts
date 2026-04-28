/**
 * WebSocket broadcast payload on the `trade` channel. Two producers emit
 * onto this channel; consumers route by which fields are populated:
 *
 *   1. `Zap:Buy` / `Zap:Sell` — trade-list rows. `id` matches the REST
 *      `routerTrade.id` (`${txHash}-${zapLogIndex}`), `usdcAmount` is the
 *      gross USDC the user paid/received (the canonical user-facing value).
 *      `ltAmount` is `"0"` and `curveSupply` / `ltReserve` are absent —
 *      the chart consumer skips these.
 *   2. `Bonding:Trade` (curve phase) and `HyperSwapPair:Sync` (post-grad) —
 *      chart-state updates. `curveSupply` / `ltReserve` are populated for
 *      the live ratio update, `usdcAmount` is absent — the trade-feed
 *      consumer skips these. The `Bonding:Trade` broadcast also carries
 *      `ltAmount` / `tokenAmount` for legacy reasons; the trade-feed UI
 *      ignores both (sourcing trade-list rows from the Zap broadcast above).
 *
 * The split exists because `Bonding:Trade` records the LT actually consumed
 * by the curve (which can be less than what the user paid for, e.g. a
 * graduation-triggering buy that hits the supply cap), while `Zap:Buy`
 * records the gross USDC input. Sourcing the trade-list from `Zap:Buy`
 * keeps it consistent with the REST `/api/v1/trades` route (which reads
 * from `routerTrade`) so live-broadcast rows dedupe cleanly against the
 * REST poll fallback by `id`.
 *
 * All bigint-valued fields are serialised as decimal strings at their
 * on-chain scale — 1e6 for `usdcAmount`, 1e18 for token/LT amounts and the
 * virtual AMM reserves. `timestamp` is a Unix seconds-since-epoch string,
 * NOT a 1e18-scaled value.
 */
export interface TradeBroadcast {
  id: string;
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  /** LT amount in/out, 1e18-scaled decimal string. `"0"` on Zap-sourced and
   *  Sync-sourced broadcasts (which use `usdcAmount` / chart state instead). */
  ltAmount: string;
  /** Token amount in/out, 1e18-scaled decimal string. */
  tokenAmount: string;
  /**
   * Gross USDC paid/received, 1e6-scaled decimal string. Set by the Zap
   * broadcast variant; absent on chart-only broadcasts. Presence is the
   * trade-feed consumer's signal that this event represents a user-facing
   * trade row (vs a chart-state-only update).
   */
  usdcAmount?: string;
  /** Block timestamp in Unix seconds (decimal string, NOT 1e18-scaled). */
  timestamp: string;
  /**
   * Post-trade bonding curve / DEX state (virtual AMM reserves,
   * 1e18-scaled). Set by the chart-state broadcast variant; absent on
   * Zap-sourced trade-list broadcasts.
   */
  curveSupply?: string;
  ltReserve?: string;
}

/**
 * Client-facing trade as rendered in the feed / trades tab. Derived from
 * the Zap-sourced `TradeBroadcast` (or the equivalent REST `routerTrade`
 * row) by `routerTradeToTrade` in `apps/web/src/services/tradeFormatter.ts`
 * — `usdcAmount` is broadcast directly, so no LT-rate lookup is needed.
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
