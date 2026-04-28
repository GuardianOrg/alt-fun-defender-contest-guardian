/**
 * Image upload constraints. Single source of truth for both the API
 * (`apps/api/src/routes/images.ts`) and the webapp's create/upload UI.
 *
 * Keeping these here means the webapp can pre-validate file picks (type +
 * size) so the user gets immediate, friendly feedback instead of being
 * surprised by a server-side reject *after* their on-chain token deploy
 * has already gone through.
 */

/**
 * Hard cap on raw upload size accepted by the API. Sized in binary
 * megabytes (`5 × 1024 × 1024 = 5_242_880` bytes) to match the legacy
 * server limit and the user-facing "5MB" copy in the UI.
 */
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

/**
 * Pretty-printer for a single MIME type. Hand-mapped for the canonical
 * web image formats (so we render "WebP" not "WEBP") and falls back to
 * the uppercased subtype for anything else, which keeps the validator
 * usable for callers that supply a custom `allowedTypes` set.
 */
const MIME_LABELS: Record<string, string> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/gif": "GIF",
  "image/webp": "WebP",
};

function labelForMime(mime: string): string {
  if (mime in MIME_LABELS) return MIME_LABELS[mime];
  const subtype = mime.includes("/") ? mime.split("/")[1] : mime;
  return subtype.toUpperCase();
}

function joinMimeLabels(types: readonly string[]): string {
  return types.map(labelForMime).join(", ");
}

/** Human-readable list for error/help text ("JPEG, PNG, GIF, WebP"). */
export const ALLOWED_IMAGE_TYPES_LABEL = joinMimeLabels(ALLOWED_IMAGE_MIME_TYPES);

/**
 * Format a byte count as a megabyte label ("5MB"). Uses the colloquial
 * "MB" suffix (not "MiB") to match user expectations — almost no end
 * user reads "MiB" as more correct than "MB", and the OS file-size
 * displays we're echoing also use "MB" for the same value.
 *
 * Whole numbers render without a decimal ("5MB", not "5.0MB"); fractional
 * sizes (test fixtures, custom configs) get one decimal place.
 */
function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
}

/** `MAX_IMAGE_BYTES` formatted for display ("5MB"). */
export const MAX_IMAGE_SIZE_LABEL = formatMb(MAX_IMAGE_BYTES);

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
    // Derive the label from the *actual* allowed set so a custom
    // `allowedTypes` doesn't lie about what's permitted.
    const allowedLabel =
      options.allowedTypes === undefined
        ? ALLOWED_IMAGE_TYPES_LABEL
        : joinMimeLabels(allowed);
    return `Invalid file type. Accepts: ${allowedLabel}`;
  }
  if (file.size > maxBytes) {
    const maxLabel =
      options.maxBytes === undefined ? MAX_IMAGE_SIZE_LABEL : formatMb(maxBytes);
    return `File too large. Maximum ${maxLabel}`;
  }
  return null;
}
