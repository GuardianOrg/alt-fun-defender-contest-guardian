import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const { default: imagesRoute } = await import("../routes/images.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/images", imagesRoute);
  return app;
}

const mockR2Put = vi.fn().mockResolvedValue(undefined);
const mockR2Get = vi.fn();

function makeEnv(aiOverride?: Partial<Ai>): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "",
    IMAGES_BUCKET: {
      put: mockR2Put,
      get: mockR2Get,
    } as unknown as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    AI: {
      run: vi.fn().mockResolvedValue({ description: "A colorful abstract painting" }),
      ...aiOverride,
    } as unknown as Ai,
  };
}

describe("POST /images — image upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when no file is uploaded", async () => {
    const app = createApp();
    const formData = new FormData();
    const res = await app.request(
      "/images",
      { method: "POST", body: formData },
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("No file uploaded");
  });

  it("returns 400 for invalid file type", async () => {
    const app = createApp();
    const formData = new FormData();
    formData.append("file", new File(["data"], "test.txt", { type: "text/plain" }));

    const res = await app.request(
      "/images",
      { method: "POST", body: formData },
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Invalid file type. Accepts: JPEG, PNG, GIF, WebP");
  });

  it("returns 400 for file exceeding 5MB", async () => {
    const app = createApp();
    const formData = new FormData();
    const largeData = new Uint8Array(6 * 1024 * 1024);
    formData.append(
      "file",
      new File([largeData], "big.png", { type: "image/png" }),
    );

    const res = await app.request(
      "/images",
      { method: "POST", body: formData },
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("File too large. Maximum 5MB");
  });

  it("returns 422 when image fails moderation", async () => {
    const app = createApp();
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array(100)], "test.png", { type: "image/png" }),
    );

    const env = makeEnv({
      run: vi.fn().mockResolvedValue({ description: "child abuse content detected" }) as Ai["run"],
    });

    const res = await app.request(
      "/images",
      { method: "POST", body: formData },
      env,
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Image contains content that violates our policy");
  });

  it("returns 503 when AI moderation is unavailable", async () => {
    const app = createApp();
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array(100)], "test.png", { type: "image/png" }),
    );

    const env = makeEnv({
      run: vi.fn().mockRejectedValue(new Error("AI unavailable")) as Ai["run"],
    });

    const res = await app.request(
      "/images",
      { method: "POST", body: formData },
      env,
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toContain("temporarily unavailable");
  });

  it("uploads to R2 and returns URL on success", async () => {
    const app = createApp();
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array(100)], "photo.png", { type: "image/png" }),
    );

    const res = await app.request(
      "/images",
      { method: "POST", body: formData },
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; error: string | null; data: Record<string, unknown> };
    expect(body.status).toBe("success");
    expect((body.data as Record<string, unknown>).url).toMatch(/^\/images\/tokens\//);
    expect((body.data as Record<string, unknown>).key).toMatch(/^tokens\//);

    expect(mockR2Put).toHaveBeenCalledTimes(1);
    const [key, , options] = mockR2Put.mock.calls[0];
    expect(key).toMatch(/^tokens\//);
    expect(options.httpMetadata.contentType).toBe("image/png");
  });

  it("accepts all valid image types", async () => {
    const types = ["image/jpeg", "image/png", "image/gif", "image/webp"];

    for (const type of types) {
      vi.clearAllMocks();
      const app = createApp();
      const formData = new FormData();
      const ext = type.split("/")[1];
      formData.append(
        "file",
        new File([new Uint8Array(100)], `test.${ext}`, { type }),
      );

      const res = await app.request(
        "/images",
        { method: "POST", body: formData },
        makeEnv(),
      );

      expect(res.status).toBe(200);
    }
  });
});

describe("GET /images/:prefix/:key — image retrieval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when image is not found in R2", async () => {
    mockR2Get.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request("/images/tokens/some-key", {}, makeEnv());

    expect(res.status).toBe(404);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Image not found");
  });

  it("returns image with correct headers when found", async () => {
    mockR2Get.mockResolvedValue({
      body: new ReadableStream(),
      httpMetadata: { contentType: "image/png" },
    });

    const app = createApp();
    const res = await app.request("/images/tokens/some-key", {}, makeEnv());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("falls back to application/octet-stream when no content type", async () => {
    mockR2Get.mockResolvedValue({
      body: new ReadableStream(),
      httpMetadata: {},
    });

    const app = createApp();
    const res = await app.request("/images/tokens/some-key", {}, makeEnv());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });
});
