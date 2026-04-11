import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";

import { createDb } from "../db/client.js";
import { apiKeys } from "../db/schema.js";
import type { AppBindings } from "../lib/types.js";

interface RateWindow {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<number, RateWindow>();
const WINDOW_MS = 60_000;

export async function apiKeyAuth(c: Context<{ Bindings: AppBindings }>, next: Next) {
  const headerKey = c.req.header("X-API-Key");
  if (!headerKey) {
    await next();
    return;
  }

  const db = createDb(c.env.DATABASE_URL);
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.key, headerKey))
    .limit(1);

  if (!row) {
    return c.json({ status: "error", error: "Invalid API key", data: null }, 401);
  }

  if (!row.isActive) {
    return c.json({ status: "error", error: "API key is deactivated", data: null }, 403);
  }

  const now = Date.now();
  let window = rateLimitMap.get(row.id);
  if (!window || now >= window.resetAt) {
    window = { count: 0, resetAt: now + WINDOW_MS };
    rateLimitMap.set(row.id, window);
  }

  window.count++;
  if (window.count > row.rateLimit) {
    c.header("Retry-After", String(Math.ceil((window.resetAt - now) / 1000)));
    return c.json({ status: "error", error: "Rate limit exceeded", data: null }, 429);
  }

  await next();
}
