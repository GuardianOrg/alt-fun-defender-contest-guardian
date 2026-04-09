import { Hono } from "hono";
import { eq } from "drizzle-orm";

import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";
import formatSuccess from "../utils/format-success.js";

import type { AppBindings } from "../lib/types.js";

const admin = new Hono<{ Bindings: AppBindings }>();

// TODO: Add admin authentication middleware

admin.post("/tokens/:address/hide", async (c) => {
  const address = c.req.param("address");
  const db = createDb(c.env.DATABASE_URL);
  await db.update(tokens).set({ isHidden: true }).where(eq(tokens.address, address));
  return c.json(formatSuccess({ hidden: true }));
});

admin.post("/tokens/:address/unhide", async (c) => {
  const address = c.req.param("address");
  const db = createDb(c.env.DATABASE_URL);
  await db.update(tokens).set({ isHidden: false }).where(eq(tokens.address, address));
  return c.json(formatSuccess({ hidden: false }));
});

export default admin;
