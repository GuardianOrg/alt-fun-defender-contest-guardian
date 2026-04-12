import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { createDb } from "../../db/client.js";
import { tokens, moderationLogs } from "../../db/schema.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";

import type { AppBindings } from "../../lib/types.js";

const moderation = new Hono<{ Bindings: AppBindings }>();

moderation.post("/tokens/:address/hide", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);
  const db = createDb(c.env.DATABASE_URL);
  await db.update(tokens).set({ isHidden: true }).where(eq(tokens.address, address));
  return c.json(formatSuccess({ hidden: true }));
});

moderation.post("/tokens/:address/unhide", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);
  const db = createDb(c.env.DATABASE_URL);
  await db.update(tokens).set({ isHidden: false }).where(eq(tokens.address, address));
  return c.json(formatSuccess({ hidden: false }));
});

moderation.get("/moderation/pending", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const pending = await db
    .select()
    .from(moderationLogs)
    .where(eq(moderationLogs.decision, "pending_review"))
    .orderBy(desc(moderationLogs.createdAt))
    .limit(50);

  return c.json(formatSuccess(pending));
});

moderation.get("/moderation/logs", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const logs = await db
    .select()
    .from(moderationLogs)
    .orderBy(desc(moderationLogs.createdAt))
    .limit(100);

  return c.json(formatSuccess(logs));
});

moderation.post("/moderation/:id/approve", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json(formatError("Invalid moderation log ID"), 400);
  }

  const reviewerAddress = c.req.header("X-Reviewer-Address") ?? null;
  const db = createDb(c.env.DATABASE_URL);

  const [updated] = await db
    .update(moderationLogs)
    .set({
      decision: "approved",
      reviewedBy: reviewerAddress,
      reviewedAt: new Date(),
    })
    .where(eq(moderationLogs.id, id))
    .returning();

  if (!updated) {
    return c.json(formatError("Moderation log not found"), 404);
  }

  return c.json(formatSuccess(updated));
});

moderation.post("/moderation/:id/reject", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json(formatError("Invalid moderation log ID"), 400);
  }

  const reviewerAddress = c.req.header("X-Reviewer-Address") ?? null;
  const db = createDb(c.env.DATABASE_URL);

  const [log] = await db
    .select()
    .from(moderationLogs)
    .where(eq(moderationLogs.id, id));

  if (!log) {
    return c.json(formatError("Moderation log not found"), 404);
  }

  // Remove the image from R2 on rejection
  try {
    await c.env.IMAGES_BUCKET.delete(log.imageKey);
  } catch {
    // Non-fatal — image may already be deleted
  }

  const [updated] = await db
    .update(moderationLogs)
    .set({
      decision: "rejected",
      reviewedBy: reviewerAddress,
      reviewedAt: new Date(),
    })
    .where(eq(moderationLogs.id, id))
    .returning();

  return c.json(formatSuccess(updated));
});

export default moderation;
