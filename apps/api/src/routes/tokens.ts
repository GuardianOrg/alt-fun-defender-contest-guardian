import { Hono } from "hono";
import { eq } from "drizzle-orm";

import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";
import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";

import type { AppBindings } from "../lib/types.js";

const tokensRoute = new Hono<{ Bindings: AppBindings }>();

tokensRoute.get("/", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const allTokens = await db.select().from(tokens).where(eq(tokens.isHidden, false));
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
