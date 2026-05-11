import type { Context, Next } from "hono";

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
 * Scope:
 *   - GET only. Writes (POST/PUT/PATCH/DELETE) always run the full
 *     middleware chain so an admin or registration call is never
 *     silently served from a stale cache.
 *   - No-op when no `caches.default` is available (some test
 *     environments) — falls through to the normal chain.
 *   - Routes still need to call `caches.default.put()` themselves;
 *     this middleware only reads. The route is the source of truth for
 *     what's cacheable and at what TTL.
 */
export async function serveFromEdgeCache(
  c: Context<{ Bindings: AppBindings }>,
  next: Next,
) {
  if (c.req.method !== "GET") {
    await next();
    return;
  }
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!cache) {
    await next();
    return;
  }
  const cacheKey = new Request(c.req.url, { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  await next();
}
