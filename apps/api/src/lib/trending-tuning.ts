/**
 * Internal trending-score tuning. Anything in this file is intentionally
 * **not** exposed via any API response, log line, or admin endpoint —
 * surfacing it would defeat the purpose. If you need to add a new lever
 * here, keep it call-site-only (i.e. read it inside `list.ts` while
 * sorting, never thread it onto `EnrichedToken`).
 *
 * The trending algorithm itself (`computeTrendingScore` in
 * `token-enrich.ts`) is deliberately noisy enough that a modest additive
 * adjustment per token is indistinguishable from normal variance in
 * change24h / volume / freshness — see `TRENDING_BOOST_AMOUNT` for the
 * sizing rationale.
 */

/**
 * Flat point bump added to a boosted token's trending score. Sized to be
 * comparable to a +50% 24h change or a ~1000× volume jump in the existing
 * model, so a healthy boosted token reliably climbs into its cohort
 * without dominating an actual mover. Additive (not multiplicative) so
 * it can't accidentally amplify the −1000 dead-token penalty into a
 * promotion for an ancient quiet token.
 */
export const TRENDING_BOOST_AMOUNT = 50;

/**
 * Addresses whose trending score gets `+TRENDING_BOOST_AMOUNT` applied.
 * Stored lowercased so lookups don't depend on whether the caller has
 * already run the address through `viem.getAddress` (the DB stores
 * checksummed, but enrich/route code occasionally lowercases for map
 * keys).
 *
 * Keep this list short and human-curated. Adding many addresses, or any
 * address that wouldn't pass the eye test if it appeared near the top
 * of the trending tab, defeats the "lost in the noise" property the
 * algorithm relies on for plausible deniability.
 */
const BOOSTED_TOKEN_ADDRESSES: ReadonlySet<string> = new Set([
  "0x6e2772e2e30854fc42bc83cc8a6060aa8b000000",
]);

/**
 * Case-insensitive membership check against `BOOSTED_TOKEN_ADDRESSES`.
 * Returns `false` for null/undefined so callers can pass through values
 * straight from the DB row without a guard.
 */
export function isBoostedToken(address: string | null | undefined): boolean {
  if (!address) return false;
  return BOOSTED_TOKEN_ADDRESSES.has(address.toLowerCase());
}
