import { buildSessionMessage } from "@launchpad/shared";
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

    if (Date.now() >= body.expiresAt) {
      return c.json(formatError("Session signature has expired"), 401);
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

    const now = Date.now();
    purgeExpiredCommentRateLimits(now);

    const rateLimitKey = `${normalizedAuthor}:${tokenAddress.toLowerCase()}`;
    const lastCommentAt = commentRateLimit.get(rateLimitKey);
    if (lastCommentAt !== undefined && now - lastCommentAt < COMMENT_RATE_LIMIT_MS) {
      return c.json(
        formatError("Rate limit exceeded: 1 comment per 3s per wallet per token"),
        429,
      );
    }

    const db = createDb(c.env.DATABASE_URL);
    const [comment] = await db
      .insert(comments)
      .values({
        tokenAddress,
        author: normalizedAuthor,
        content: body.content,
      })
      .returning();

    recordCommentRateLimit(rateLimitKey, Date.now());

    return c.json(formatSuccess(comment), 201);
  },
);

export default commentsRoute;
