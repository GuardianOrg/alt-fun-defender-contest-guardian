import { afterEach, describe, expect, it, vi } from "vitest";

import { processImageForUpload } from "./imageProcessing";

/**
 * Runs under the default node environment, so the browser surface
 * `processImageForUpload` touches (`Image`, `document.createElement`,
 * `URL.createObjectURL`, `canvas.toBlob`) is stubbed here rather than
 * pulled in via jsdom for one module.
 */
function stubBrowserImageApis(naturalWidth: number, naturalHeight: number) {
  const toBlob = vi.fn(
    (cb: (blob: Blob | null) => void, type: string) =>
      cb(new Blob([new Uint8Array(2048)], { type })),
  );

  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:stub"),
    revokeObjectURL: vi.fn(),
  });

  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = naturalWidth;
      naturalHeight = naturalHeight;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    },
  );

  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob,
    }),
  });

  return { toBlob };
}

/** Small enough on both axes that the size/dimension fast path applies. */
function smallFile(type: string, name: string): File {
  return new File([new Uint8Array(4096)], name, { type });
}

describe("processImageForUpload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("re-encodes a PNG that would otherwise pass through untouched", async () => {
    // OpenAI's moderation endpoint 500s on grayscale-plus-alpha and
    // 16-bit grayscale PNGs, which fails the upload closed. The canvas
    // round-trip always emits RGBA, so normalising here keeps those
    // encodings from ever reaching the API.
    const { toBlob } = stubBrowserImageApis(300, 300);

    const result = await processImageForUpload(smallFile("image/png", "logo.png"));

    expect(result.passthrough).toBe(false);
    expect(result.file.type).toBe("image/png");
    expect(toBlob).toHaveBeenCalled();
  });

  it("still passes a small JPEG through without canvas work", async () => {
    const { toBlob } = stubBrowserImageApis(300, 300);
    const input = smallFile("image/jpeg", "photo.jpg");

    const result = await processImageForUpload(input);

    expect(result.passthrough).toBe(true);
    expect(result.file).toBe(input);
    expect(toBlob).not.toHaveBeenCalled();
  });

  it("keeps GIFs out of the canvas so animation survives", async () => {
    const { toBlob } = stubBrowserImageApis(300, 300);
    const input = smallFile("image/gif", "spin.gif");

    const result = await processImageForUpload(input);

    expect(result.passthrough).toBe(true);
    expect(result.file).toBe(input);
    expect(toBlob).not.toHaveBeenCalled();
  });
});
