import { fetchTokenValidity } from "./api";

/**
 * Per-address validity cache for the recent-trades WS path. A token is
 * "valid" when it's registered in `public.tokens` and not moderation-hidden
 * — the same gate the detail page uses. Validity is effectively immutable
 * for the page lifetime in the common case, so we cache the result and only
 * hit the API once per token address (matching the REST feed, which is
 * already SQL-filtered server-side).
 */
const validityCache = new Map<string, boolean>();

// Dedupes concurrent checks for the same address.
const inflight = new Map<string, Promise<boolean>>();

/** Synchronous cache peek; `undefined` means "not yet resolved". */
export function getCachedTokenValidity(address: string): boolean | undefined {
  return validityCache.get(address.toLowerCase());
}

/**
 * Resolve (and cache) whether a token is valid. Successful responses —
 * including a definitive `false` — are cached for the page lifetime.
 * Transient failures (network / API 503) resolve to `false` WITHOUT
 * caching, so a later trade for the same token re-checks rather than being
 * permanently suppressed; we still treat it as invalid for now so an
 * unverified token never slips into the feed.
 */
export async function isTokenValid(address: string): Promise<boolean> {
  const key = address.toLowerCase();

  const cached = validityCache.get(key);
  if (cached !== undefined) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = fetchTokenValidity(key)
    .then((valid) => {
      validityCache.set(key, valid);
      return valid;
    })
    .catch(() => false)
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}
