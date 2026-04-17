/**
 * Token price = curve ratio × LT exchange rate.
 *
 * `curveSupply` / `ltReserve` come from the Bonding curve state (on-chain,
 * indexed by Ponder). `ltExchangeRate` is the BounceTech Leveraged Token's
 * USD-per-unit rate sourced from `token_snapshots_v1`.
 *
 * This helper is the single source of truth for both server-side market data
 * and client-side live chart aggregation. Keep in sync across both callsites
 * by importing from here rather than re-deriving.
 */
const RATIO_PRECISION = 10n ** 18n;

function bigintRatio(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  return Number((numerator * RATIO_PRECISION) / denominator) / 1e18;
}

export function computeCurveRatio(
  curveSupply: bigint,
  ltReserve: bigint,
): number {
  return bigintRatio(ltReserve, curveSupply);
}

export function computeTokenPrice(
  curveSupply: bigint,
  ltReserve: bigint,
  ltExchangeRate: number,
): number {
  if (curveSupply === 0n || ltExchangeRate <= 0) return 0;
  const ratio = bigintRatio(ltReserve, curveSupply);
  return ratio * ltExchangeRate;
}
