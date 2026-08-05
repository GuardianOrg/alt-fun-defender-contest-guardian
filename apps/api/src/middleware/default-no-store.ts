import type { Context, Next } from "hono";

import { CDN_CACHE_CONTROL_HEADER } from "../utils/cache-control.js";

import type { AppBindings } from "../lib/types.js";

/**
 * Default every response that didn't opt in to caching to `no-store`,
 * on both the standard and the Cloudflare-specific header.
 *
 * `cache.enabled` in `wrangler.json` is a Worker-wide setting — it can't
 * be scoped to the routes that want caching. A response carrying no
 * cache directive at all is therefore at the mercy of whatever default
 * the platform applies (Cloudflare's documented status-code defaults are
 * 2h for a 200, 3m for a 404). That would be a disclosure bug, not just
 * a staleness one: `GET /api/v1/admin/api-keys` returns key metadata and
 * is gated by `adminAuth` *inside* the admin router, so a zone-cached
 * copy keyed on the URL could be re-served to a caller with no
 * `X-Admin-Key` without the Worker ever running.
 *
 * Rather than depend on what the platform does with a headerless
 * response, say it explicitly: opt in via `utils/cache-control.ts`, or
 * you are `no-store`. Mirrors the opt-in map the sibling `bounce-data`
 * API uses for the same reason.
 */
export async function defaultNoStore(
  c: Context<{ Bindings: AppBindings }>,
  next: Next,
) {
  await next();
  // A WebSocket upgrade has no mutable headers — touching them throws.
  if (c.res.status === 101 || c.res.webSocket) return;
  // Anything that already declared a policy owns it, including the
  // deliberate `private, no-store` on wallet-aware token detail.
  if (c.res.headers.has("Cache-Control")) return;
  c.res.headers.set("Cache-Control", "no-store");
  c.res.headers.set(CDN_CACHE_CONTROL_HEADER, "no-store");
}
