/**
 * WebSocket broadcast payload on the `trade` channel. Two disjoint variants
 * share this channel; consumers route by which optional group is populated:
 *
 *   1. **Trade-list variant** (`Zap:Buy` / `Zap:Sell`). Carries the gross
 *      USDC the user paid/received plus the token amount and trader
 *      identity. `id` matches the REST `routerTrade.id`
 *      (`${txHash}-${zapLogIndex}`) so live broadcasts dedupe against the
 *      REST poll fallback. The trade-feed UI consumes only this variant —
 *      presence of `usdcAmount` is the discriminator.
 *   2. **Chart-state variant** (`Bonding:Trade` curve phase,
 *      `HyperSwapPair:Sync` post-grad). Carries post-trade virtual AMM
 *      reserves so `useChartData` can recompute
 *      `ratio = ltReserve / curveSupply` without a Ponder round-trip.
 *      Trade-list fields are absent — chart-only broadcasts have nothing
 *      to say about who traded or how much USDC moved.
 *
 * The split exists because `Bonding:Trade` records the LT actually consumed
 * by the curve (which can be strictly less than what the user paid for —
 * e.g. a graduation-triggering buy that hits the supply cap), while
 * `Zap:Buy` records the gross USDC input. Sourcing the trade-list from
 * `Zap:Buy` keeps it consistent with the REST `/api/v1/trades` route
 * (which reads from `routerTrade`).
 *
 * All bigint-valued fields are serialised as decimal strings at their
 * on-chain scale — 1e6 for `usdcAmount`, 1e18 for `tokenAmount` and the
 * virtual AMM reserves. `timestamp` is a Unix seconds-since-epoch string,
 * NOT a 1e18-scaled value.
 */
export interface TradeBroadcast {
  id: string;
  tokenAddress: string;
  /** Block timestamp in Unix seconds (decimal string, NOT 1e18-scaled). */
  timestamp: string;

  // ─── Trade-list variant (Zap:Buy / Zap:Sell) ─────────────────────────
  // All four fields are set together. Presence of `usdcAmount` is the
  // canonical discriminator used by the trade-feed consumer.

  /** Gross USDC paid (Buy) or received (Sell), 1e6-scaled decimal string. */
  usdcAmount?: string;
  /** Token amount in/out, 1e18-scaled decimal string. */
  tokenAmount?: string;
  trader?: string;
  isBuy?: boolean;

  // ─── Chart-state variant (Bonding:Trade / HyperSwapPair:Sync) ────────
  // Both fields are set together. Drives the live chart ratio update.

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
}
