/**
 * Compile-time defaults for `Bonding` parameters that are now mutable on-chain
 * (owner-set via `Bonding.setGraduationThresholdUsd`). Off-chain consumers
 * (API, frontend, indexer bootstrap) read the live value when available and
 * fall back to these constants otherwise so the curve-filled progress bar
 * stays meaningful during indexer/RPC outages.
 *
 * Keep these in sync with `Bonding.DEFAULT_GRADUATION_THRESHOLD_USD` and
 * `Bonding.MIN_GRADUATION_THRESHOLD_USD` / `Bonding.MAX_GRADUATION_THRESHOLD_USD`.
 */

/** USD denominated as a plain integer (no decimals). Matches `300 ether` in 18-dp. */
export const DEFAULT_GRADUATION_THRESHOLD_USD = 300;

/** 18-dp wei representation. Used by the indexer when seeding `protocolConfig`. */
export const DEFAULT_GRADUATION_THRESHOLD_USD_WEI = 300n * 10n ** 18n;
