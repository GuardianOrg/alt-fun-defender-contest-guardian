import { Hono } from "hono";

import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";

import type { AppBindings } from "../lib/types.js";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

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

  if (!ALLOWED_TYPES.has(file.type)) {
    return c.json(formatError("Invalid file type. Accepts: JPEG, PNG, GIF, WebP"), 400);
  }

  if (file.size > MAX_SIZE) {
    return c.json(formatError("File too large. Maximum 5MB"), 400);
  }

  const key = `tokens/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
  const arrayBuffer = await file.arrayBuffer();

  await c.env.IMAGES_BUCKET.put(key, arrayBuffer, {
    httpMetadata: { contentType: file.type },
  });

  const url = `/images/${key}`;

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

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
});

export default images;
