import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";

import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";
import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";

import type { AppBindings } from "../lib/types.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function parseNonNegativeInt(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

const tokensRoute = new Hono<{ Bindings: AppBindings }>();

tokensRoute.get("/", async (c) => {
  const limitParam = parseNonNegativeInt(c.req.query("limit"));
  const offsetParam = parseNonNegativeInt(c.req.query("offset"));

  if (limitParam === null || offsetParam === null) {
    return c.json(formatError("Invalid pagination parameters"), 400);
  }

  const limit = Math.min(limitParam ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = offsetParam ?? 0;

  const db = createDb(c.env.DATABASE_URL);
  const allTokens = await db
    .select()
    .from(tokens)
    .where(eq(tokens.isHidden, false))
    .orderBy(desc(tokens.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json(formatSuccess(allTokens));
});

tokensRoute.get("/:address", async (c) => {
  const address = c.req.param("address");
  const db = createDb(c.env.DATABASE_URL);
  const [token] = await db.select().from(tokens).where(eq(tokens.address, address)).limit(1);

  if (!token) {
    return c.json(formatError("Token not found"), 404);
  }

  return c.json(formatSuccess(token));
});

export default tokensRoute;
