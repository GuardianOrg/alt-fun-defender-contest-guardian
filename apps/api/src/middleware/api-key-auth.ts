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
const ANON_RATE_LIMIT = 60; // requests per minute for anonymous traffic
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
    purgeExpiredWindows();

    const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For") ?? "unknown";
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
