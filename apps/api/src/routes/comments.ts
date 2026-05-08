import { buildSessionMessage, SESSION_DURATION_MS } from "@launchpad/shared";
import { eq, desc } from "drizzle-orm";
import { Hono } from "hono";
import { getAddress, isAddress, recoverMessageAddress } from "viem";
import { z } from "zod";

import { createDb } from "../db/client.js";
import { comments } from "../db/schema.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { zodValidator } from "../utils/validation.js";

import type { AppBindings } from "../lib/types.js";

function parseNonNegativeInt(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

const COMMENT_RATE_LIMIT_MS = 3_000;
// Per-isolate rate limiter. Not shared across isolates/regions — adequate for
// v1, but should move to Durable Objects or KV for strict global enforcement
// (an attacker can multiply throughput by issuing requests across CF regions).
const commentRateLimit = new Map<string, number>();
// Hard cap on map size to bound memory under a burst of unique (author, token)
// pairs arriving inside a single rate-limit window (where `purgeExpiredEntries`
// has nothing to evict). When exceeded, the oldest insertion is dropped — Map
// preserves insertion order, so `keys().next()` returns the oldest key.
const COMMENT_RATE_LIMIT_MAX_ENTRIES = 10_000;
let lastCommentRateLimitPurge = Date.now();

function purgeExpiredCommentRateLimits(now: number) {
  if (now - lastCommentRateLimitPurge < COMMENT_RATE_LIMIT_MS) return;
  lastCommentRateLimitPurge = now;
  for (const [key, lastCommentAt] of commentRateLimit) {
    if (now - lastCommentAt >= COMMENT_RATE_LIMIT_MS) {
      commentRateLimit.delete(key);
    }
  }
}

function recordCommentRateLimit(key: string, now: number) {
  commentRateLimit.set(key, now);
  while (commentRateLimit.size > COMMENT_RATE_LIMIT_MAX_ENTRIES) {
    const oldestKey = commentRateLimit.keys().next().value;
    if (oldestKey === undefined) break;
    commentRateLimit.delete(oldestKey);
  }
}

const createCommentSchema = z.object({
  author: z.string().refine(isAddress, "Invalid author address"),
  content: z
    .string()
    .min(1, "Content is required")
    .max(500, "Comment too long (max 500 chars)"),
  signature: z.string().min(1, "Signature is required"),
  expiresAt: z.number().finite("Invalid expiresAt"),
});

const commentsRoute = new Hono<{ Bindings: AppBindings }>();

commentsRoute.get("/:address/comments", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const tokenAddress = getAddress(rawAddress);

  const limitParam = parseNonNegativeInt(c.req.query("limit"));
  const offsetParam = parseNonNegativeInt(c.req.query("offset"));
  if (limitParam === null || offsetParam === null) {
    return c.json(formatError("Invalid pagination parameters"), 400);
  }
  const limit = Math.min(limitParam ?? 50, 100);
  const offset = offsetParam ?? 0;

  const db = createDb(c.env.DATABASE_URL);
  const items = await db
    .select()
    .from(comments)
    .where(eq(comments.tokenAddress, tokenAddress))
    .orderBy(desc(comments.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json(formatSuccess(items));
});

commentsRoute.post(
  "/:address/comments",
  zodValidator("json", createCommentSchema),
  async (c) => {
    const rawTokenAddress = c.req.param("address");
    if (!isAddress(rawTokenAddress)) {
      return c.json(formatError("Invalid address"), 400);
    }
    const tokenAddress = getAddress(rawTokenAddress);

    const body = c.req.valid("json");

    let now = Date.now();
    if (now >= body.expiresAt) {
      return c.json(formatError("Session signature has expired"), 401);
    }
    // Cap the client-supplied `expiresAt` server-side. Without this, a
    // malicious client can sign a message valid for years and replay it
    // indefinitely (issue #393). Allow a small skew so freshly-issued
    // sessions from a slightly-ahead client are still accepted.
    const MAX_CLOCK_SKEW_MS = 60_000;
    if (body.expiresAt > now + SESSION_DURATION_MS + MAX_CLOCK_SKEW_MS) {
      return c.json(formatError("Session signature lifetime exceeds maximum"), 401);
    }

    const normalizedAuthor = getAddress(body.author);
    const message = buildSessionMessage(normalizedAuthor, body.expiresAt);
    let recoveredAddress: string;
    try {
      recoveredAddress = await recoverMessageAddress({
        message,
        signature: body.signature as `0x${string}`,
      });
    } catch {
      return c.json(formatError("Invalid signature"), 401);
    }

    if (getAddress(recoveredAddress) !== normalizedAuthor) {
      return c.json(formatError("Signature does not match author"), 401);
    }

    // Refresh the timestamp after the (potentially slow) signature recovery
    // so a slot that expired during recovery doesn't falsely rate-limit.
    now = Date.now();
    purgeExpiredCommentRateLimits(now);

    const rateLimitKey = `${normalizedAuthor}:${tokenAddress.toLowerCase()}`;
    const lastCommentAt = commentRateLimit.get(rateLimitKey);
    if (lastCommentAt !== undefined && now - lastCommentAt < COMMENT_RATE_LIMIT_MS) {
      return c.json(
        formatError("Rate limit exceeded: 1 comment per 3s per wallet per token"),
        429,
      );
    }

    // Reserve the limiter slot before awaiting I/O so two concurrent requests
    // for the same (author, token) cannot both pass the check above and double
    // up on inserts. Roll back on failure so a failed write doesn't penalize
    // the author for the full window.
    recordCommentRateLimit(rateLimitKey, now);
    try {
      const db = createDb(c.env.DATABASE_URL);
      const [comment] = await db
        .insert(comments)
        .values({
          tokenAddress,
          author: normalizedAuthor,
          content: body.content,
        })
        .returning();

      return c.json(formatSuccess(comment), 201);
    } catch (error) {
      commentRateLimit.delete(rateLimitKey);
      throw error;
    }
  },
);

export default commentsRoute;
