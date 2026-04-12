import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { isAddress, getAddress } from "viem";

import { createDb } from "../db/client.js";
import { apiKeys } from "../db/schema.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { hashApiKey, extractPrefix } from "../utils/api-key-hash.js";

import type { AppBindings } from "../lib/types.js";

const apiKeysRoute = new Hono<{ Bindings: AppBindings }>();

function generateKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const segments = [8, 8, 8, 8];
  return segments
    .map((len) =>
      Array.from(crypto.getRandomValues(new Uint8Array(len)))
        .map((b) => chars[b % chars.length])
        .join(""),
    )
    .join("-");
}

apiKeysRoute.post("/", async (c) => {
  const body = await c.req.json<{ name?: string; ownerAddress?: string; rateLimit?: number }>();

  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return c.json(formatError("name is required"), 400);
  }
  if (!body.ownerAddress || typeof body.ownerAddress !== "string" || !isAddress(body.ownerAddress)) {
    return c.json(formatError("ownerAddress must be a valid Ethereum address"), 400);
  }

  const normalizedOwner = getAddress(body.ownerAddress);
  const rawKey = generateKey();
  const keyHash = await hashApiKey(rawKey);
  const keyPrefix = extractPrefix(rawKey);
  const rateLimit = typeof body.rateLimit === "number" && body.rateLimit > 0 ? body.rateLimit : 100;

  const db = createDb(c.env.DATABASE_URL);
  const [row] = await db
    .insert(apiKeys)
    .values({
      keyHash,
      keyPrefix,
      name: body.name.trim(),
      ownerAddress: normalizedOwner,
      rateLimit,
    })
    .returning();

  return c.json(
    formatSuccess({ id: row.id, key: rawKey, name: row.name, rateLimit: row.rateLimit }),
    201,
  );
});

apiKeysRoute.get("/", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const rows = await db
    .select({
      id: apiKeys.id,
      keyPrefix: apiKeys.keyPrefix,
      name: apiKeys.name,
      ownerAddress: apiKeys.ownerAddress,
      rateLimit: apiKeys.rateLimit,
      isActive: apiKeys.isActive,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .orderBy(apiKeys.id);

  return c.json(formatSuccess(rows));
});

apiKeysRoute.post("/:id/revoke", async (c) => {
  const raw = c.req.param("id");
  if (!/^\d+$/.test(raw)) {
    return c.json(formatError("Invalid key ID"), 400);
  }
  const id = Number(raw);

  const db = createDb(c.env.DATABASE_URL);
  const [updated] = await db
    .update(apiKeys)
    .set({ isActive: false })
    .where(eq(apiKeys.id, id))
    .returning({ id: apiKeys.id });

  if (!updated) {
    return c.json(formatError("API key not found"), 404);
  }

  return c.json(formatSuccess({ revoked: true }));
});

apiKeysRoute.post("/:id/activate", async (c) => {
  const raw = c.req.param("id");
  if (!/^\d+$/.test(raw)) {
    return c.json(formatError("Invalid key ID"), 400);
  }
  const id = Number(raw);

  const db = createDb(c.env.DATABASE_URL);
  const [updated] = await db
    .update(apiKeys)
    .set({ isActive: true })
    .where(eq(apiKeys.id, id))
    .returning({ id: apiKeys.id });

  if (!updated) {
    return c.json(formatError("API key not found"), 404);
  }

  return c.json(formatSuccess({ activated: true }));
});

export default apiKeysRoute;
