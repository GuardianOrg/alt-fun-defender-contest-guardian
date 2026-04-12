import { eq, desc, asc, ilike, or, and, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { getAddress, isAddress } from "viem";

import { createDb } from "../../db/client.js";
import { tokens } from "../../db/schema.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";

import type { AppBindings } from "../../lib/types.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function parseNonNegativeInt(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

const listRoute = new Hono<{ Bindings: AppBindings }>();

listRoute.get("/", async (c) => {
  const limitParam = parseNonNegativeInt(c.req.query("limit"));
  const offsetParam = parseNonNegativeInt(c.req.query("offset"));

  if (limitParam === null || offsetParam === null) {
    return c.json(formatError("Invalid pagination parameters"), 400);
  }

  const limit = Math.min(limitParam ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = offsetParam ?? 0;

  const conditions: SQL[] = [eq(tokens.isHidden, false)];

  const underlying = c.req.query("underlying");
  if (underlying) {
    conditions.push(eq(tokens.underlying, underlying));
  }

  const status = c.req.query("status");
  if (status && (status === "curve" || status === "graduating" || status === "graduated")) {
    conditions.push(eq(tokens.status, status));
  }

  const direction = c.req.query("direction");
  if (direction && (direction === "long" || direction === "short")) {
    conditions.push(eq(tokens.ltDirection, direction));
  }

  const leverage = c.req.query("leverage");
  if (leverage) {
    const lev = parseInt(leverage, 10);
    if ([2, 3, 5].includes(lev)) {
      conditions.push(eq(tokens.leverage, lev));
    }
  }

  const creator = c.req.query("creator");
  if (creator && isAddress(creator)) {
    conditions.push(eq(tokens.creator, getAddress(creator)));
  }

  const sort = c.req.query("sort") ?? "createdAt";
  const dir = c.req.query("dir") === "asc" ? asc : desc;

  const sortColumn =
    sort === "leverage" ? tokens.leverage :
    sort === "name" ? tokens.name :
    tokens.createdAt;

  const db = createDb(c.env.DATABASE_URL);
  const allTokens = await db
    .select()
    .from(tokens)
    .where(and(...conditions))
    .orderBy(dir(sortColumn))
    .limit(limit)
    .offset(offset);

  return c.json(formatSuccess(allTokens));
});

listRoute.get("/search", async (c) => {
  const q = c.req.query("q");
  if (!q || q.length < 1) {
    return c.json(formatSuccess([]));
  }

  const db = createDb(c.env.DATABASE_URL);
  const pattern = `%${q}%`;
  const results = await db
    .select()
    .from(tokens)
    .where(
      and(
        eq(tokens.isHidden, false),
        or(
          ilike(tokens.name, pattern),
          ilike(tokens.ticker, pattern),
          ilike(tokens.address, pattern),
        ),
      ),
    )
    .limit(20);

  return c.json(formatSuccess(results));
});

export default listRoute;
