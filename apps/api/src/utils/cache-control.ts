/**
 * Cache directives for edge-cacheable responses on this API.
 *
 * Every cacheable response carries TWO directives, because two different
 * caches read two different headers:
 *
 *   - `Cache-Control` — the browser tier, plus the Worker's own
 *     `caches.default` binding (which evicts strictly on `s-maxage`).
 *   - `Cloudflare-CDN-Cache-Control` — the Cloudflare zone cache, which
 *     reads this in preference to `Cache-Control` and strips it before
 *     the response leaves the edge.
 *
 * **`s-maxage` alone does not admit a Worker response to Cloudflare's
 * cache.** Nine routes declaring `s-maxage` were measured in production
 * returning no `cf-cache-status` header at all; the zone needs its own
 * directive plus `cache.enabled` in `wrangler.json` to engage.
 *
 * Wallet- or session-aware responses MUST NOT use these helpers — they
 * need `private, no-store, max-age=0, s-maxage=0` so no shared cache can
 * re-serve one user's body to another (see `routes/tokens/detail.ts`).
 *
 * Every TTL literal in this API lives in this file, enforced by
 * `src/__tests__/cache-header-coverage.test.ts`.
 */

/** Header the Cloudflare zone cache reads in preference to `Cache-Control`. */
export const CDN_CACHE_CONTROL_HEADER = "Cloudflare-CDN-Cache-Control";

/** One year, for content-addressed blobs that can never change. */
const IMMUTABLE_ASSET_MAX_AGE_SECONDS = 31_536_000;

const IMMUTABLE_ASSET_DIRECTIVE = `public, max-age=${IMMUTABLE_ASSET_MAX_AGE_SECONDS}, immutable`;

/** Default stale window: twice the fresh window, the project convention. */
function defaultSwr(ttlSeconds: number): number {
  return ttlSeconds * 2;
}

/**
 * Browser- and Worker-tier directive.
 *
 * `max-age=0` is load-bearing: a response carrying only `s-maxage` has
 * undefined freshness for the browser, which RFC 9111 §4.2.2 lets it
 * heuristically cache for minutes or hours. That's what produced the
 * "only `Delete browsing data` shows new tokens" bug on the home-page
 * list.
 *
 * `stale-while-revalidate` must stay HERE and not move to the zone
 * directive alone: {@link putWithSwr} parses it off `Cache-Control` to
 * size the stale-fallback entry it writes to `caches.default`. Drop it
 * and that whole Worker-side layer silently degrades to a single put.
 */
export function edgeCacheableJsonHeader(
  ttlSeconds: number,
  swrSeconds: number = defaultSwr(ttlSeconds),
): string {
  return `public, max-age=0, s-maxage=${ttlSeconds}, stale-while-revalidate=${swrSeconds}`;
}

/**
 * Zone-tier directive. Uses `max-age` rather than `s-maxage` because
 * Cloudflare disables its own stale-while-revalidate when `s-maxage` is
 * present — the reason the `stale-while-revalidate` we already declared
 * never took effect at the zone.
 */
export function cdnEdgeCacheHeader(
  ttlSeconds: number,
  swrSeconds: number = defaultSwr(ttlSeconds),
): string {
  return `public, max-age=${ttlSeconds}, stale-while-revalidate=${swrSeconds}`;
}

/**
 * Stamp both directives on a Hono context, for handlers that call
 * `c.header(...)` before building their response.
 */
export function setEdgeCacheHeaders(
  c: { header: (key: string, value: string) => void },
  ttlSeconds: number,
  swrSeconds: number = defaultSwr(ttlSeconds),
): void {
  c.header("Cache-Control", edgeCacheableJsonHeader(ttlSeconds, swrSeconds));
  c.header(CDN_CACHE_CONTROL_HEADER, cdnEdgeCacheHeader(ttlSeconds, swrSeconds));
}

/**
 * Stamp both directives on an already-built `Response`, for handlers
 * that need the response object in hand (e.g. to write it to
 * `caches.default`).
 */
export function applyEdgeCacheHeaders(
  response: Response,
  ttlSeconds: number,
  swrSeconds: number = defaultSwr(ttlSeconds),
): Response {
  response.headers.set(
    "Cache-Control",
    edgeCacheableJsonHeader(ttlSeconds, swrSeconds),
  );
  response.headers.set(
    CDN_CACHE_CONTROL_HEADER,
    cdnEdgeCacheHeader(ttlSeconds, swrSeconds),
  );
  return response;
}

/**
 * `Cache-Control` for the stale-fallback sibling {@link putWithSwr}
 * writes to `caches.default`. `totalSeconds` is the route's TTL plus its
 * stale window, because the Workers cache evicts strictly on `s-maxage`
 * and that sum is what keeps the fallback alive for the whole SWR
 * window. No `stale-while-revalidate` of its own — this body is already
 * past freshness — and the caller pairs it with a `no-store` zone
 * directive so the stretched value never becomes a zone policy.
 */
export function staleFallbackHeader(totalSeconds: number): string {
  return `public, max-age=0, s-maxage=${totalSeconds}`;
}

/**
 * Directives for a content-addressed asset that can never change. Here
 * the browser tier gets the full year too — the key embeds a UUID, so a
 * changed image is a different URL.
 */
export function setImmutableAssetHeaders(c: {
  header: (key: string, value: string) => void;
}): void {
  c.header("Cache-Control", IMMUTABLE_ASSET_DIRECTIVE);
  c.header(CDN_CACHE_CONTROL_HEADER, IMMUTABLE_ASSET_DIRECTIVE);
}
