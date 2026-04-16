/**
 * Bonding curve math for seed buy estimation.
 *
 * The bonding curve is a constant-product AMM (x * y = k) where:
 *   reserve0 = token supply on the curve (initially 75% of total supply)
 *   reserve1 = virtual LT reserve (set so opening MC ≈ $4K)
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
const CURVE_SUPPLY = (TOTAL_SUPPLY * CURVE_BPS) / BPS_DENOM; // 750,000,000
const VIRTUAL_LIQUIDITY_USD = 3_000;
const GRADUATION_THRESHOLD_USD = 12_000;
const BUY_FEE_BPS = 50; // 0.5%

export interface SeedBuyStats {
  tokensReceived: number;
  supplyPct: number;
  curveFilled: number;
}

/**
 * Compute seed buy stats from a USDC amount using the constant-product formula.
 *
 *   usdcAfterFee = usdcAmount × (1 − buyFee)
 *   tokensOut    = curveSupply × usdcAfterFee / (virtualLiquidity + usdcAfterFee)
 *   supplyPct    = tokensOut / totalSupply × 100
 *   curveFilled  = usdcAfterFee / graduationThreshold × 100
 */
export function seedBuyStats(usdcAmount: number): SeedBuyStats {
  if (!Number.isFinite(usdcAmount) || usdcAmount <= 0) {
    return { tokensReceived: 0, supplyPct: 0, curveFilled: 0 };
  }

  const usdcAfterFee = usdcAmount * (1 - BUY_FEE_BPS / BPS_DENOM);
  const tokensReceived =
    (CURVE_SUPPLY * usdcAfterFee) / (VIRTUAL_LIQUIDITY_USD + usdcAfterFee);
  const supplyPct = (tokensReceived / TOTAL_SUPPLY) * 100;
  const curveFilled = (usdcAfterFee / GRADUATION_THRESHOLD_USD) * 100;

  return { tokensReceived, supplyPct, curveFilled };
}

/**
 * Compute the USDC amount needed to acquire a target percentage of total supply.
 *
 * Derived by inverting the constant-product formula:
 *   pct = 75 × usdcAfterFee / (3000 + usdcAfterFee)
 *   ⟹  usdcAfterFee = 3000 × pct / (75 − pct)
 *   ⟹  usdcAmount   = usdcAfterFee / (1 − buyFee)
 *
 * Returns 0 for pct <= 0 or pct >= 75 (can't buy more than the curve supply).
 */
export function usdcForSupplyPct(pct: number): number {
  const curveSupplyPct = (CURVE_BPS / BPS_DENOM) * 100; // 75
  if (!Number.isFinite(pct) || pct <= 0 || pct >= curveSupplyPct) return 0;

  const usdcAfterFee =
    (VIRTUAL_LIQUIDITY_USD * pct) / (curveSupplyPct - pct);
  return usdcAfterFee / (1 - BUY_FEE_BPS / BPS_DENOM);
}
