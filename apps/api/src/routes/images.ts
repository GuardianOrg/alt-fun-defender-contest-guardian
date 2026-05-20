import { Hono } from "hono";
import type { Context } from "hono";

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
import { uploadIpRateLimit } from "../middleware/upload-rate-limit.js";

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

/**
 * Upload handler — POST /. Performs OpenAI moderation, then writes to R2
 * and `moderation_logs`. Wired only into `imagesPrivate` so it is
 * unreachable outside `/api/v1/*` (which is gated by `apiKeyAuth`).
 *
 * Splitting public-read from private-read+write closes the auth-bypass
 * regression caused by mounting the same router at both `/api/v1/images`
 * and the bare `/images` prefix (issue #509): the bare mount exists so
 * on-chain image URLs of the form `/images/{prefix}/{key}` resolve via
 * the same Worker, but it accidentally re-exposed `POST /images` with no
 * auth and no rate limit. Only `serveHandler` belongs on the bare mount.
 */
async function uploadHandler(c: Context<{ Bindings: AppBindings }>) {
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
      c.env.HYPERDRIVE.connectionString,
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
      c.env.HYPERDRIVE.connectionString,
      key,
      "pending_review",
      moderationResult.reason,
      moderationResult.classifications,
    );
    return c.json(formatSuccess({ url, key, flaggedForReview: true }));
  }

  // Clean pass — log and approve
  await logModerationDecision(
    c.env.HYPERDRIVE.connectionString,
    key,
    "approved",
    "",
    moderationResult.classifications,
  );

  return c.json(formatSuccess({ url, key }));
}

/**
 * Serve handler — GET /:prefix/:key. Streams the R2 object back. Wired
 * into both `imagesPublic` (mounted at `/images`) and `imagesPrivate`
 * (mounted under `/api/v1/images`) so on-chain URLs of the form
 * `/images/{prefix}/{key}` resolve without auth while authenticated
 * callers can still hit them at the canonical API path.
 */
async function serveHandler(c: Context<{ Bindings: AppBindings }>) {
  const prefix = c.req.param("prefix");
  const key = c.req.param("key");
  const fullKey = `${prefix}/${key}`;

  const object = await c.env.IMAGES_BUCKET.get(fullKey);
  if (!object) {
    return c.json(formatError("Image not found"), 404);
  }

  c.header(
    "Content-Type",
    object.httpMetadata?.contentType ?? "application/octet-stream",
  );
  c.header("Cache-Control", "public, max-age=31536000, immutable");

  return c.body(object.body);
}

/**
 * Public images router — GET-only. Mounted at the bare `/images` prefix
 * so on-chain `LaunchParams.image` URLs (`/images/{prefix}/{key}`, see
 * issue #450) resolve via the same Worker without going through
 * `apiKeyAuth`. Critically, this router exposes NO write surface — the
 * earlier dual-mount of a single router accidentally re-exposed
 * `POST /images` with no auth and no rate limit (issue #509).
 */
export const imagesPublic = new Hono<{ Bindings: AppBindings }>();
imagesPublic.get("/:prefix/:key", serveHandler);

/**
 * Private images router — read + write. Mounted at `/api/v1/images`
 * and gated by `apiKeyAuth`. The upload handler is additionally rate
 * limited per-IP via `uploadIpRateLimit` as a defensive fallback behind
 * the planned Cloudflare edge rule.
 */
export const imagesPrivate = new Hono<{ Bindings: AppBindings }>();
imagesPrivate.post("/", uploadIpRateLimit, uploadHandler);
imagesPrivate.get("/:prefix/:key", serveHandler);
