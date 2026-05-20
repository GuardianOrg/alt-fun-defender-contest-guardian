import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";

import { createDb } from "../db/client.js";
import { apiKeys } from "../db/schema.js";
import { extractPrefix, hashApiKey, constantTimeEqual } from "../utils/api-key-hash.js";
import type { AppBindings } from "../lib/types.js";

interface RateWindow {
  count: number;
  resetAt: number;
}

// Per-isolate rate limiter. Not shared across isolates/regions — adequate for v1,
// but should move to Durable Objects or KV for strict global enforcement.
const rateLimitMap = new Map<number, RateWindow>();
const anonRateLimitMap = new Map<string, RateWindow>();
const WINDOW_MS = 60_000;
/**
 * Per-IP, per-minute anonymous request ceiling.
 *
 * Calibrated for the realistic shared-IP case, not one-browser-per-IP.
 * NAT'd offices, conferences, dev houses, and university WiFi routinely
 * fan ~6 active sessions through a single egress IP; the frontend's
 * polling cadence (10s tokens, 5s holders/earnings, 15s trades) plus
 * the trade-feed fallback puts each session at ~25–30 req/min, so six
 * teammates ≈ 150–180 req/min before any spike. The previous ceiling
 * of 60 collapsed instantly in that scenario (issue #549). 240 leaves
 * comfortable headroom while still tripping on an actual abuse pattern
 * (a single client making 4+ req/sec sustained for a minute).
 *
 * Note: the pre-auth `serveFromEdgeCache` middleware (see
 * `middleware/edge-cache.ts`) lets cache hits bypass this ceiling
 * entirely, so the steady-state path for the read-heavy endpoints
 * (`/tokens`, `/market-data`, `/trades*`) is "one rate-limited miss
 * per TTL, free hits for everyone else on the same IP until it
 * expires". This number is the budget for *misses*, not gross
 * requests.
 */
const ANON_RATE_LIMIT = 240;
let lastPurge = Date.now();

function purgeExpiredWindows() {
  const now = Date.now();
  if (now - lastPurge < WINDOW_MS) return;
  lastPurge = now;
  for (const [id, window] of rateLimitMap) {
    if (now >= window.resetAt) rateLimitMap.delete(id);
  }
  for (const [ip, window] of anonRateLimitMap) {
    if (now >= window.resetAt) anonRateLimitMap.delete(ip);
  }
}

export async function apiKeyAuth(c: Context<{ Bindings: AppBindings }>, next: Next) {
  const headerKey = c.req.header("X-API-Key");
  if (!headerKey) {
    // Local dev escape hatch: when running under `wrangler dev` the API is
    // hit directly from the local frontend (and from curl) and Miniflare
    // populates `CF-Connecting-IP` with the loopback address, which would
    // otherwise bucket every tab + every WS reconnect + every chart
    // refresh under a single key and 429 within seconds of opening the
    // app. Detect dev via the `Host` header (impossible to spoof in
    // production — Cloudflare rewrites it to the deployed worker host)
    // and skip the limiter. Production traffic is unaffected.
    const host = (c.req.header("Host") ?? "").toLowerCase();
    const isDevHost =
      host.startsWith("localhost") ||
      host.startsWith("127.0.0.1") ||
      host.startsWith("[::1]") ||
      host.startsWith("0.0.0.0");
    if (isDevHost) {
      await next();
      return;
    }

    purgeExpiredWindows();

    const ip =
      c.req.header("CF-Connecting-IP") ??
      c.req.header("X-Forwarded-For") ??
      "unknown";
    const now = Date.now();
    let window = anonRateLimitMap.get(ip);
    if (!window || now >= window.resetAt) {
      window = { count: 0, resetAt: now + WINDOW_MS };
      anonRateLimitMap.set(ip, window);
    }

    window.count++;
    if (window.count > ANON_RATE_LIMIT) {
      c.header("Retry-After", String(Math.ceil((window.resetAt - now) / 1000)));
      return c.json({ status: "error", error: "Rate limit exceeded", data: null }, 429);
    }

    await next();
    return;
  }

  const prefix = extractPrefix(headerKey);
  const keyHash = await hashApiKey(headerKey);
  const db = createDb(c.env.DATABASE_URL);
  const candidates = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyPrefix, prefix));

  let matchedRow: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) {
    if (constantTimeEqual(keyHash, candidate.keyHash)) {
      matchedRow = candidate;
      break;
    }
  }

  if (!matchedRow) {
    return c.json({ status: "error", error: "Invalid API key", data: null }, 401);
  }

  if (!matchedRow.isActive) {
    return c.json({ status: "error", error: "API key is deactivated", data: null }, 403);
  }

  purgeExpiredWindows();

  const now = Date.now();
  let window = rateLimitMap.get(matchedRow.id);
  if (!window || now >= window.resetAt) {
    window = { count: 0, resetAt: now + WINDOW_MS };
    rateLimitMap.set(matchedRow.id, window);
  }

  window.count++;
  if (window.count > matchedRow.rateLimit) {
    c.header("Retry-After", String(Math.ceil((window.resetAt - now) / 1000)));
    return c.json({ status: "error", error: "Rate limit exceeded", data: null }, 429);
  }

  await next();
}
