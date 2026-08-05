import type { Context, Next } from "hono";

import { CDN_CACHE_CONTROL_HEADER } from "../utils/cache-control.js";

import type { AppBindings } from "../lib/types.js";

/**
 * TEMPORARY per-endpoint opt-out from the caching PR #1235 switched on.
 *
 * #1235 found nine read endpoints that declared a TTL but were never
 * admitted to Cloudflare's zone cache, and fixed it by emitting
 * `Cloudflare-CDN-Cache-Control` alongside `Cache-Control`. Those TTLs
 * are now live for the first time. This module exists to take any of
 * them back off individually, without reverting the header work and
 * without the all-or-nothing hammer of `cache.enabled: false` in
 * `wrangler.json` (which is Worker-wide and would also drop the
 * token list, trades and token detail — the routes carrying the actual
 * load).
 *
 * A zone-level Cloudflare Cache Rule does NOT do this job: measured on
 * 2026-08-05 against a `Bypass cache` rule matching these exact paths,
 * `/api/v1/stats` still went `cf-cache-status: MISS` then `HIT` on a
 * cache-busted key. Cache Rules govern the request path toward origin;
 * a Worker response cached via `cache.enabled` is decided by the header
 * the Worker itself emits, which is what this middleware rewrites.
 *
 * **Delete this file and its mount in `index.ts` once the
 * investigation that prompted it is over.** It is deliberately shaped
 * so that reverting is one line per endpoint.
 */

/** One entry per endpoint whose declared TTL is currently suspended. */
export type ZoneCacheOverride = {
  /** Human label, used only in tests and to make the list readable. */
  readonly label: string;
  readonly matches: (path: string) => boolean;
};

/** Matches `prefix` itself and anything below it, but not `prefixfoo`. */
function under(prefix: string): (path: string) => boolean {
  return (path) => path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * The suspended endpoints. Comment out a line to restore that
 * endpoint's caching; empty the array and the middleware is inert.
 *
 * Deliberately absent: `/api/v1/tokens` (list), `/api/v1/tokens/:addr`
 * (detail), `/api/v1/trades`, `/api/v1/chart` and
 * `/api/v1/market-data`. Those also write their responses to the
 * Worker's own `caches.default` via `utils/swr-cache.ts`, which this
 * middleware cannot undo — the write happens inside the handler,
 * before any response header rewrite. Suspending them here would
 * produce a half-off state that reads worse than either extreme. Use
 * `cache.enabled: false` if you genuinely need those off too.
 */
export const ZONE_CACHE_DISABLED_ROUTES: readonly ZoneCacheOverride[] = [
  { label: "GET /api/v1/stats", matches: under("/api/v1/stats") },
  { label: "GET /api/v1/analytics/*", matches: under("/api/v1/analytics") },
  { label: "GET /api/v1/holders/:address", matches: under("/api/v1/holders") },
  { label: "GET /api/v1/creators/*", matches: under("/api/v1/creators") },
  {
    label: "GET /api/v1/security/:address",
    matches: under("/api/v1/security"),
  },
  {
    label: "GET /api/v1/security-v2/:address",
    matches: under("/api/v1/security-v2"),
  },
  {
    label: "GET /api/v1/portfolio/:wallet",
    matches: under("/api/v1/portfolio"),
  },
  {
    label: "GET /api/v1/tokens/:address/valid",
    matches: (path) => under("/api/v1/tokens")(path) && path.endsWith("/valid"),
  },
  {
    label: "GET /api/v1/tokens/:address/meta",
    matches: (path) => under("/api/v1/tokens")(path) && path.endsWith("/meta"),
  },
  { label: "GET /images/:prefix/:key", matches: under("/images") },
  {
    label: "GET /api/v1/images/:prefix/:key",
    matches: under("/api/v1/images"),
  },
];

/** True when this request path is currently opted out of caching. */
export function isZoneCacheDisabled(path: string): boolean {
  return ZONE_CACHE_DISABLED_ROUTES.some((route) => route.matches(path));
}

/**
 * Rewrite both cache directives to `no-store` for the suspended
 * endpoints, overriding whatever the handler set.
 *
 * Both headers, not just the Cloudflare one: leaving `s-maxage` in
 * place would keep the response eligible for the Worker's own
 * `caches.default`, so `middleware/edge-cache.ts` could still re-serve
 * it pre-auth and the endpoint would look cached to anyone measuring
 * from outside. The point of the switch is that a request reaches the
 * handler every time.
 *
 * Mounted after {@link defaultNoStore} in `index.ts`, so this runs
 * first on the way out and `defaultNoStore` then sees a policy already
 * present and leaves it alone.
 */
export async function zoneCacheKillswitch(
  c: Context<{ Bindings: AppBindings }>,
  next: Next,
) {
  await next();
  if (ZONE_CACHE_DISABLED_ROUTES.length === 0) return;
  // Same guard as `default-no-store.ts`: a WebSocket upgrade has no
  // mutable headers and touching them throws.
  if (c.res.status === 101 || c.res.webSocket) return;
  if (!isZoneCacheDisabled(c.req.path)) return;
  try {
    c.res.headers.set("Cache-Control", "no-store");
    c.res.headers.set(CDN_CACHE_CONTROL_HEADER, "no-store");
  } catch {
    // A response that came straight off `fetch()` has immutable
    // headers — rewrap rather than let a 500 mask the real status.
    const headers = new Headers(c.res.headers);
    headers.set("Cache-Control", "no-store");
    headers.set(CDN_CACHE_CONTROL_HEADER, "no-store");
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    });
  }
}
