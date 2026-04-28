import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
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
 * Animated GIFs would lose their animation if redrawn through a 2D canvas
 * (only the first frame is sampled), so we leave them untouched. The
 * server cap (`MAX_IMAGE_BYTES`) still applies — caller is responsible
 * for surfacing that to the user via `validateImageFile`.
 */
function isLossyResizable(type: string): boolean {
  return type === "image/jpeg" || type === "image/png" || type === "image/webp";
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = src;
  });
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
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
 * Throws a user-facing `Error` when the file fails the shared
 * (`validateImageFile`) checks or can't be decoded by the browser. Rejects
 * are surfaced to the UI rather than swallowed — we'd rather block the
 * launch than upload something the API will reject after the on-chain tx.
 */
export async function processImageForUpload(file: File): Promise<CompressionResult> {
  const validationError = validateImageFile(file, {
    allowedTypes: ALLOWED_IMAGE_MIME_TYPES,
    maxBytes: MAX_IMAGE_BYTES,
  });
  if (validationError) {
    throw new Error(validationError);
  }

  if (!isLossyResizable(file.type)) {
    return { file, passthrough: true };
  }

  const dataUrl = await readAsDataURL(file);
  const img = await loadImage(dataUrl);

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
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image is too large after compression (${(blob.size / (1024 * 1024)).toFixed(1)}MB). Try a smaller image.`,
    );
  }

  const ext = extensionFor(outputType);
  const compressed = new File([blob], renameWithExtension(file.name, ext), {
    type: outputType,
  });
  return { file: compressed, passthrough: false };
}
