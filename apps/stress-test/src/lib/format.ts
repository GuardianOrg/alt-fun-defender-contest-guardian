/**
 * Number/balance formatting helpers shared across scenarios. Kept
 * dependency-free (`bigint` arithmetic only) so they're cheap to call
 * inside hot loops if a future scenario wants per-iteration formatting.
 */

const USDC_FACTOR = 1_000_000n;
const HYPE_FACTOR = 1_000_000_000_000_000_000n;

/** Pretty-print a USDC raw amount (6dp) as `$1234.56`. */
export function formatUsdc(raw: bigint): string {
  const whole = raw / USDC_FACTOR;
  const frac = (raw % USDC_FACTOR).toString().padStart(6, "0").slice(0, 2);
  return `$${whole}.${frac}`;
}

/** Pretty-print a native HYPE raw amount (18dp) as `1.59`. */
export function formatHype(raw: bigint): string {
  const whole = raw / HYPE_FACTOR;
  const frac = (raw % HYPE_FACTOR).toString().padStart(18, "0").slice(0, 2);
  return `${whole}.${frac}`;
}

/** Pretty-print a fraction in [0, 1] as a percent with one decimal place. */
export function formatFraction(frac: number): string {
  return `${(frac * 100).toFixed(1)}%`;
}
