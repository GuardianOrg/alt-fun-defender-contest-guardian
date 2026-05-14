/**
 * Bonding curve math for seed buy estimation.
 *
 * The bonding curve is a constant-product AMM (x * y = k) where:
 *   reserve0 = virtual token reserve (initialised to TOTAL_SUPPLY, 1B)
 *   reserve1 = virtual LT reserve (set so opening MC ≈ `VIRTUAL_LIQUIDITY_USD`)
 *
 * Only CURVE_SUPPLY (75% = 750M) of real tokens are transferred to the pair;
 * the other 25% is reserved for graduation LP seeding. The virtual reserve
 * design pins `tokensForLP ≤ LP_RESERVE` at graduation. See `docs/contracts-scope.md`.
 *
 * Because both the virtual reserve and the LT minted from USDC scale
 * inversely with the LT exchange rate, the rate cancels out — the number
 * of tokens received depends only on the USDC amount.
 *
 * All values mirror the on-chain Bonding.sol constants.
 */

const TOTAL_SUPPLY = 1_000_000_000;
const CURVE_BPS = 7500;
const BPS_DENOM = 10_000;
const CURVE_SUPPLY = (TOTAL_SUPPLY * CURVE_BPS) / BPS_DENOM; // 750M — real sellable cap
/// Mirrors the USD magnitude of `Bonding.VIRTUAL_LIQUIDITY_USD` as a plain
/// JS integer (USD dollars), not the on-chain 18-dp wei representation.
/// Exported so tests can derive expected curve outputs without re-hardcoding
/// the value (which would silently drift the moment the on-chain dial moves).
export const VIRTUAL_LIQUIDITY_USD = 3000;
const BUY_FEE_BPS = 75; // 0.75%

export interface SeedBuyStats {
  tokensReceived: number;
  supplyPct: number;
  curveFilled: number;
}

/**
 * Compute seed buy stats from a USDC amount using the constant-product formula.
 *
 *   usdcAfterFee = usdcAmount × (1 − buyFee)
 *   tokensOut    = totalSupply × usdcAfterFee / (virtualLiquidity + usdcAfterFee)
 *                  (then clamped to curveSupply — on-chain `Router.buy` caps at real balance)
 *   supplyPct    = tokensOut / totalSupply × 100
 *   curveFilled  = usdcAfterFee / graduationThreshold × 100
 *
 * `graduationThresholdUsd` is the live `Bonding.graduationThresholdUsd`
 * (read via `useGraduationThreshold`). It's set once at proxy initialisation
 * and immutable thereafter — pass the hook's `fallback` while loading so
 * the preview renders something sensible instead of `Infinity` (which
 * would surface as `0%` in the UI but NaN-poison any downstream math).
 */
export function seedBuyStats(
  usdcAmount: number,
  graduationThresholdUsd: number,
): SeedBuyStats {
  if (!Number.isFinite(usdcAmount) || usdcAmount <= 0) {
    return { tokensReceived: 0, supplyPct: 0, curveFilled: 0 };
  }

  const usdcAfterFee = usdcAmount * (1 - BUY_FEE_BPS / BPS_DENOM);
  const rawTokens =
    (TOTAL_SUPPLY * usdcAfterFee) / (VIRTUAL_LIQUIDITY_USD + usdcAfterFee);
  const tokensReceived = Math.min(rawTokens, CURVE_SUPPLY);
  const supplyPct = (tokensReceived / TOTAL_SUPPLY) * 100;
  const curveFilled =
    graduationThresholdUsd > 0
      ? (usdcAfterFee / graduationThresholdUsd) * 100
      : 0;

  return { tokensReceived, supplyPct, curveFilled };
}

/**
 * Compute the USDC amount needed to acquire a target percentage of total supply.
 *
 * Derived by inverting the constant-product formula:
 *   pct = 100 × usdcAfterFee / (VIRTUAL_LIQUIDITY_USD + usdcAfterFee)
 *   ⟹  usdcAfterFee = VIRTUAL_LIQUIDITY_USD × pct / (100 − pct)
 *   ⟹  usdcAmount   = usdcAfterFee / (1 − buyFee)
 *
 * Returns 0 for pct <= 0 or pct >= 75 (can't buy more than CURVE_SUPPLY of real tokens).
 */
export function usdcForSupplyPct(pct: number): number {
  const curveSupplyPct = (CURVE_BPS / BPS_DENOM) * 100; // 75
  if (!Number.isFinite(pct) || pct <= 0 || pct >= curveSupplyPct) return 0;

  const usdcAfterFee = (VIRTUAL_LIQUIDITY_USD * pct) / (100 - pct);
  return usdcAfterFee / (1 - BUY_FEE_BPS / BPS_DENOM);
}
