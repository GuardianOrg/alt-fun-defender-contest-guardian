import {
  ALLOWED_IMAGE_TYPES_LABEL,
  MAX_IMAGE_SIZE_LABEL,
  isAllowedImageMimeType,
  validateImageFile,
} from "@launchpad/shared";

import type { AllowedImageMimeType } from "@launchpad/shared";

// 512px keeps icons crisp at 2x while avoiding oversized uploads.
const MAX_DIMENSION = 512;

// Aim well under the server cap after compression.
const TARGET_BYTES = 512 * 1024;

/** Don't drop below this WebP/JPEG quality during the resize loop. */
const MIN_QUALITY = 0.6;

const INITIAL_QUALITY = 0.9;
const QUALITY_STEP = 0.1;

// Raw-input decode cap, separate from the compressed-output server cap.
const MAX_INPUT_BYTES = 50 * 1024 * 1024;

/** Whether the format can be canvas-resized without losing important semantics. */
function isCanvasProcessable(type: string): boolean {
  return type === "image/jpeg" || type === "image/png" || type === "image/webp";
}

/** Decode via object URL so large files avoid base64 memory overhead. */
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
  // Keep PNG transparency; collapse other static rasters to WebP.
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
  /** True when the returned file is the original input. */
  passthrough: boolean;
}

/** Validate, resize, and re-encode an image for upload. */
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
    // Animated GIFs pass through so we don't drop animation.
    const sizeError = validateImageFile(file);
    if (sizeError) throw new Error(sizeError);
    return { file, passthrough: true };
  }

  const img = await loadImage(file);

  const { w, h } = fitDimensions(img.naturalWidth, img.naturalHeight, MAX_DIMENSION);

  // Skip canvas work for already-small sources — except PNG, which always
  // takes the canvas round-trip so it reaches us as RGBA. OpenAI's
  // moderation endpoint 500s on grayscale-plus-alpha and 16-bit grayscale
  // PNGs (ordinary Pillow / ImageMagick exports), and a 500 there fails
  // the upload closed with no way for the user to recover except picking
  // a different file.
  const needsNormalising = file.type === "image/png";
  if (
    !needsNormalising &&
    w === img.naturalWidth &&
    h === img.naturalHeight &&
    file.size <= TARGET_BYTES
  ) {
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
  // PNG quality is ignored; dimension cap does the shrink work.
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
