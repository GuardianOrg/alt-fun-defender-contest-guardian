import { Hono } from "hono";
import { eq } from "drizzle-orm";

import { createDb } from "../db/client.js";
import { userProfiles } from "../db/schema.js";
import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";

import type { AppBindings } from "../lib/types.js";

const creators = new Hono<{ Bindings: AppBindings }>();

creators.get("/:address", async (c) => {
  const address = c.req.param("address");
  const db = createDb(c.env.DATABASE_URL);
  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.address, address))
    .limit(1);

  if (!profile) {
    return c.json(formatError("Creator not found"), 404);
  }

  return c.json(formatSuccess(profile));
});

export default creators;
