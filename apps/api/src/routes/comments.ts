import { buildCommentMessage } from "@launchpad/shared";
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

const COMMENT_RATE_LIMIT_MS = 30_000;
const COMMENT_SIGNATURE_TTL_MS = 5 * 60_000;
const commentRateLimit = new Map<string, number>();

const createCommentSchema = z.object({
  author: z.string().refine(isAddress, "Invalid author address"),
  content: z
    .string()
    .min(1, "Content is required")
    .max(500, "Comment too long (max 500 chars)"),
  signature: z.string().min(1, "Signature is required"),
  timestamp: z.number().finite("Invalid timestamp"),
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

    if (Math.abs(Date.now() - body.timestamp) > COMMENT_SIGNATURE_TTL_MS) {
      return c.json(formatError("Expired signature timestamp"), 401);
    }

    const message = buildCommentMessage(tokenAddress, body.content, body.timestamp);
    let recoveredAddress: string;
    try {
      recoveredAddress = await recoverMessageAddress({
        message,
        signature: body.signature as `0x${string}`,
      });
    } catch {
      return c.json(formatError("Invalid signature"), 401);
    }

    const normalizedAuthor = getAddress(body.author);
    if (getAddress(recoveredAddress) !== normalizedAuthor) {
      return c.json(formatError("Signature does not match author"), 401);
    }

    const rateLimitKey = `${normalizedAuthor}:${tokenAddress.toLowerCase()}`;
    const lastCommentAt = commentRateLimit.get(rateLimitKey);
    if (lastCommentAt !== undefined && Date.now() - lastCommentAt < COMMENT_RATE_LIMIT_MS) {
      return c.json(
        formatError("Rate limit exceeded: 1 comment per 30s per wallet per token"),
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

    commentRateLimit.set(rateLimitKey, Date.now());

    return c.json(formatSuccess(comment), 201);
  },
);

export default commentsRoute;
