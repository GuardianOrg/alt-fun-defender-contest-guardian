import type { Context } from "hono";

import {
  CDN_CACHE_CONTROL_HEADER,
  staleFallbackHeader,
} from "./cache-control.js";

/**
 * Worker-side stale-while-revalidate for `caches.default`.
 *
 * The list/aggregate routes already ship `Cache-Control:
 * stale-while-revalidate=…` (see {@link edgeCacheableJsonHeader}), but the
 * Workers Cache API itself does not honour the SWR directive — once
 * `s-maxage` elapses, `caches.default.match()` returns `undefined`, not a
 * stale body. The directive only ever reached downstream caches (browser,
 * intermediate proxies, zone Cache Rules), so under bursty traffic the
 * Worker still paid the full cold path for the first request of every
 * 5-second window per (PoP, URL) pair.
 *
 * This module closes the gap by writing two cache entries per logical
 * key: the canonical body at `s-maxage=ttl` (what the user sees + what
 * downstream caches honour) and a sibling "stale fallback" body at
 * `s-maxage=ttl + swr*2` so the Workers cache retains it for the full
 * SWR window. `matchSwr` resolves either, and on stale hits the
 * middleware schedules a `waitUntil` self-fetch carrying the
 * {@link SWR_REVALIDATE_HEADER} marker so the next request lands fresh
 * data without making the user wait.
 *
 * Why a sibling URL rather than one entry with a longer TTL?
 *   - Downstream caches (browser/proxies) see the canonical entry's
 *     headers untouched (`s-maxage=ttl`). They never receive the longer
 *     `s-maxage` we write into the stale-key copy.
 *   - `caches.default.match` is URL-keyed; using a derived URL keeps the
 *     lookup paths cleanly separable and lets `matchSwr` know whether
 *     the response it returned was fresh or stale without parsing
 *     headers at read time.
 */

/**
 * Query-param marker appended to the cache key for the stale-fallback
 * copy. Picked to be a name nothing else in the API surface uses — see
 * `apps/api/src/routes/tokens/list.ts` for the canonical list of route
 * params. If you ever add a `?__swr_stale=…` query parameter to a real
 * route, change this sentinel.
 */
const SWR_STALE_PARAM = "__swr_stale";

/**
 * Request header set on the worker's own self-fetch when refreshing a
 * stale entry. {@link serveFromEdgeCache} recognises this marker and
 * bypasses the cache lookup so the request reaches the route handler
 * unconditionally — which then writes fresh primary + stale copies via
 * {@link putWithSwr}.
 */
export const SWR_REVALIDATE_HEADER = "X-SWR-Revalidate";

/** Result of {@link matchSwr}. */
export type SwrMatch =
  | { kind: "fresh"; response: Response }
  | { kind: "stale"; response: Response }
  | { kind: "miss" };

/**
 * Derive the stale-fallback cache key for a given primary request. The
 * stale copy lives at the same URL with an extra `?${SWR_STALE_PARAM}=1`
 * marker so the underlying URL-keyed cache stores it separately.
 */
function staleKeyFor(primary: Request): Request {
  const url = new URL(primary.url);
  url.searchParams.set(SWR_STALE_PARAM, "1");
  return new Request(url.toString(), { method: "GET" });
}

/**
 * Strip the reserved marker from a caller-supplied URL before it is used
 * as the canonical key.
 *
 * Without this, a request that already carries `?__swr_stale=1` keys
 * straight onto another URL's stale-fallback entry: the lookup treats a
 * deliberately-stretched `s-maxage` body as fresh and serves it with no
 * revalidation, and the matching write clobbers that fallback. Routes
 * ignore the parameter, so folding it away is also the semantically
 * correct key.
 */
function canonicalUrlFor(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (!url.searchParams.has(SWR_STALE_PARAM)) return rawUrl;
  url.searchParams.delete(SWR_STALE_PARAM);
  return url.toString();
}

function canonicalKeyFor(primary: Request): Request {
  const canonical = canonicalUrlFor(primary.url);
  if (canonical === primary.url) return primary;
  return new Request(canonical, { method: "GET" });
}

/**
 * Look up a cache entry under both the canonical key and the
 * stale-fallback key. Returns `fresh` only when the canonical entry is
 * still within its `s-maxage` window; falls through to `stale` while the
 * fallback copy survives; `miss` otherwise. Callers should serve `fresh`
 * directly, serve `stale` + schedule a background refresh, and run the
 * cold path on `miss`.
 */
export async function matchSwr(
  cache: Cache,
  primary: Request,
): Promise<SwrMatch> {
  const canonical = canonicalKeyFor(primary);
  const fresh = await cache.match(canonical);
  if (fresh) return { kind: "fresh", response: fresh };
  const stale = await cache.match(staleKeyFor(canonical));
  if (stale) return { kind: "stale", response: stale };
  return { kind: "miss" };
}

interface ParsedDirective {
  /** `s-maxage` seconds, or `null` when absent / unparsable. */
  sMaxAge: number | null;
  /** `stale-while-revalidate` seconds, or `null` when absent / unparsable. */
  staleWhileRevalidate: number | null;
}

/**
 * Tease apart the cache-control directives we care about. Reads
 * `Cache-Control` and never the zone directive — `caches.default`
 * evicts on `s-maxage` alone. Tolerant of
 * the variants {@link edgeCacheableJsonHeader} can emit; returns `null`
 * for any value that isn't a non-negative integer so a degenerate
 * header (`s-maxage=` empty / `s-maxage=foo`) silently disables SWR
 * rather than blowing up the response.
 */
function parseCacheControl(header: string | null): ParsedDirective {
  if (!header) return { sMaxAge: null, staleWhileRevalidate: null };
  const lower = header.toLowerCase();
  const readNonNegative = (key: string): number | null => {
    const match = lower.match(new RegExp(`(?:^|[,;\\s])${key}=(\\d+)`));
    if (!match) return null;
    const n = Number.parseInt(match[1], 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    sMaxAge: readNonNegative("s-maxage"),
    staleWhileRevalidate: readNonNegative("stale-while-revalidate"),
  };
}

/**
 * Build the stale-fallback response: same body, same status, but with a
 * `Cache-Control` header whose `s-maxage` covers the SWR window so the
 * Workers cache retains it past the canonical entry's expiry. We strip
 * `stale-while-revalidate` from the stale copy itself — `caches.default`
 * doesn't honour SWR for retention, only `s-maxage` does, and leaving
 * the directive on would just be confusing on a body that's already
 * past its freshness window.
 */
function buildStaleResponse(
  source: Response,
  sMaxAge: number,
  swr: number,
): Response {
  const headers = new Headers(source.headers);
  // `s-maxage = ttl + swr` covers the SWR window from the moment of
  // write. `caches.default` evicts strictly on `s-maxage`, so this is
  // the only knob that controls retention of the stale copy.
  headers.set("Cache-Control", staleFallbackHeader(sMaxAge + swr));
  // Explicitly `no-store` for the zone rather than merely absent: this
  // body is only ever served after its freshness window closed, and the
  // `s-maxage` above (deliberately stretched to cover the SWR window)
  // must not become a zone policy that re-admits an already-stale body
  // for another full window.
  headers.set(CDN_CACHE_CONTROL_HEADER, "no-store");
  return new Response(source.clone().body, {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}

/**
 * Cache-Control-aware `put` that writes both the canonical entry and a
 * longer-lived stale-fallback copy. The TTL split is derived from the
 * response's own `Cache-Control: s-maxage=… , stale-while-revalidate=…`
 * — typically populated via {@link edgeCacheableJsonHeader}. When
 * either directive is missing/unparsable, falls back to a single put
 * under the canonical key (matches the legacy `cache.put` behaviour).
 *
 * Callers MUST pass a response they're done reading; we clone before
 * each write but the caller still owns the original.
 */
export async function putWithSwr(
  cache: Cache,
  primary: Request,
  response: Response,
): Promise<void> {
  const { sMaxAge, staleWhileRevalidate } = parseCacheControl(
    response.headers.get("Cache-Control"),
  );
  const canonical = canonicalKeyFor(primary);
  await cache.put(canonical, response.clone());
  if (
    sMaxAge === null ||
    staleWhileRevalidate === null ||
    staleWhileRevalidate === 0
  ) {
    return;
  }
  await cache.put(
    staleKeyFor(canonical),
    buildStaleResponse(response, sMaxAge, staleWhileRevalidate),
  );
}

/**
 * Hard ceiling on the SWR refresh self-fetch. Picked well under
 * Cloudflare's 30s subrequest budget so a stuck refresh can't leak
 * `waitUntil` time across the worker invocation — same rule
 * `apps/api/AGENTS.md → Outbound timeout discipline` applies to every
 * outbound fetch from this code base. The refresh is best-effort: the
 * user already got a stale serve, so a short timeout that drops the
 * occasional hang is strictly better than letting one bad call
 * monopolise refresh slots.
 */
const REVALIDATION_TIMEOUT_MS = 8_000;

/**
 * URLs with a refresh already in flight in this isolate.
 *
 * Every stale serve schedules its own refresh, so a burst arriving at one
 * TTL boundary would otherwise fan out into N concurrent cold paths for
 * the same URL — the exact stampede the cache exists to prevent, and
 * worst on the routes whose cold path is slowest. It also let a slower
 * older refresh land after a newer one and overwrite it. One refresh per
 * URL at a time fixes both; the entry is dropped in `finally` so a
 * failure doesn't wedge future refreshes.
 */
const revalidationsInFlight = new Set<string>();

/** Test-only: clear in-flight refresh tracking between cases. */
export function _resetRevalidationTracking(): void {
  revalidationsInFlight.clear();
}

/**
 * Trigger a background self-fetch to refresh a stale entry. The
 * request mirrors the original URL but carries
 * {@link SWR_REVALIDATE_HEADER} so the edge-cache middleware skips its
 * cache lookup and lets the request reach the route handler. The route
 * runs the cold path and writes both fresh + stale copies via
 * {@link putWithSwr}.
 *
 * Hard-capped at {@link REVALIDATION_TIMEOUT_MS} via an
 * {@link AbortController}: an unbounded refresh would eat the worker's
 * subrequest budget and `waitUntil` allowance — see the
 * `apps/api/AGENTS.md → Outbound timeout discipline` table for the
 * matching rule on user-path fetches. The user has already received
 * the stale body by the time this runs, so an abort just means the
 * next caller eats one extra stale serve before a successful refresh.
 *
 * Errors (including {@link AbortError}) are swallowed: this runs
 * inside `waitUntil`, so a refresh failure must not poison the
 * user-facing stale response that's already been returned. The next
 * user hit just gets another stale serve with another refresh attempt.
 */
export async function revalidateInBackground(c: Context): Promise<void> {
  // Keyed on the canonical URL, matching what the cache reads and writes.
  // Keying on the raw URL would let `?__swr_stale=1`, `=2`, … each start
  // their own refresh of one shared entry, walking straight past the
  // single-flight guard. Refreshing that URL too keeps the origin read on
  // the canonical entry.
  const key = canonicalUrlFor(c.req.url);
  if (revalidationsInFlight.has(key)) return;
  revalidationsInFlight.add(key);

  const headers = new Headers(c.req.raw.headers);
  headers.set(SWR_REVALIDATE_HEADER, "1");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVALIDATION_TIMEOUT_MS);
  try {
    await fetch(
      new Request(key, {
        method: "GET",
        headers,
        signal: controller.signal,
      }),
    );
  } catch {
    // Background refresh — failures (including AbortError on timeout)
    // are absorbed. See JSDoc.
  } finally {
    clearTimeout(timer);
    revalidationsInFlight.delete(key);
  }
}

/**
 * True when the incoming request is the SWR refresh self-fetch. Used by
 * {@link serveFromEdgeCache} to bypass the cache and force the cold
 * path through the route handler.
 */
export function isRevalidationRequest(c: Context): boolean {
  return c.req.header(SWR_REVALIDATE_HEADER) === "1";
}
