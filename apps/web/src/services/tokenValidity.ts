import { fetchTokenValidity } from "./api";

/**
 * Per-address validity cache for the recent-trades WS path. A token is
 * "valid" when it's registered, not moderation-hidden, and not sitting on
 * a mint-paused LT — the same gates the public catalogue uses.
 *
 * Negative answers (`false`) stay cached for the page lifetime: an
 * unregistered token flickering into the feed every few seconds is worse
 * than waiting for a reload after backfill. Positive answers expire so a
 * mid-session mint-pause drops the token from the live feed without a
 * full reload. Transient fetch failures are never cached.
 */
const validityCache = new Map<string, { valid: boolean; expiresAt: number }>();

/** Re-check a previously-valid token about as often as the LT directory poller. */
const POSITIVE_TTL_MS = 30_000;

// Dedupes concurrent checks for the same address.
const inflight = new Map<string, Promise<boolean>>();

function readCache(key: string): boolean | undefined {
  const entry = validityCache.get(key);
  if (!entry) return undefined;
  if (entry.valid && Date.now() >= entry.expiresAt) {
    validityCache.delete(key);
    return undefined;
  }
  return entry.valid;
}

/** Synchronous cache peek; `undefined` means "not yet resolved". */
export function getCachedTokenValidity(address: string): boolean | undefined {
  return readCache(address.toLowerCase());
}

/**
 * Resolve (and cache) whether a token is valid for public feeds.
 * Transient failures (network / API 503) resolve to `false` WITHOUT
 * caching, so a later trade for the same token re-checks rather than being
 * permanently suppressed; we still treat it as invalid for now so an
 * unverified token never slips into the feed.
 */
export async function isTokenValid(address: string): Promise<boolean> {
  const key = address.toLowerCase();

  const cached = readCache(key);
  if (cached !== undefined) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = fetchTokenValidity(key)
    .then((valid) => {
      validityCache.set(key, {
        valid,
        expiresAt: valid ? Date.now() + POSITIVE_TTL_MS : Number.POSITIVE_INFINITY,
      });
      return valid;
    })
    .catch(() => false)
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/** Test-only: drop the in-memory cache between cases. */
export function _resetTokenValidityCache(): void {
  validityCache.clear();
  inflight.clear();
}
