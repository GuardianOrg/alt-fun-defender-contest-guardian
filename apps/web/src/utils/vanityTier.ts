import { VANITY_SUFFIX } from "@launchpad/shared";

import type { Address } from "viem";

/**
 * Vanity tier system.
 *
 * Every launched token's address ends in at least 5 zeros (enforced by
 * `Bonding._checkVanity`). Anything beyond that is a cosmetic flex — the
 * miner in `useVanityAddress.ts` keeps running in the background pushing
 * for ever-rarer addresses, and both the launch button (during creation)
 * and every place the token is rendered (rows, hero, search, trade panel)
 * apply a progressively more dramatic effect based on the trailing-zero
 * count.
 *
 * Tier thresholds are bucketed at the low end (where bonus zeros are
 * easy) and unique at the high end (where the gap between tiers is the
 * point). Probability per attempt is `1/16^N`; at ~10⁹ keccak/s on a
 * top-end GPU rig the eyeballed cost is roughly:
 *
 *   +1 zero (6 total)  ~0.1s   GPU /  ~10s   CPU
 *   +2       (7)       ~1.7s          ~3min
 *   +3       (8)       ~30s           ~50min
 *   +4       (9)       ~8min          ~13h
 *   +5       (10)      ~2h            ~9 days
 *   +6       (11)      ~36h           ~5 months
 *   +7       (12)      ~24 days
 *   +8       (13)      ~13 months
 *   +9       (14)      ~17 years
 *   +10+     (15+)     dedicated GPU farm territory
 *
 * The thresholds below assume a reasonably motivated user with a custom
 * miner can reach `cosmic` (+10), and only a sustained GPU-farm campaign
 * can reach `singularity` (+11).
 */

/**
 * Trailing-zero count enforced by `Bonding._checkVanity` on-chain.
 * Derived from the shared `VANITY_SUFFIX` constant so we can't drift if
 * the on-chain minimum ever changes — bumping the suffix in
 * `packages/shared/src/vanity.ts` automatically rescales the entire
 * tier ladder here.
 */
export const VANITY_BASE_ZEROS = VANITY_SUFFIX.length;

export type VanityTierId =
  | "none"
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "diamond"
  | "lightning"
  | "inferno"
  | "obsidian"
  | "cosmic"
  | "singularity";

export interface VanityTier {
  /** Stable id used as the CSS class key on `VanityEffect`. */
  id: VanityTierId;
  /** Human-readable name (only surfaced in admin / dev tooling for now). */
  label: string;
  /**
   * Inclusive minimum *bonus* zero count above `VANITY_BASE_ZEROS`. So
   * `minBonus = 0` is the base tier (`none`); a token with 7 trailing
   * zeros has `bonus = 2` and lands in `bronze`.
   */
  minBonus: number;
  /**
   * 0-based ordinal used for sorts / leaderboards. Matches the index of
   * this tier in `TIER_TABLE`.
   */
  rarity: number;
  /**
   * Hint for the renderer. CSS-only tiers (rarity 0–5) are cheap and can
   * be applied unconditionally; particle tiers (6+) are lazy-loaded and
   * gated behind viewport visibility + `prefers-reduced-motion`.
   */
  effect: "none" | "css" | "particles";
}

/**
 * Ordered low → high rarity. Lookups walk this descending so the first
 * match wins (i.e. `tierForZeros(20)` resolves to `singularity`, not
 * `bronze`). Keep `none` at index 0 so the rarity/index invariant holds.
 */
export const TIER_TABLE: readonly VanityTier[] = [
  { id: "none", label: "Common", minBonus: 0, rarity: 0, effect: "none" },
  // +1 bonus (6 zeros) is too easy on a JS worker pool (~6s mean) to
  // feel like a flex, so it stays in the `none` tier. Bronze kicks in
  // at +2 (7 zeros, ~90s mean on a multi-core CPU / ~3ms on a GPU
  // cluster), which is the first count that takes long enough to
  // actually feel earned.
  { id: "bronze", label: "Bronze", minBonus: 2, rarity: 1, effect: "css" },
  { id: "silver", label: "Silver", minBonus: 3, rarity: 2, effect: "css" },
  { id: "gold", label: "Gold", minBonus: 4, rarity: 3, effect: "css" },
  { id: "platinum", label: "Platinum", minBonus: 5, rarity: 4, effect: "css" },
  { id: "diamond", label: "Diamond", minBonus: 6, rarity: 5, effect: "css" },
  { id: "lightning", label: "Lightning", minBonus: 7, rarity: 6, effect: "particles" },
  { id: "inferno", label: "Inferno", minBonus: 8, rarity: 7, effect: "particles" },
  { id: "obsidian", label: "Obsidian", minBonus: 9, rarity: 8, effect: "particles" },
  { id: "cosmic", label: "Cosmic", minBonus: 10, rarity: 9, effect: "particles" },
  { id: "singularity", label: "Singularity", minBonus: 11, rarity: 10, effect: "particles" },
] as const;

/**
 * Count consecutive trailing `0` hex chars in an Ethereum address. Casing-
 * insensitive (the digit `0` renders identically across EIP-55 casings,
 * but we lowercase defensively in case a non-standard casing slips
 * through). Capped at 40 (the full address).
 */
export function countTrailingZeros(addr: Address | string): number {
  const hex = addr.toLowerCase().replace(/^0x/, "");
  let zeros = 0;
  for (let i = hex.length - 1; i >= 0 && hex[i] === "0"; i--) {
    zeros++;
  }
  return zeros;
}

/**
 * Resolve the tier for a given total trailing-zero count. Anything below
 * the on-chain minimum (which shouldn't happen for launched tokens, but
 * could for unconfirmed previews) falls into `none`.
 */
export function tierForZeros(totalZeros: number): VanityTier {
  const bonus = Math.max(0, totalZeros - VANITY_BASE_ZEROS);
  for (let i = TIER_TABLE.length - 1; i >= 0; i--) {
    if (bonus >= TIER_TABLE[i].minBonus) return TIER_TABLE[i];
  }
  return TIER_TABLE[0];
}

/**
 * Resolve the tier of a token directly from its address. Use this in
 * render code where you have the address but not a precomputed zero
 * count.
 */
export function tierFor(addr: Address | string): VanityTier {
  return tierForZeros(countTrailingZeros(addr));
}
