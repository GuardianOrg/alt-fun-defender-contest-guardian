/**
 * "Is this LT live on BounceTech's public UI?" oracle (issue #621).
 *
 * BounceTech deploys leveraged tokens to chain + their indexing API the
 * moment they're spun up, often days before the team finishes testing them
 * and publishes them in their own web app. For those days the LT exists
 * everywhere we look (`/leveraged-tokens` directory, on-chain) but isn't
 * a "real" launch yet — we don't want it surfacing in Alt Fun's markets
 * sidebar, asset tape, pair selector, or token feed.
 *
 * BounceTech doesn't expose a "published" flag on the indexing API, but
 * they only upload the per-LT logo at
 * `https://bounce.tech/leveraged-tokens/<symbol>.png` once the LT is
 * ready to go public. Checking that image's existence via HEAD is the
 * cheapest available proxy and matches the team's own ordering — the
 * image is the last thing they put in place before a public listing.
 *
 * This module owns the cached set of LT *addresses* that are currently
 * live, refreshed periodically. It runs in the API Worker (not the
 * indexer) because:
 *   - The signal is HTTP-only — no on-chain trigger to hook into Ponder.
 *   - Refresh cadence is "every couple of minutes" rather than per-block.
 *   - The consumers (markets list, token list filter, /api/v1/assets) all
 *     live in this Worker already.
 *
 * Cache strategy:
 *   - Per-isolate `Map<lt-address-lowercased, boolean>`, populated lazily
 *     on first access and refreshed in the background once stale.
 *   - Cron (`scheduled` in `index.ts`) calls `refreshLiveLtAvailability`
 *     every minute to keep the cache warm.
 *   - Concurrent callers share the in-flight refresh via a Promise lock
 *     so one cold start doesn't trigger N parallel BounceTech directory
 *     fetches + N×|symbols| HEAD requests.
 *   - On HEAD failure (network / 5xx / timeout) we treat the LT as live —
 *     hiding LTs on transient errors would deal more harm than the rare
 *     "test LT showing for a few minutes" case.
 */

import {
  BOUNCE_INDEXING_API,
  filterSupportedLTs,
  getBounceLtImageUrl,
  type LiveLeveragedToken,
} from "@launchpad/shared";

/**
 * How long a cached result stays "fresh". After this much time, the next
 * `getLiveLtAvailability` call kicks off a background refresh (callers
 * keep the stale snapshot for that request — never block the hot path
 * on a fresh HEAD sweep).
 */
const CACHE_TTL_MS = 5 * 60_000;

/**
 * Soft per-HEAD timeout. BounceTech's CDN is normally <100ms; this is
 * the upper bound past which we'd rather treat the LT as live than make
 * users wait. A burst of slow responses ends up classified as "live" —
 * fail-open is the right policy here (see file-level doc).
 */
const HEAD_REQUEST_TIMEOUT_MS = 4_000;

/**
 * Soft global cap on how long the whole refresh can take. A bunch of slow
 * BounceTech responses shouldn't be able to wedge a cron tick or a cold
 * user request indefinitely.
 */
const REFRESH_TIMEOUT_MS = 15_000;

/**
 * Concurrency cap on outbound HEAD requests during a single refresh.
 * Keeps us well under BounceTech CDN rate limits while still finishing
 * a ~20-LT sweep in under a second.
 */
const HEAD_CONCURRENCY = 5;

interface CacheSnapshot {
  /**
   * Lowercased LT contract addresses that are currently live on BounceTech's
   * UI. Lookups happen by `address.toLowerCase()`.
   */
  liveAddresses: Set<string>;
  /**
   * LT symbols (e.g. `HYPE5L`) that passed the HEAD check. Kept alongside
   * addresses so we can power both address-keyed filters (token list) and
   * symbol-keyed surfaces (admin debug, OpenAPI examples).
   */
  liveSymbols: Set<string>;
  /**
   * Lowercased target-asset names that have ≥1 live LT (e.g. `HYPE`,
   * `xyz:NVDA`). The markets sidebar / asset tape use this — an asset
   * with zero live LTs has no useful pair on Alt Fun, so we hide it.
   */
  liveUnderlyings: Set<string>;
  expiresAt: number;
}

let cache: CacheSnapshot | null = null;
let inflightRefresh: Promise<CacheSnapshot> | null = null;

/** Reset hook for tests. */
export function _resetLtAvailabilityCache(): void {
  cache = null;
  inflightRefresh = null;
}

export interface LtAvailability {
  /** Lowercased LT addresses currently live on BounceTech's UI. */
  liveAddresses: ReadonlySet<string>;
  /** LT symbols currently live (e.g. `HYPE5L`). */
  liveSymbols: ReadonlySet<string>;
  /** Underlying asset names with ≥1 live LT (e.g. `HYPE`, `xyz:NVDA`). */
  liveUnderlyings: ReadonlySet<string>;
  /**
   * `true` when this snapshot was built from a successful BounceTech
   * fetch within the last TTL. `false` when we returned the in-memory
   * fall-back (empty set) because no refresh has succeeded yet — callers
   * should treat `false` as "don't filter, signal unavailable" rather
   * than "hide everything" (the alternative would blank the markets
   * sidebar during transient outages).
   */
  fresh: boolean;
}

/**
 * Build an `LtAvailability` view of the current cache. Always returns
 * synchronously — the optional `kickRefresh` flag triggers a background
 * sweep when the cache is stale or missing, but the caller keeps the
 * snapshot we have right now.
 *
 * Designed to be safe to call from every request handler: O(1) when fresh,
 * `<5ms` when stale (just queues the refresh).
 */
export function getCachedLtAvailability(): LtAvailability {
  if (cache && cache.expiresAt > Date.now()) {
    return {
      liveAddresses: cache.liveAddresses,
      liveSymbols: cache.liveSymbols,
      liveUnderlyings: cache.liveUnderlyings,
      fresh: true,
    };
  }
  if (cache) {
    // Stale but better than nothing — clients still get a real filter.
    return {
      liveAddresses: cache.liveAddresses,
      liveSymbols: cache.liveSymbols,
      liveUnderlyings: cache.liveUnderlyings,
      fresh: false,
    };
  }
  return {
    liveAddresses: new Set<string>(),
    liveSymbols: new Set<string>(),
    liveUnderlyings: new Set<string>(),
    fresh: false,
  };
}

/**
 * Ensure the cache is fresh, refreshing if stale / empty. Awaiting this
 * blocks until a snapshot is available, so callers that depend on a real
 * filter (e.g. the very first request after a Worker cold start, before
 * the cron has populated the cache) get a real answer.
 *
 * The fetcher is overridable for tests. In prod, it pulls the supported
 * LT directory from BounceTech's indexing API and HEAD-checks each LT's
 * logo.
 */
export async function getLiveLtAvailability(options: {
  /** Override the LT directory fetcher (tests). */
  fetchSupportedLts?: () => Promise<LiveLeveragedToken[]>;
  /** Override per-symbol HEAD checker (tests). */
  checkSymbolLive?: (symbol: string) => Promise<boolean>;
  /**
   * When `true`, force a refresh even if the cache is fresh. Used by the
   * cron handler to keep the snapshot from going stale; user-facing
   * request handlers should leave this at the default.
   */
  force?: boolean;
} = {}): Promise<LtAvailability> {
  const now = Date.now();
  if (!options.force && cache && cache.expiresAt > now) {
    return {
      liveAddresses: cache.liveAddresses,
      liveSymbols: cache.liveSymbols,
      liveUnderlyings: cache.liveUnderlyings,
      fresh: true,
    };
  }

  const snapshot = await ensureRefresh(options);
  return {
    liveAddresses: snapshot.liveAddresses,
    liveSymbols: snapshot.liveSymbols,
    liveUnderlyings: snapshot.liveUnderlyings,
    fresh: true,
  };
}

/**
 * Trigger a refresh, deduplicating concurrent callers. Used by the cron
 * handler in `index.ts`. Swallows errors and falls back to the existing
 * cache — keeps the snapshot non-empty after a successful first run even
 * when the next BounceTech sweep fails.
 */
export async function refreshLiveLtAvailability(options: {
  fetchSupportedLts?: () => Promise<LiveLeveragedToken[]>;
  checkSymbolLive?: (symbol: string) => Promise<boolean>;
} = {}): Promise<LtAvailability> {
  try {
    return await getLiveLtAvailability({ ...options, force: true });
  } catch {
    return getCachedLtAvailability();
  }
}

async function ensureRefresh(options: {
  fetchSupportedLts?: () => Promise<LiveLeveragedToken[]>;
  checkSymbolLive?: (symbol: string) => Promise<boolean>;
}): Promise<CacheSnapshot> {
  if (inflightRefresh) {
    // A concurrent caller already kicked off a refresh — share the result
    // instead of fanning out N parallel BounceTech sweeps. This matters
    // on cold starts where every handler in the isolate races to populate
    // the cache.
    return inflightRefresh;
  }

  inflightRefresh = (async () => {
    try {
      return await withTimeout(performRefresh(options), REFRESH_TIMEOUT_MS);
    } finally {
      inflightRefresh = null;
    }
  })();

  return inflightRefresh;
}

async function performRefresh(options: {
  fetchSupportedLts?: () => Promise<LiveLeveragedToken[]>;
  checkSymbolLive?: (symbol: string) => Promise<boolean>;
}): Promise<CacheSnapshot> {
  const directory = await (options.fetchSupportedLts ?? fetchSupportedLts)();
  if (directory.length === 0) {
    // No directory entries means the BounceTech API is down or we got an
    // empty payload. Don't clobber a previously-populated cache.
    if (cache) return cache;
    const empty: CacheSnapshot = {
      liveAddresses: new Set(),
      liveSymbols: new Set(),
      liveUnderlyings: new Set(),
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    cache = empty;
    return empty;
  }

  const checker = options.checkSymbolLive ?? defaultSymbolChecker;

  // Bound concurrent HEAD requests so a slow BounceTech doesn't pin a
  // dozen subrequests at once. The supported-directory size sits in the
  // low tens, so a 5-wide pool finishes in 4-5 batches at most.
  const liveSymbols = new Set<string>();
  const liveAddresses = new Set<string>();
  const liveUnderlyings = new Set<string>();
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < directory.length) {
      const idx = cursor++;
      const lt = directory[idx];
      let live: boolean;
      try {
        live = await checker(lt.symbol);
      } catch {
        // Fail open. See the file-level docstring — a HEAD that throws
        // (network blip, CDN edge timeout) should not flip a previously
        // live LT to hidden.
        live = true;
      }
      if (live) {
        liveSymbols.add(lt.symbol);
        liveAddresses.add(lt.address.toLowerCase());
        liveUnderlyings.add(lt.targetAsset);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(HEAD_CONCURRENCY, directory.length) },
    () => worker(),
  );
  await Promise.all(workers);

  const snapshot: CacheSnapshot = {
    liveAddresses,
    liveSymbols,
    liveUnderlyings,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  cache = snapshot;
  return snapshot;
}

/**
 * Pull the BounceTech LT directory (subset Alt Fun supports) for HEAD-
 * checking. Mirrors the same `filterSupportedLTs` call sites in
 * `routes/assets.ts` and `lib/token-registration.ts` so the live filter
 * never has to evaluate an LT we don't support anyway.
 *
 * Throws on any non-OK status so the snapshot's `fail-open` path (an
 * empty result with `fresh: true` would otherwise hide every LT) kicks
 * in instead. The caller treats `null` returned from this throw as
 * "unknown — degrade gracefully and show everything" rather than
 * "BounceTech returned an empty list, hide everything".
 */
async function fetchSupportedLts(): Promise<LiveLeveragedToken[]> {
  const res = await fetch(`${BOUNCE_INDEXING_API}/leveraged-tokens`);
  if (!res.ok) {
    throw new Error(
      `BounceTech LT directory unavailable: HTTP ${res.status}`,
    );
  }
  const json = (await res.json()) as { data?: LiveLeveragedToken[] };
  return filterSupportedLTs(json.data ?? []);
}

async function defaultSymbolChecker(symbol: string): Promise<boolean> {
  const url = getBounceLtImageUrl(symbol);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (res.ok) return true;
    // 404 is the only "definitively not live" status — BounceTech's
    // CDN doesn't host the logo because the LT isn't published yet.
    // Every other non-2xx (403 from auth misconfig, 429 from rate-
    // limits, 5xx from CDN edge failures) is a transient state we
    // shouldn't punish users for: fail open and treat the LT as live.
    if (res.status === 404) return false;
    return true;
  } catch {
    // Network / abort — caller's `try/catch` already flips this to "live".
    throw new Error("HEAD failed");
  } finally {
    clearTimeout(timer);
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Operation timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
