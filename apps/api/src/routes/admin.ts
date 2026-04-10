import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { adminAuth } from "../middleware/admin-auth.js";

import type { AppBindings } from "../lib/types.js";

const admin = new Hono<{ Bindings: AppBindings }>();

admin.use("*", adminAuth);

admin.post("/tokens/:address/hide", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);
  const db = createDb(c.env.DATABASE_URL);
  await db.update(tokens).set({ isHidden: true }).where(eq(tokens.address, address));
  return c.json(formatSuccess({ hidden: true }));
});

admin.post("/tokens/:address/unhide", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);
  const db = createDb(c.env.DATABASE_URL);
  await db.update(tokens).set({ isHidden: false }).where(eq(tokens.address, address));
  return c.json(formatSuccess({ hidden: false }));
});

export default admin;
