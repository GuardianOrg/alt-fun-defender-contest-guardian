/**
 * "Is this LT live on BounceTech's public UI?" oracle (issue #621).
 *
 * BounceTech deploys leveraged tokens to chain the moment they're spun
 * up, often days before the team finishes testing them and publishes them
 * in their own web app. For those days the LT exists everywhere we look
 * (our `lt_directory` Postgres mirror of the on-chain helper, on-chain)
 * but isn't a "real" launch yet — we don't want it surfacing in Alt Fun's
 * markets sidebar, asset tape, pair selector, or token feed.
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
  getBounceLtImageUrl,
  type LiveLeveragedToken,
} from "@launchpad/shared";

import { readSupportedLtDirectory } from "./lt-directory-reads.js";

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
  /**
   * Lowercased LT contract addresses present in BounceTech's
   * `/leveraged-tokens` directory (filtered to our supported set —
   * `filterSupportedLTs`). Populated from the directory fetch
   * regardless of whether the per-symbol logo HEAD check succeeded,
   * so this set distinguishes:
   *
   *   - "LT exists at BounceTech but they haven't uploaded a logo yet" —
   *     `directoryAddresses` has it, `liveAddresses` doesn't. The token
   *     listing endpoint uses this set so creator-launched tokens never
   *     vanish just because BounceTech hasn't published the per-LT PNG
   *     (which can lag the on-chain launch by days, and can flicker
   *     in/out when BounceTech rolls a new SPA build whose fallback HTML
   *     trips our `content-type !== image/*` check).
   *
   *   - "LT was completely removed from BounceTech's directory" —
   *     neither set has it. Both the pair selector AND the token
   *     listing should still hide it, since the LT is genuinely retired.
   *
   * The strict `liveAddresses` view (logo-uploaded) is still used by
   * `/api/v1/assets` so the creation flow / pair selector / asset tape
   * don't expose users to LTs BounceTech hasn't finished publishing.
   */
  directoryAddresses: Set<string>;
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
   * Lowercased LT addresses present in BounceTech's `/leveraged-tokens`
   * directory (subset filtered to our supported set), regardless of whether
   * BounceTech has uploaded the per-symbol logo PNG. Strictly a superset of
   * `liveAddresses` while the directory fetch is fresh. The token listing
   * uses this looser set so creator-launched tokens stay visible during the
   * window between an LT being launched on-chain and BounceTech finishing
   * its public publish; see the docstring on `CacheSnapshot.directoryAddresses`
   * for the full rationale.
   */
  directoryAddresses: ReadonlySet<string>;
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
      directoryAddresses: cache.directoryAddresses,
      fresh: true,
    };
  }
  if (cache) {
    // Stale but better than nothing — clients still get a real filter.
    return {
      liveAddresses: cache.liveAddresses,
      liveSymbols: cache.liveSymbols,
      liveUnderlyings: cache.liveUnderlyings,
      directoryAddresses: cache.directoryAddresses,
      fresh: false,
    };
  }
  return {
    liveAddresses: new Set<string>(),
    liveSymbols: new Set<string>(),
    liveUnderlyings: new Set<string>(),
    directoryAddresses: new Set<string>(),
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
 * LT directory from the local `lt_directory` Postgres mirror (kept fresh
 * by the on-chain `LtDirectoryPoller`) and HEAD-checks each LT's logo.
 */
export async function getLiveLtAvailability(options: {
  /**
   * Required when no `fetchSupportedLts` override is supplied. Threaded
   * through to the default `readSupportedLtDirectory` reader.
   */
  databaseUrl?: string;
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
      directoryAddresses: cache.directoryAddresses,
      fresh: true,
    };
  }

  const snapshot = await ensureRefresh(options);
  return {
    liveAddresses: snapshot.liveAddresses,
    liveSymbols: snapshot.liveSymbols,
    liveUnderlyings: snapshot.liveUnderlyings,
    directoryAddresses: snapshot.directoryAddresses,
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
  databaseUrl?: string;
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
  databaseUrl?: string;
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
  databaseUrl?: string;
  fetchSupportedLts?: () => Promise<LiveLeveragedToken[]>;
  checkSymbolLive?: (symbol: string) => Promise<boolean>;
}): Promise<CacheSnapshot> {
  const fetcher =
    options.fetchSupportedLts ?? (() => fetchSupportedLts(options.databaseUrl));
  const directory = await fetcher();
  if (directory.length === 0) {
    // No directory entries means the `lt_directory` mirror is empty
    // (cold start, poller hasn't run yet). Don't clobber a previously-
    // populated cache, and don't store the empty snapshot to the
    // module cache either — caching `{}` as "fresh" for `CACHE_TTL_MS`
    // would make every request behave as fresh-empty for the next 5
    // minutes even after the poller backfills. Return a transient
    // empty snapshot whose `expiresAt: 0` guarantees the next call
    // re-attempts the refresh immediately. CodeRabbit caught this on
    // PR #972 review.
    if (cache) return cache;
    return {
      liveAddresses: new Set(),
      liveSymbols: new Set(),
      liveUnderlyings: new Set(),
      directoryAddresses: new Set(),
      expiresAt: 0,
    };
  }

  // Populate the directory-membership set up front from the directory
  // fetch — it's the looser "this LT exists in BounceTech's directory,
  // even if they haven't uploaded a logo yet" signal. Snapshotting it
  // before the HEAD sweep means a slow / failing logo check can't drop
  // an LT out of this set, which is exactly what we want for the token
  // listing path: a creator-launched token should never disappear from
  // /tokens just because BounceTech hasn't published the per-symbol PNG.
  const directoryAddresses = new Set<string>();
  for (const lt of directory) {
    directoryAddresses.add(lt.address.toLowerCase());
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
    directoryAddresses,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  cache = snapshot;
  return snapshot;
}

/**
 * Pull the supported LT directory (subset Alt Fun supports) for HEAD-
 * checking, sourced from the local `lt_directory` Postgres mirror. The
 * mirror is itself filtered through `filterSupportedLTs` by
 * `readSupportedLtDirectory`, so this helper just unwraps the optional.
 *
 * Throws on a missing `databaseUrl` (programmer error — production call
 * sites always have `c.env.DATABASE_URL`) and on a DB read failure so
 * the snapshot's fail-open path kicks in instead of hiding every LT.
 */
async function fetchSupportedLts(
  databaseUrl: string | undefined,
): Promise<LiveLeveragedToken[]> {
  if (!databaseUrl) {
    throw new Error(
      "lt-availability.fetchSupportedLts requires databaseUrl when no override is provided",
    );
  }
  const directory = await readSupportedLtDirectory(databaseUrl);
  if (directory === null) {
    throw new Error("lt_directory mirror unavailable");
  }
  return directory;
}

async function defaultSymbolChecker(symbol: string): Promise<boolean> {
  const url = getBounceLtImageUrl(symbol);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_REQUEST_TIMEOUT_MS);
  try {
    // Bypass `bounce.tech`'s Fastly cache (per-POP, `max-age=14400`) on
    // every probe. Fastly serves the Next.js SPA HTML shell with HTTP 200
    // for any `/leveraged-tokens/<symbol>.png` that hasn't been uploaded
    // yet — and once a POP has cached that shell, it'll keep returning it
    // for up to 4 hours regardless of whether BounceTech subsequently
    // publishes the real PNG. Because the Worker's HEAD probes land on
    // different POPs over time (Cloudflare egress IPs aren't sticky), the
    // live filter would otherwise hide a token for an indeterminate
    // window after BounceTech uploads its LT logo — long enough to be
    // visible to creators ("I launched a token, where is it?"). Sending
    // `Cache-Control: no-cache` forces Fastly to revalidate with origin
    // on every probe, so the cron's 1-minute refresh cycle becomes the
    // actual upper bound on staleness. Cost is ~36 LTs/min of origin
    // revalidations — well inside any reasonable CDN tolerance and
    // strictly worth it for the UX win. See PR for OILBARRON/#621 thread.
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
    // 404 is the one definitive "not published" status (BounceTech CDN
    // truly has no asset at this path). Every other non-2xx (403, 429,
    // 5xx) is a transient outage class — fail open.
    if (!res.ok) {
      if (res.status === 404) return false;
      return true;
    }
    // `res.ok` alone is NOT enough: bounce.tech is a SPA and serves
    // its HTML shell (with a 200 status) for **every** URL that doesn't
    // match a static asset, including `/leveraged-tokens/<unknown>.png`.
    // The only way to tell a real published logo from the SPA-fallback
    // shell is the `Content-Type` header — a real PNG comes back as
    // `image/png` (with `Content-Length` and a numeric body), the SPA
    // fallback comes back as `text/html`. Without this gate the live
    // filter is permanently no-op'd because every `HEAD` returns 200.
    const contentType = res.headers.get("content-type") ?? "";
    return contentType.toLowerCase().startsWith("image/");
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
