import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
const mockDbInsert = vi
  .fn()
  .mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

vi.mock("../db/client.js", () => ({
  createDb: () => ({
    insert: () => mockDbInsert(),
  }),
}));

interface OpenAICategoryShape {
  categories?: Record<string, boolean>;
  category_scores?: Record<string, number>;
  category_applied_input_types?: Record<string, string[]>;
  flagged?: boolean;
}

/**
 * Build a minimal OpenAI moderation response. Categories not specified
 * default to safe (`flagged: false`, score `0`). The image-supported
 * categories per OpenAI docs are: `sexual`, `violence`, `violence/graphic`,
 * `self-harm`, `self-harm/intent`, `self-harm/instructions`.
 */
function makeOpenAIModerationResponse(overrides: OpenAICategoryShape = {}) {
  const baseScores: Record<string, number> = {
    sexual: 0,
    violence: 0,
    "violence/graphic": 0,
    "self-harm": 0,
    "self-harm/intent": 0,
    "self-harm/instructions": 0,
  };
  const baseCategories: Record<string, boolean> = {
    sexual: false,
    violence: false,
    "violence/graphic": false,
    "self-harm": false,
    "self-harm/intent": false,
    "self-harm/instructions": false,
  };
  const baseAppliedInputs: Record<string, string[]> = {
    sexual: ["image"],
    violence: ["image"],
    "violence/graphic": ["image"],
    "self-harm": ["image"],
    "self-harm/intent": ["image"],
    "self-harm/instructions": ["image"],
  };

  return {
    id: "modr-test",
    model: "omni-moderation-latest",
    results: [
      {
        flagged: overrides.flagged ?? false,
        categories: { ...baseCategories, ...overrides.categories },
        category_scores: { ...baseScores, ...overrides.category_scores },
        category_applied_input_types: {
          ...baseAppliedInputs,
          ...overrides.category_applied_input_types,
        },
      },
    ],
  };
}

function mockOpenAIFetch(response: unknown, init: { status?: number } = {}) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(response), {
      status: init.status ?? 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function makeEnv(overrides: Partial<AppBindings> = {}): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "",
    OPENAI_API_KEY: "sk-test",
    IMAGES_BUCKET: {
      put: mockR2Put,
      get: mockR2Get,
    } as unknown as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

describe("POST /images — image upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    globalThis.fetch = mockOpenAIFetch(makeOpenAIModerationResponse());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
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

  it("returns 422 when OpenAI moderation rejects above the per-category threshold", async () => {
    globalThis.fetch = mockOpenAIFetch(
      makeOpenAIModerationResponse({
        flagged: true,
        categories: { "violence/graphic": true },
        category_scores: { "violence/graphic": 0.92, violence: 0.6 },
      }),
    );

    const app = createApp();
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array(100)], "test.png", { type: "image/png" }),
    );

    const res = await app.request(
      "/images",
      { method: "POST", body: formData },
      makeEnv(),
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Image contains content that violates our policy");
    expect(mockR2Put).not.toHaveBeenCalled();
  });

  it("flags image for review when score sits between review and reject thresholds", async () => {
    globalThis.fetch = mockOpenAIFetch(
      makeOpenAIModerationResponse({
        flagged: false,
        category_scores: { sexual: 0.5 },
      }),
    );

    const app = createApp();
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array(100)], "test.png", { type: "image/png" }),
    );

    const res = await app.request(
      "/images",
      { method: "POST", body: formData },
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      error: string | null;
      data: Record<string, unknown>;
    };
    expect(body.status).toBe("success");
    expect((body.data as Record<string, unknown>).flaggedForReview).toBe(true);
    // Image is uploaded to R2 even when pending review, so admins can
    // inspect it at `/admin/moderation/pending`.
    expect(mockR2Put).toHaveBeenCalledTimes(1);
  });

  it("auto-rejects when OpenAI flags an image-supported category, even if our score threshold isn't tripped", async () => {
    // OpenAI's own `flagged: true` for an image-applicable category
    // wins over our score thresholds — they have policy calibration we
    // don't (e.g. specific gore detail patterns) and false negatives on
    // a public-facing token logo are costlier than false positives.
    globalThis.fetch = mockOpenAIFetch(
      makeOpenAIModerationResponse({
        flagged: true,
        categories: { sexual: true },
        category_scores: { sexual: 0.55 },
      }),
    );

    const app = createApp();
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array(100)], "test.png", { type: "image/png" }),
    );

    const res = await app.request(
      "/images",
      { method: "POST", body: formData },
      makeEnv(),
    );

    expect(res.status).toBe(422);
    expect(mockR2Put).not.toHaveBeenCalled();
  });

  it("returns 503 when OpenAI moderation request fails", async () => {
    globalThis.fetch = mockOpenAIFetch({}, { status: 500 });

    const app = createApp();
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array(100)], "test.png", { type: "image/png" }),
    );

    const res = await app.request(
      "/images",
      { method: "POST", body: formData },
      makeEnv(),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toContain("temporarily unavailable");
    expect(mockR2Put).not.toHaveBeenCalled();
  });

  it("fails closed when the OpenAI API key is missing", async () => {
    // Asserting fail-closed is the whole point — letting unmoderated
    // content into R2 is the failure mode this endpoint exists to
    // prevent. A 503 forces the caller to retry once the key is
    // configured rather than silently shipping the upload.
    const app = createApp();
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array(100)], "test.png", { type: "image/png" }),
    );

    const res = await app.request(
      "/images",
      { method: "POST", body: formData },
      makeEnv({ OPENAI_API_KEY: undefined }),
    );

    expect(res.status).toBe(503);
    expect(mockR2Put).not.toHaveBeenCalled();
    // No outbound request should be made when the key is absent.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("uploads to R2 and returns URL on a clean OpenAI pass", async () => {
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
    // Stored URL is origin-agnostic so the same DB row renders against
    // any environment's API origin (dev, preview, prod). See issue #450.
    // Asserting `url === /images/${key}` (rather than just prefixing both)
    // pins the response down to a single coherent shape — a future
    // refactor can't accidentally return a `url` and `key` for different
    // objects.
    const data = body.data as { url: string; key: string };
    expect(data.key).toMatch(/^tokens\//);
    expect(data.url).toBe(`/images/${data.key}`);

    expect(mockR2Put).toHaveBeenCalledTimes(1);
    const [key, , options] = mockR2Put.mock.calls[0];
    expect(key).toMatch(/^tokens\//);
    expect(options.httpMetadata.contentType).toBe("image/png");
  });

  it("sends a base64 data URL to OpenAI for the moderation call", async () => {
    // Pinning the request shape — OpenAI's `omni-moderation-latest`
    // accepts a `data:<mime>;base64,...` URL via the `image_url.url`
    // field. A future refactor that drops the `data:` prefix or
    // switches to a multipart upload would silently 4xx and we'd lose
    // moderation on every upload, so the structure of this request
    // matters.
    const fetchMock = mockOpenAIFetch(makeOpenAIModerationResponse());
    globalThis.fetch = fetchMock;

    const app = createApp();
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3, 4])], "photo.png", {
        type: "image/png",
      }),
    );

    await app.request("/images", { method: "POST", body: formData }, makeEnv());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/moderations");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    const payload = JSON.parse(init.body as string) as {
      model: string;
      input: Array<{ type: string; image_url: { url: string } }>;
    };
    expect(payload.model).toBe("omni-moderation-latest");
    expect(payload.input[0].type).toBe("image_url");
    expect(payload.input[0].image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it("accepts all valid image types", async () => {
    const types = ["image/jpeg", "image/png", "image/gif", "image/webp"];

    for (const type of types) {
      vi.clearAllMocks();
      mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
      globalThis.fetch = mockOpenAIFetch(makeOpenAIModerationResponse());

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
