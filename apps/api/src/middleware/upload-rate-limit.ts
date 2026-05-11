import type { Context, Next } from "hono";

import formatError from "../utils/format-error.js";
import type { AppBindings } from "../lib/types.js";

/**
 * Per-IP write-quota limiter for the image upload route.
 *
 * This is a defensive fallback layer behind the primary Cloudflare edge
 * rate-limit rule (tracked separately as infra-only work). It exists for
 * two cases:
 *
 *   1. Production: the edge rule is missing or misconfigured — this
 *      limiter still caps abusive bursts before they reach OpenAI / R2 /
 *      Neon (each upload is an OpenAI moderation call + R2 PUT + Neon
 *      insert, so the per-request cost is high enough to want a second
 *      seatbelt).
 *   2. Local dev: `wrangler dev` doesn't apply Cloudflare-edge rate-limit
 *      rules, so without an in-Worker limit a single misbehaving script
 *      can drain OpenAI free-tier quota in seconds.
 *
 * Deliberately looser than the planned edge rule so this only fires when
 * the edge layer is missing/misconfigured. Map-based, per-isolate — same
 * shape as the anon limiter in `api-key-auth.ts` and bounded by the same
 * `purgeExpiredWindows` pattern. Not shared across isolates/regions; that
 * is acceptable for a fallback layer.
 *
 * See issue #509.
 */

interface RateWindow {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const UPLOAD_RATE_LIMIT = 10; // requests per minute per IP

const uploadRateLimitMap = new Map<string, RateWindow>();
let lastPurge = Date.now();

function purgeExpiredWindows() {
  const now = Date.now();
  if (now - lastPurge < WINDOW_MS) return;
  lastPurge = now;
  for (const [ip, window] of uploadRateLimitMap) {
    if (now >= window.resetAt) uploadRateLimitMap.delete(ip);
  }
}

/** Exposed for tests so each case starts with a clean slate. */
export function __resetUploadRateLimitForTests(): void {
  uploadRateLimitMap.clear();
  lastPurge = Date.now();
}

export async function uploadIpRateLimit(
  c: Context<{ Bindings: AppBindings }>,
  next: Next,
) {
  // Mirror the local-dev bypass used by `apiKeyAuth`: under `wrangler dev`
  // Miniflare populates `CF-Connecting-IP` with a loopback address, which
  // would otherwise bucket every test/dev session under a single key.
  // Detect dev via the `Host` header (Cloudflare rewrites it to the
  // deployed worker host in production, so this is impossible to spoof).
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
  let window = uploadRateLimitMap.get(ip);
  if (!window || now >= window.resetAt) {
    window = { count: 0, resetAt: now + WINDOW_MS };
    uploadRateLimitMap.set(ip, window);
  }

  window.count++;
  if (window.count > UPLOAD_RATE_LIMIT) {
    c.header("Retry-After", String(Math.ceil((window.resetAt - now) / 1000)));
    return c.json(formatError("Rate limit exceeded"), 429);
  }

  await next();
}
