/**
 * Compile-time fallback for `Bonding.graduationThresholdUsd`. Off-chain
 * consumers (API, frontend) read the live value from the contract via RPC
 * and fall back to this constant when the RPC is unreachable so the
 * curve-filled progress bar stays meaningful during outages.
 *
 * The threshold is set once at proxy initialisation and has no on-chain
 * setter — see `packages/contracts/src/Bonding.sol`. Keep this in sync
 * with the value passed to `Bonding.initialize` in
 * `packages/contracts/script/Deploy.s.sol`. If the production deploy
 * threshold is ever changed via a UUPS upgrade, update this constant too
 * (the live RPC read still wins; this is just the offline fallback).
 */

/** USD denominated as a plain integer (no decimals). Matches `12_000 ether` in 18-dp. */
export const DEFAULT_GRADUATION_THRESHOLD_USD = 12_000;
