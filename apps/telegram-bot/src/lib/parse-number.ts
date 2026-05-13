/**
 * Bounded numeric input parser for user-typed amounts.
 *
 * `parseFloat(text)` silently produces `Infinity` for inputs like
 * `"1e400"` and `NaN` for `"foo"`. Both then flow into downstream math
 * (`amount * (1 + COMBINED_FEE_RATE)`, `Math.round(amount * 1_000_000)`,
 * `BigInt(...)`) where `Infinity` becomes a `RangeError` at the
 * `BigInt` boundary and `NaN` either propagates as `JSON null` or
 * corrupts further math. Past `Number.MAX_SAFE_INTEGER` integer
 * precision is gone too, so the post-`Math.round` `BigInt` no longer
 * matches what the user thought they typed.
 *
 * Returns the parsed value when it is a finite, strictly-positive
 * number bounded by both `Number.MAX_SAFE_INTEGER` and the caller's
 * `max`. Otherwise returns `null` and the caller is expected to surface
 * an invalid-input message to the user.
 *
 * Strips `$` and `,` so `"$1,234.56"` parses the same as `"1234.56"`.
 * The strip set is intentionally narrow — anything else (letters,
 * whitespace mid-number, multiple decimal points) falls through to
 * `Number()` which yields `NaN` and is rejected here.
 */
export const parseUserAmount = (
  text: string,
  options: { max: number },
): number | null => {
  const cleaned = text.replace(/[$,]/g, "").trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return null;
  if (value > Number.MAX_SAFE_INTEGER) return null;
  if (value > options.max) return null;
  return value;
};

/**
 * Absolute upper bound for any user-typed USDC amount. Far above any
 * realistic trade size but well below `Number.MAX_SAFE_INTEGER`, so
 * subsequent `amount * 1_000_000` (USDC 6dp scaling) and `amount *
 * (1 + feeRate)` stay safely inside `Number` integer precision and
 * cannot overflow to `Infinity`. Tighter per-flow caps (`MAX_BUY_USDC`
 * in settings, etc.) still apply on top.
 */
export const MAX_USDC_AMOUNT = 1_000_000_000;
