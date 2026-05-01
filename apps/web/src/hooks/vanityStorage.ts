import { metadataHash } from "@launchpad/shared";

import type { Address, Hex } from "viem";

/**
 * localStorage-backed cache of best-known vanity salts. Keyed by the
 * `(creator, implementation, nameHash, tickerHash)` tuple. Three of those
 * are inputs to the on-chain `Bonding._mixSalt` mix; the fourth
 * (`implementation`) feeds the EIP-1167 init code that the CREATE2
 * derivation is hashed against. Owner-rotatable in `Bonding`, so a salt
 * cached against the previous impl would predict a different address
 * after rotation and revert at launch with `NotVanityAddress`. Including
 * impl in the key means a rotation seamlessly invalidates every cached
 * entry without us needing to walk storage.
 *
 * Editing form fields switches keys; the previous tuple's progress stays
 * in storage in case the user changes their mind back. An LRU cap keeps
 * the storage bounded so a user trying many (name, ticker) pairs can't
 * blow past the browser quota.
 */

export interface VanityCacheEntry {
  /** `0x`-prefixed 32-byte salt that satisfies the on-chain vanity check. */
  salt: Hex;
  /** Predicted token address. Lowercase hex, `0x`-prefixed. */
  address: Address;
  /** Total trailing-zero count of `address` (always ≥ 5). */
  zeros: number;
  /** `Date.now()` of the last write. Used for LRU eviction + UI. */
  savedAt: number;
}

const KEY_PREFIX = "vanity:";
const MAX_ENTRIES = 50;

/**
 * Truncated metadata-hash form keeps localStorage keys short. We only need
 * uniqueness across (creator, impl, name, ticker) tuples a single user is
 * actively cycling through, and 32 bits each of name/ticker keccak plus
 * 32 bits of impl is more than enough — collision means a stale entry
 * gets reused for a different launch context, which is harmless: the
 * launch tx still verifies on-chain via `Bonding._checkVanity` and would
 * revert with `NotVanityAddress` rather than producing a bad token.
 */
export function vanityKey(
  creator: Address,
  implementation: Address,
  name: string,
  ticker: string,
): string {
  const implSlug = implementation.toLowerCase().slice(2, 10);
  const nameSlug = metadataHash(name).slice(2, 10);
  const tickerSlug = metadataHash(ticker).slice(2, 10);
  return `${KEY_PREFIX}${creator.toLowerCase()}:${implSlug}:${nameSlug}:${tickerSlug}`;
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const ls = window.localStorage;
    const probe = "__vanity_probe__";
    ls.setItem(probe, probe);
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

function isEntry(v: unknown): v is VanityCacheEntry {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.salt === "string"
    && typeof o.address === "string"
    && typeof o.zeros === "number"
    && typeof o.savedAt === "number"
  );
}

export function readVanityCache(key: string): VanityCacheEntry | null {
  const ls = safeStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isEntry(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * LRU eviction: collect every `vanity:*` key, sort by `savedAt` ascending,
 * drop the oldest until we're under `MAX_ENTRIES - 1` (so the upcoming
 * write fits). Done synchronously because we're already in storage code
 * and concurrent tabs are guarded by the browser's per-key atomicity.
 */
function evictOldestIfNeeded(ls: Storage): void {
  const entries: Array<{ key: string; savedAt: number }> = [];
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (!k || !k.startsWith(KEY_PREFIX)) continue;
    const raw = ls.getItem(k);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isEntry(parsed)) {
        entries.push({ key: k, savedAt: parsed.savedAt });
      } else {
        ls.removeItem(k);
      }
    } catch {
      ls.removeItem(k);
    }
  }
  if (entries.length < MAX_ENTRIES) return;
  entries.sort((a, b) => a.savedAt - b.savedAt);
  const toEvict = entries.length - (MAX_ENTRIES - 1);
  for (let i = 0; i < toEvict; i++) {
    ls.removeItem(entries[i].key);
  }
}

export function writeVanityCache(key: string, entry: VanityCacheEntry): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    evictOldestIfNeeded(ls);
    ls.setItem(key, JSON.stringify(entry));
  } catch {
    // Quota exhausted (rare given the LRU cap) or storage disabled
    // mid-session. Mining still works, the persistence layer just goes
    // best-effort.
  }
}
