/**
 * Image upload constraints. Single source of truth for both the API
 * (`apps/api/src/routes/images.ts`) and the webapp's create/upload UI.
 *
 * Keeping these here means the webapp can pre-validate file picks (type +
 * size) so the user gets immediate, friendly feedback instead of being
 * surprised by a server-side reject *after* their on-chain token deploy
 * has already gone through.
 */

/** 5 MiB — hard cap on raw upload size accepted by the API. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Allowed MIME types for token / profile images.
 *
 * AVIF is **not** supported because Cloudflare Workers AI's `resnet-50`
 * moderation model rejects it. Re-evaluate if/when the upstream model
 * adds AVIF decode support.
 */
export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

/** Comma-joined `accept` value for `<input type="file">`. */
export const IMAGE_ACCEPT_ATTRIBUTE = ALLOWED_IMAGE_MIME_TYPES.join(",");

/** Human-readable list for error/help text ("JPEG, PNG, GIF, WebP"). */
export const ALLOWED_IMAGE_TYPES_LABEL = "JPEG, PNG, GIF, WebP";

/** `MAX_IMAGE_BYTES` formatted for display ("5MB"). */
export const MAX_IMAGE_SIZE_LABEL = `${MAX_IMAGE_BYTES / (1024 * 1024)}MB`;

export function isAllowedImageMimeType(type: string): type is AllowedImageMimeType {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(type);
}

export interface ImageValidationOptions {
  maxBytes?: number;
  allowedTypes?: readonly string[];
}

/**
 * Validate an upload candidate against the shared rules. Returns `null`
 * when the file is acceptable, or a user-facing error message otherwise.
 *
 * The webapp uses this on the file-picker `change` handler so we never
 * even *attempt* a server upload (or — worse — an on-chain deploy
 * followed by a doomed upload) for a file the API would reject.
 */
export function validateImageFile(
  file: { type: string; size: number },
  options: ImageValidationOptions = {},
): string | null {
  const allowed = options.allowedTypes ?? ALLOWED_IMAGE_MIME_TYPES;
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;

  if (!allowed.includes(file.type)) {
    return `Invalid file type. Accepts: ${ALLOWED_IMAGE_TYPES_LABEL}`;
  }
  if (file.size > maxBytes) {
    return `File too large. Maximum ${MAX_IMAGE_SIZE_LABEL}`;
  }
  return null;
}
