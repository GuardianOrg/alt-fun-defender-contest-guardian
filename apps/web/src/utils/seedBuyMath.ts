import { DEFAULT_GRADUATION_THRESHOLD_USD } from "@launchpad/shared";

/** Bonding-curve seed-buy estimator mirroring on-chain constants. */

const TOTAL_SUPPLY = 1_000_000_000;
const CURVE_BPS = 7500;
const BPS_DENOM = 10_000;
const CURVE_SUPPLY = (TOTAL_SUPPLY * CURVE_BPS) / BPS_DENOM; // 750M — real sellable cap
/// Plain USD mirror of `Bonding.VIRTUAL_LIQUIDITY_USD` for UI/tests.
export const VIRTUAL_LIQUIDITY_USD = 3000;
const BUY_FEE_BPS = 75; // 0.75%

export interface SeedBuyStats {
  tokensReceived: number;
  supplyPct: number;
  curveFilled: number;
}

/** Compute seed-buy stats from a USDC amount using the local curve mirror. */
export function seedBuyStats(usdcAmount: number): SeedBuyStats {
  if (!Number.isFinite(usdcAmount) || usdcAmount <= 0) {
    return { tokensReceived: 0, supplyPct: 0, curveFilled: 0 };
  }

  const usdcAfterFee = usdcAmount * (1 - BUY_FEE_BPS / BPS_DENOM);
  const rawTokens =
    (TOTAL_SUPPLY * usdcAfterFee) / (VIRTUAL_LIQUIDITY_USD + usdcAfterFee);
  const tokensReceived = Math.min(rawTokens, CURVE_SUPPLY);
  const supplyPct = (tokensReceived / TOTAL_SUPPLY) * 100;
  const curveFilled = (usdcAfterFee / DEFAULT_GRADUATION_THRESHOLD_USD) * 100;

  return { tokensReceived, supplyPct, curveFilled };
}

/** Invert the curve mirror to estimate USDC needed for a target supply percent. */
export function usdcForSupplyPct(pct: number): number {
  const curveSupplyPct = (CURVE_BPS / BPS_DENOM) * 100; // 75
  if (!Number.isFinite(pct) || pct <= 0 || pct >= curveSupplyPct) return 0;

  const usdcAfterFee = (VIRTUAL_LIQUIDITY_USD * pct) / (100 - pct);
  return usdcAfterFee / (1 - BUY_FEE_BPS / BPS_DENOM);
}
