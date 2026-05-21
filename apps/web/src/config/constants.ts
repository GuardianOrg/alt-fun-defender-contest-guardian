export const FEES = {
  /**
   * 0.75% on every buy — split 0.5% protocol / 0.25% creator. Charged at
   * the `Zap` layer in USDC, accrued into `FeeVault`. Applies on both the
   * bonding curve and post-graduation HyperSwap paths. See also
   * `apps/web/src/services/tradeRouter.ts`.
   */
  curveBuy: 0.0075,
  /**
   * 0.75% on every sell — split 0.5% protocol / 0.25% creator. Same router
   * layer, same USDC vault as `curveBuy` — the "curve" prefix is retained
   * for UI continuity but the fee now covers post-grad trades too.
   */
  curveSell: 0.0075,
  /**
   * 0.3% on notional (USD × leverage) — BounceTech LT redemption fee
   * applied on sells only, 100% to BounceTech protocol (not ours).
   * Independent of our router-level fee.
   */
  ltRedemption: 0.003,
  /** Protocol share of the 0.75% fee (0.5% of trade notional). */
  protocolSplit: 0.005,
  /** Creator share of the 0.75% fee (0.25% of trade notional). */
  creatorSplit: 0.0025,
} as const;

/**
 * Creator's share of the total Alt Fun trading fee (currently 33% — i.e.
 * 0.25% creator out of the 0.75% total). Used in user-facing copy that
 * frames the creator cut as a percentage of fees rather than of trade
 * notional.
 *
 * Derived so the displayed % stays in lock-step with `FEES` if the split
 * is ever rebalanced. Guarded against a zero-total split (would otherwise
 * render `Infinity%` in copy if a future config sets both shares to 0)
 * and rounded to the nearest whole percent so non-clean ratios (the
 * current `0.25 / 0.75 = 33.33%` rounds to a clean `33%`, and a future
 * tweak that landed on, say, 32.8% would still render the same way).
 */
const TOTAL_FEE_SPLIT = FEES.creatorSplit + FEES.protocolSplit;
export const CREATOR_FEE_SHARE_PCT =
  TOTAL_FEE_SPLIT > 0
    ? Math.round((FEES.creatorSplit / TOTAL_FEE_SPLIT) * 100)
    : 0;

/**
 * Default referral code for the Referral Module.
 * Set to bytes32(0) for no referral — replace with partner codes in production.
 */
export const DEFAULT_REFERRAL_CODE =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

export const TOKEN_SUPPLY = 1_000_000_000;

/**
 * Default token logo served from `apps/web/public/` when the creator
 * skipped image upload at launch. Substituted into `Token.image` /
 * `HeldToken.image` / `CreatedToken.imageUrl` at the service layer so
 * every consumer (rows, hero, balances, creator-rewards) renders the
 * same fallback art instead of falling through to the mint-`?`
 * placeholder. The on-chain `image` field stays empty in that case
 * (the API rejects non-R2 URLs by design — see
 * `apps/api/src/lib/token-registration.ts` `validateImageUrl`), so
 * other clients reading the chain are free to apply their own default.
 */
export const DEFAULT_TOKEN_IMAGE = "/default-token-image.png";

/**
 * Quick-select chips in the trade-settings popup. Fractional (`0.02 = 2%`)
 * to match the `slippage` arg every router/quote function expects. Keep in
 * lock-step with `DEFAULT_SLIPPAGE` below — the default must remain a member
 * of this list so the active-preset highlight resolves on first paint.
 */
export const SLIPPAGE_OPTIONS = [0.02, 0.05, 0.1, 0.15] as const;

/**
 * Initial slippage for users who have never opened the settings popup
 * (or whose `altfun:slippage` localStorage entry is missing/corrupt). LT
 * underlying assets like HYPE/BTC/SOL can move several percent between
 * quote and confirm even on a fast wallet, so we default high enough that
 * the average buy succeeds first try. Users can dial it down via the
 * settings popup if they want tighter execution.
 */
export const DEFAULT_SLIPPAGE = 0.1;

export const QUICK_AMOUNTS = [25, 50, 100, 250] as const;

export const SELL_PERCENT_OPTIONS = [10, 25, 50, 75, 100] as const;

export const SEED_PCT_OPTIONS = [1, 2, 3, 5] as const;

// Re-export the canonical asset / leverage allowlists from `@launchpad/shared`.
// Visible market lists are narrowed by the live LT directory so newly allowed
// assets do not appear before the contract-backed mirror detects them.
export {
  SUPPORTED_UNDERLYING_ASSETS as UNDERLYING_ASSETS,
  SUPPORTED_LEVERAGES as LEVERAGE_OPTIONS,
} from "@launchpad/shared";
export type {
  SupportedAsset as UnderlyingAsset,
  SupportedLeverage as Leverage,
} from "@launchpad/shared";
