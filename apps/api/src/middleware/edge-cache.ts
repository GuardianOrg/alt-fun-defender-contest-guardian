import type { Context, Next } from "hono";

import {
  isRevalidationRequest,
  matchSwr,
  revalidateInBackground,
} from "../utils/swr-cache.js";

import type { AppBindings } from "../lib/types.js";

/**
 * Pre-auth edge-cache lookup. Mounted *before* {@link apiKeyAuth} so a
 * cache hit returns immediately without consuming a per-IP rate-limit
 * slot.
 *
 * Why this exists (issue #549): aggregated read routes (`/api/v1/tokens`,
 * `/api/v1/tokens/:address`, `/api/v1/market-data`, `/api/v1/trades*`)
 * already write their responses to `caches.default` with a short TTL.
 * Until now the cache lookup ran *inside* the route handler — after
 * `apiKeyAuth` had already debited the limiter. That made the anon
 * limit (60 req/min) collapse for any shared-IP scenario: e.g. six
 * teammates on one office WiFi each polling `/tokens` every 10s
 * generate ~120 req/min collectively and get 429'd two-thirds of the
 * time, even though every miss after the first 5-second window is a
 * cache hit. Moving the lookup pre-auth means a hot cache entry fans
 * out for free until it expires, which is the behaviour the existing
 * `s-maxage=5..30` headers always *implied* at the edge.
 *
 * Stale-while-revalidate (issue #1082): when the canonical entry has
 * expired but a stale-fallback copy is still in cache (written by
 * `putWithSwr` alongside the canonical entry), we serve the stale body
 * immediately and schedule a background self-fetch via `waitUntil`.
 * The self-fetch carries the SWR revalidation header so this
 * middleware skips its lookup and the request reaches the route
 * handler — which then writes a fresh canonical + stale pair. Net:
 * only the unlucky request that lands *past the full SWR window*
 * (canonical TTL + SWR seconds) pays the cold path; everything inside
 * the window gets a sub-millisecond stale serve. The
 * `stale-while-revalidate=…` directive on `edgeCacheableJsonHeader`
 * responses was previously a header-only declaration — the Workers
 * Cache API ignores SWR for retention, so `putWithSwr` writes the
 * longer-lived sibling copy that makes the directive actually take
 * effect.
 *
 * Scope:
 *   - GET only. Writes (POST/PUT/PATCH/DELETE) always run the full
 *     middleware chain so an admin or registration call is never
 *     silently served from a stale cache.
 *   - No-op when no `caches.default` is available (some test
 *     environments) — falls through to the normal chain.
 *   - Routes still need to call `putWithSwr` (or the legacy
 *     `caches.default.put`) themselves; this middleware only reads.
 *     The route is the source of truth for what's cacheable and at
 *     what TTL.
 *   - The SWR self-fetch bypasses this middleware via the marker
 *     header, so a stale entry never sees the refresh path re-serve
 *     itself.
 */
export async function serveFromEdgeCache(
  c: Context<{ Bindings: AppBindings }>,
  next: Next,
) {
  if (c.req.method !== "GET") {
    await next();
    return;
  }
  // The SWR background self-fetch must reach the route handler so it
  // can write a fresh entry — short-circuiting here would just re-serve
  // the stale body we already returned to the user.
  if (isRevalidationRequest(c)) {
    await next();
    return;
  }
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!cache) {
    await next();
    return;
  }
  const cacheKey = new Request(c.req.url, { method: "GET" });
  const result = await matchSwr(cache, cacheKey);
  if (result.kind === "fresh") return result.response;
  if (result.kind === "stale") {
    // `executionCtx` is undefined in some test entry points (when
    // `app.request` is called without an explicit ctx). Skipping the
    // refresh in that case just means the next caller eats a cold
    // path — strictly correct, just not the optimised case the prod
    // worker runs.
    c.executionCtx?.waitUntil(revalidateInBackground(c));
    return result.response;
  }
  await next();
}
