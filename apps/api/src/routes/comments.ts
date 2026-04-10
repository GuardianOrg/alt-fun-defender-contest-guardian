import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";

import { createDb } from "../db/client.js";
import { comments } from "../db/schema.js";
import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";

import type { AppBindings } from "../lib/types.js";

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

  let body: { author: string; content: string };
  try {
    body = await c.req.json<{ author: string; content: string }>();
  } catch {
    return c.json(formatError("Invalid JSON body"), 400);
  }

  if (!body.author || !body.content) {
    return c.json(formatError("Missing author or content"), 400);
  }

  if (body.content.length > 500) {
    return c.json(formatError("Comment too long (max 500 chars)"), 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [comment] = await db
    .insert(comments)
    .values({
      tokenAddress,
      author: body.author,
      content: body.content,
    })
    .returning();

  return c.json(formatSuccess(comment), 201);
});

export default commentsRoute;
