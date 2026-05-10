import { Hono } from "hono";

import {
  ALLOWED_IMAGE_TYPES_LABEL,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIZE_LABEL,
  isAllowedImageMimeType,
} from "@launchpad/shared";

import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";
import { createDb } from "../db/client.js";
import { moderationLogs } from "../db/schema.js";
import {
  moderateImage,
  type CategoryScore,
} from "../lib/image-moderation.js";

import type { AppBindings } from "../lib/types.js";

async function logModerationDecision(
  databaseUrl: string,
  imageKey: string,
  decision: "approved" | "rejected" | "pending_review",
  reason: string,
  classifications: CategoryScore[],
): Promise<void> {
  try {
    const db = createDb(databaseUrl);
    await db.insert(moderationLogs).values({
      imageKey,
      decision,
      reason,
      classifications: JSON.stringify(classifications),
    });
  } catch {
    // Logging failures should not block uploads — log to structured output
    const structured = {
      level: "error",
      message: "Failed to log moderation decision",
      imageKey,
      decision,
      timestamp: new Date().toISOString(),
    };
    console.log(JSON.stringify(structured));
  }
}

const images = new Hono<{ Bindings: AppBindings }>();

function sanitizeFileName(raw: string): string {
  const base = raw.split(/[/\\]+/).pop() ?? "file";
  const dotIdx = base.lastIndexOf(".");
  const hasExt = dotIdx > 0 && dotIdx < base.length - 1;

  const name = (hasExt ? base.slice(0, dotIdx) : base)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");

  const ext = hasExt
    ? base.slice(dotIdx + 1).replace(/[^A-Za-z0-9]+/g, "").toLowerCase()
    : "";

  if (!name && !ext) return "file";
  if (!ext) return name || "file";
  return `${name || "file"}.${ext}`;
}

images.post("/", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return c.json(formatError("No file uploaded"), 400);
  }

  if (!isAllowedImageMimeType(file.type)) {
    return c.json(
      formatError(`Invalid file type. Accepts: ${ALLOWED_IMAGE_TYPES_LABEL}`),
      400,
    );
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return c.json(
      formatError(`File too large. Maximum ${MAX_IMAGE_SIZE_LABEL}`),
      400,
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const key = `tokens/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;

  const moderationResult = await moderateImage(
    c.env.OPENAI_API_KEY,
    new Uint8Array(arrayBuffer),
    file.type,
  );

  if (moderationResult.unavailable) {
    return c.json(formatError(moderationResult.reason), 503);
  }

  if (!moderationResult.safe && !moderationResult.flaggedForReview) {
    // Auto-rejected — log and deny
    await logModerationDecision(
      c.env.DATABASE_URL,
      key,
      "rejected",
      moderationResult.reason,
      moderationResult.classifications,
    );
    return c.json(formatError(moderationResult.reason), 422);
  }

  // Upload to R2 (both approved and pending_review images get stored)
  await c.env.IMAGES_BUCKET.put(key, arrayBuffer, {
    httpMetadata: { contentType: file.type },
  });

  // Return an origin-agnostic path rather than an absolute URL. The
  // returned `url` is what the creator stamps into `LaunchParams.image`
  // on-chain, so anything we put here travels through the contract and
  // back into every API environment that reads it later. Stamping the
  // request's own origin would freeze a single hostname into the
  // on-chain record — fine in production but disastrous in local dev,
  // where a token created against `http://localhost:8787` would surface
  // a broken image on the deployed site (issue #450). The frontend
  // resolves relative URLs against its configured `API_BASE`, so a path
  // like `/images/tokens/<key>` works in every environment whose API
  // serves the same R2 bucket.
  const url = `/images/${key}`;

  if (moderationResult.flaggedForReview) {
    // Borderline — store but flag for admin review
    await logModerationDecision(
      c.env.DATABASE_URL,
      key,
      "pending_review",
      moderationResult.reason,
      moderationResult.classifications,
    );
    return c.json(formatSuccess({ url, key, flaggedForReview: true }));
  }

  // Clean pass — log and approve
  await logModerationDecision(
    c.env.DATABASE_URL,
    key,
    "approved",
    "",
    moderationResult.classifications,
  );

  return c.json(formatSuccess({ url, key }));
});

images.get("/:prefix/:key", async (c) => {
  const prefix = c.req.param("prefix");
  const key = c.req.param("key");
  const fullKey = `${prefix}/${key}`;

  const object = await c.env.IMAGES_BUCKET.get(fullKey);
  if (!object) {
    return c.json(formatError("Image not found"), 404);
  }

  c.header("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
  c.header("Cache-Control", "public, max-age=31536000, immutable");

  return c.body(object.body);
});

export default images;
