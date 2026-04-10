import { buildCommentMessage } from "@launchpad/shared";
import { eq, desc } from "drizzle-orm";
import { Hono } from "hono";
import { getAddress, isAddress, recoverMessageAddress } from "viem";

import { createDb } from "../db/client.js";
import { comments } from "../db/schema.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";

import type { AppBindings } from "../lib/types.js";

const COMMENT_RATE_LIMIT_MS = 30_000;
const COMMENT_SIGNATURE_TTL_MS = 5 * 60_000;
const commentRateLimit = new Map<string, number>();

const commentsRoute = new Hono<{ Bindings: AppBindings }>();

commentsRoute.get("/:address", async (c) => {
  const tokenAddress = c.req.param("address");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
  const offset = Number(c.req.query("offset") ?? 0);

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

commentsRoute.post("/:address", async (c) => {
  const tokenAddress = c.req.param("address");

  let body: {
    author: string;
    content: string;
    signature: string;
    timestamp: number;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json(formatError("Invalid JSON body"), 400);
  }

  if (!body.author || !body.content || !body.signature || body.timestamp == null) {
    return c.json(formatError("Missing author, content, signature, or timestamp"), 400);
  }

  if (typeof body.timestamp !== "number" || !Number.isFinite(body.timestamp)) {
    return c.json(formatError("Invalid timestamp"), 400);
  }

  if (!isAddress(body.author)) {
    return c.json(formatError("Invalid author address"), 400);
  }

  if (body.content.length > 500) {
    return c.json(formatError("Comment too long (max 500 chars)"), 400);
  }

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
});

export default commentsRoute;
