import {
  ALLOWED_IMAGE_TYPES_LABEL,
  MAX_IMAGE_SIZE_LABEL,
  isAllowedImageMimeType,
  validateImageFile,
} from "@launchpad/shared";

import type { AllowedImageMimeType } from "@launchpad/shared";

/**
 * Pre-upload pipeline for token / profile images.
 *
 * Token icons render at <=80px in the heaviest UI surfaces, so we cap the
 * upload at 512px on the longest edge — that's already 4× the largest
 * render target, and keeps Retina (2×) crisp without blowing R2 storage.
 */
const MAX_DIMENSION = 512;

/**
 * After compression we aim for files around this size — well under
 * `MAX_IMAGE_BYTES` so the server-side limit is effectively unreachable
 * for any reasonable user pick.
 */
const TARGET_BYTES = 512 * 1024;

/** Don't drop below this WebP/JPEG quality during the resize loop. */
const MIN_QUALITY = 0.6;

const INITIAL_QUALITY = 0.9;
const QUALITY_STEP = 0.1;

/**
 * Hard ceiling on raw input we'll even attempt to decode in-browser.
 * Well above any realistic phone-camera shot (modern 50MP JPEGs land
 * in the 10–20MB range), well below "Safari tab OOM territory". Picks
 * larger than this are rejected up front rather than risking a hung
 * canvas decode on memory-constrained devices.
 *
 * Note this is *separate* from `MAX_IMAGE_BYTES` — that's the
 * server's cap on the *compressed output*, this is the client's cap
 * on the *raw input*. A 20MB phone shot is a perfectly normal source
 * we want to transparently squeeze down to a few hundred KB; only
 * pathological inputs hit this wall.
 */
const MAX_INPUT_BYTES = 50 * 1024 * 1024;

/**
 * Whether a format can be safely roundtripped through a 2D canvas — i.e.
 * decoded, redrawn at a smaller size, and re-encoded without losing
 * semantics the user cares about.
 *
 * GIF is excluded specifically because animated GIFs would lose their
 * animation (canvas only samples the first frame). Everything else in
 * `ALLOWED_IMAGE_MIME_TYPES` is a static raster the canvas can handle.
 *
 * Note "canvas processable" ≠ "lossy": PNG re-encodes losslessly here —
 * the only loss for PNG is from the dimension downscale itself.
 */
function isCanvasProcessable(type: string): boolean {
  return type === "image/jpeg" || type === "image/png" || type === "image/webp";
}

/**
 * Decode a file into an `HTMLImageElement` without round-tripping through
 * a base64 data URL. `URL.createObjectURL` returns a tiny opaque pointer
 * to the underlying blob (no copy, no encoding overhead), which keeps
 * peak memory at ~1× the source size instead of ~2.3× — the difference
 * between "fine on a mid-range phone" and "OOM at 50MB". The object URL
 * is always revoked so we don't leak it on either the success or error
 * path.
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const cleanup = () => URL.revokeObjectURL(url);
    img.onload = () => {
      cleanup();
      resolve(img);
    };
    img.onerror = () => {
      cleanup();
      reject(new Error("Failed to decode image"));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function fitDimensions(width: number, height: number, max: number): { w: number; h: number } {
  if (width <= max && height <= max) return { w: width, h: height };
  const ratio = width / height;
  if (width >= height) {
    return { w: max, h: Math.round(max / ratio) };
  }
  return { w: Math.round(max * ratio), h: max };
}

function pickOutputType(sourceType: string): AllowedImageMimeType {
  // PNGs can carry transparency that JPEG would flatten — keep them as
  // PNG (no quality knob, but we still benefit from the dimension cap).
  // Everything else collapses to WebP for the best size/quality tradeoff.
  if (sourceType === "image/png") return "image/png";
  return "image/webp";
}

function extensionFor(type: AllowedImageMimeType): string {
  switch (type) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
  }
}

function renameWithExtension(originalName: string, ext: string): string {
  const base = originalName.replace(/\.[^.]+$/, "") || "image";
  return `${base}.${ext}`;
}

export interface CompressionResult {
  file: File;
  /** True when the returned file is the same instance as the input (e.g. animated GIF passthrough). */
  passthrough: boolean;
}

/**
 * Validate, scale, and re-encode an image for upload.
 *
 * MIME type is enforced unconditionally (so an AVIF pick is rejected
 * before we waste cycles decoding it), but the server's `MAX_IMAGE_BYTES`
 * cap is checked on the *output* for re-encodable types — a 20MB phone
 * shot should sail through the compression pass and come out as a few
 * hundred KB WebP, not get bounced at the front door. The only upfront
 * size check is the much-larger `MAX_INPUT_BYTES` sanity cap.
 *
 * Throws a user-facing `Error` on any failure path so the UI surfaces it
 * inline rather than silently uploading something the API will reject.
 */
export async function processImageForUpload(file: File): Promise<CompressionResult> {
  if (!isAllowedImageMimeType(file.type)) {
    throw new Error(`Invalid file type. Accepts: ${ALLOWED_IMAGE_TYPES_LABEL}`);
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error(
      `Image is too large to process in-browser (${(file.size / (1024 * 1024)).toFixed(1)}MB). Try a smaller source file.`,
    );
  }

  if (!isCanvasProcessable(file.type)) {
    // Animated GIFs can't be re-encoded without losing animation, so
    // there's no compression pass to fall back on — the server's hard
    // limit applies upfront.
    const sizeError = validateImageFile(file);
    if (sizeError) throw new Error(sizeError);
    return { file, passthrough: true };
  }

  const img = await loadImage(file);

  const { w, h } = fitDimensions(img.naturalWidth, img.naturalHeight, MAX_DIMENSION);

  // If the source is small AND already under the target byte budget,
  // skip the canvas roundtrip entirely (saves a JS encode that would
  // also strip metadata users may have intentionally embedded).
  if (w === img.naturalWidth && h === img.naturalHeight && file.size <= TARGET_BYTES) {
    return { file, passthrough: true };
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Browser does not support canvas image processing");
  }
  ctx.drawImage(img, 0, 0, w, h);

  const outputType = pickOutputType(file.type);
  // PNG ignores `canvas.toBlob`'s quality arg (it's lossless), so the
  // shrink loop below would just re-encode the same bytes N times. We
  // rely on the dimension cap alone for PNGs — after a 512px downscale
  // they're effectively always well under MAX_IMAGE_BYTES, and if a
  // pixel-art PNG happens to land between TARGET_BYTES and MAX_IMAGE_BYTES,
  // shipping it slightly larger is preferable to flattening alpha.
  const isLossless = outputType === "image/png";

  let quality = INITIAL_QUALITY;
  let blob = await canvasToBlob(canvas, outputType, quality);
  while (
    !isLossless &&
    blob &&
    blob.size > TARGET_BYTES &&
    quality - QUALITY_STEP >= MIN_QUALITY
  ) {
    quality -= QUALITY_STEP;
    blob = await canvasToBlob(canvas, outputType, quality);
  }

  if (!blob) {
    throw new Error("Failed to compress image");
  }
  // Reuse the shared validator so the threshold itself can never drift
  // from the server. We rewrap the message with post-compression context
  // ("after compression" tells the user we already tried, which is more
  // actionable than the generic server wording) but the threshold value
  // and units come from `MAX_IMAGE_SIZE_LABEL` so it stays in sync.
  const sizeError = validateImageFile({ type: outputType, size: blob.size });
  if (sizeError) {
    const actualMb = (blob.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Image is too large after compression (${actualMb}MB, max ${MAX_IMAGE_SIZE_LABEL}). Try a smaller image.`,
    );
  }

  const ext = extensionFor(outputType);
  const compressed = new File([blob], renameWithExtension(file.name, ext), {
    type: outputType,
  });
  return { file: compressed, passthrough: false };
}
