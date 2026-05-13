/**
 * Fields shared by both `TradeBroadcast` variants.
 *
 * All bigint-valued fields on the variants are serialised as decimal
 * strings at their on-chain scale — 1e6 for `usdcAmount`, 1e18 for
 * `tokenAmount` and the virtual AMM reserves. `timestamp` is a Unix
 * seconds-since-epoch string, NOT a 1e18-scaled value.
 */
interface TradeBroadcastBase {
  id: string;
  tokenAddress: string;
  /** Block timestamp in Unix seconds (decimal string, NOT 1e18-scaled). */
  timestamp: string;
}

/**
 * Trade-list broadcast emitted by `Zap:Buy` / `Zap:Sell`. Carries the
 * gross USDC the user paid/received plus the token amount and trader
 * identity. `id` matches the REST `routerTrade.id`
 * (`${txHash}-${zapLogIndex}`) so live broadcasts dedupe against the REST
 * poll fallback. The trade-feed UI consumes only this variant — presence
 * of `usdcAmount` is the discriminator.
 */
export interface TradeListBroadcast extends TradeBroadcastBase {
  /** Gross USDC paid (Buy) or received (Sell), 1e6-scaled decimal string. */
  usdcAmount: string;
  /** Token amount in/out, 1e18-scaled decimal string. */
  tokenAmount: string;
  trader: string;
  isBuy: boolean;
  /**
   * Display symbol for the token (e.g. `"TST"`), looked up from the
   * indexer's `token` row at broadcast time. Optional because:
   *   - older indexer builds don't emit it (forward-compat),
   *   - the broadcast still goes out if the token row hasn't been indexed
   *     yet (placeholder row from `Factory:PairCreated` before
   *     `Bonding:TokenLaunched` has overwritten the metadata fields).
   * When present, the client uses it directly instead of doing a
   * separate Ponder GraphQL lookup — which closes the race window where
   * a brand-new token's first buy lands in the feed before the
   * GraphQL endpoint has caught up to the indexer's write
   * (issue #703).
   */
  tokenSymbol?: string;
  /**
   * Full token name (e.g. `"Test Token"`), used as a display fallback
   * when `tokenSymbol` is blank. Same optional/forward-compat semantics
   * as `tokenSymbol`.
   */
  tokenName?: string;
  /** Forbidden on this variant — see `ChartStateBroadcast`. */
  curveSupply?: never;
  ltReserve?: never;
}

/**
 * Chart-state broadcast emitted by `Bonding:Trade` (curve phase) and
 * `HyperSwapPair:Sync` (post-grad). Carries post-trade virtual AMM
 * reserves so `useChartData` can recompute `ratio = ltReserve / curveSupply`
 * without a Ponder round-trip. Trade-list fields are forbidden —
 * chart-only broadcasts have nothing to say about who traded or how much
 * USDC moved.
 */
export interface ChartStateBroadcast extends TradeBroadcastBase {
  curveSupply: string;
  ltReserve: string;
  /** Forbidden on this variant — see `TradeListBroadcast`. */
  usdcAmount?: never;
  tokenAmount?: never;
  trader?: never;
  isBuy?: never;
  // Chart-state broadcasts don't carry the token's display label —
  // `useChartData` already knows which token its chart is on. Marking
  // these as forbidden keeps the discriminated union clean and stops
  // the indexer from accidentally double-paying for the lookup on the
  // chart-state path.
  tokenSymbol?: never;
  tokenName?: never;
}

/**
 * WebSocket broadcast payload on the `trade` channel. Discriminated union:
 * producers must construct exactly one variant, consumers narrow on
 * `usdcAmount` presence. Hybrid shapes are rejected at compile time via
 * the `?: never` exclusions on each variant.
 *
 * The split exists because `Bonding:Trade` records the LT actually consumed
 * by the curve (which can be strictly less than what the user paid for —
 * e.g. a graduation-triggering buy that hits the supply cap), while
 * `Zap:Buy` records the gross USDC input. Sourcing the trade-list from
 * `Zap:Buy` keeps it consistent with the REST `/api/v1/trades` route
 * (which reads from `routerTrade`).
 */
export type TradeBroadcast = TradeListBroadcast | ChartStateBroadcast;

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
