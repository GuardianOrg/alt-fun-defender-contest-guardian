import { describe, expect, it } from "vitest";

import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_IMAGE_TYPES_LABEL,
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIZE_LABEL,
  isAllowedImageMimeType,
  validateImageFile,
} from "../constants/images.js";

describe("ALLOWED_IMAGE_MIME_TYPES", () => {
  it("includes the four canonical web image formats", () => {
    expect(ALLOWED_IMAGE_MIME_TYPES).toEqual([
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ]);
  });

  it("excludes AVIF (resnet-50 moderation model can't decode it)", () => {
    expect(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).not.toContain("image/avif");
  });
});

describe("IMAGE_ACCEPT_ATTRIBUTE", () => {
  it("formats as a comma-joined list suitable for `<input accept>`", () => {
    expect(IMAGE_ACCEPT_ATTRIBUTE).toBe(
      "image/jpeg,image/png,image/gif,image/webp",
    );
  });
});

describe("isAllowedImageMimeType", () => {
  it("returns true for every allowed type", () => {
    for (const type of ALLOWED_IMAGE_MIME_TYPES) {
      expect(isAllowedImageMimeType(type)).toBe(true);
    }
  });

  it("returns false for AVIF", () => {
    expect(isAllowedImageMimeType("image/avif")).toBe(false);
  });

  it("returns false for non-image types", () => {
    expect(isAllowedImageMimeType("application/pdf")).toBe(false);
    expect(isAllowedImageMimeType("text/plain")).toBe(false);
    expect(isAllowedImageMimeType("")).toBe(false);
  });
});

describe("validateImageFile", () => {
  it("returns null for an acceptable PNG", () => {
    expect(
      validateImageFile({ type: "image/png", size: 1024 }),
    ).toBeNull();
  });

  it("rejects AVIF with a user-facing error mentioning allowed types", () => {
    const err = validateImageFile({ type: "image/avif", size: 1024 });
    expect(err).not.toBeNull();
    expect(err).toContain(ALLOWED_IMAGE_TYPES_LABEL);
  });

  it("rejects oversized files with an error mentioning the size limit", () => {
    const err = validateImageFile({
      type: "image/png",
      size: MAX_IMAGE_BYTES + 1,
    });
    expect(err).not.toBeNull();
    expect(err).toContain(MAX_IMAGE_SIZE_LABEL);
  });

  it("treats files exactly at the size limit as acceptable", () => {
    expect(
      validateImageFile({ type: "image/jpeg", size: MAX_IMAGE_BYTES }),
    ).toBeNull();
  });

  it("respects custom limits when provided", () => {
    expect(
      validateImageFile(
        { type: "image/png", size: 2_000 },
        { maxBytes: 1_000 },
      ),
    ).toContain("too large");
    expect(
      validateImageFile(
        { type: "image/heic", size: 100 },
        { allowedTypes: ["image/heic"] },
      ),
    ).toBeNull();
  });

  it("derives the error label from a custom allowedTypes set", () => {
    // If a caller restricts the allowed set, the message must reflect the
    // restriction — not the global default — or it'd lie to the user.
    const err = validateImageFile(
      { type: "image/png", size: 100 },
      { allowedTypes: ["image/jpeg", "image/heic"] },
    );
    expect(err).toContain("JPEG");
    expect(err).toContain("HEIC");
    expect(err).not.toContain("WebP");
    expect(err).not.toContain("PNG");
  });
});
