import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const { imagesPublic, imagesPrivate } = await import("../routes/images.js");
const { __resetUploadRateLimitForTests } = await import(
  "../middleware/upload-rate-limit.js"
);
const { __resetModerationCooldownForTests } = await import(
  "../lib/image-moderation.js"
);

/**
 * Mirrors the production wiring (see `apps/api/src/index.ts`): the bare
 * `/images` prefix is the GET-only public mount, while `/api/v1/images`
 * carries the read+write surface. Tests upload against `/api/v1/images`
 * and serve against either, so we route the bare prefix to `imagesPublic`
 * and the API-versioned prefix to `imagesPrivate` exactly as `index.ts`
 * does.
 */
function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/api/v1/images", imagesPrivate);
  app.route("/images", imagesPublic);
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
  // Return a *fresh* Response on each call — Response bodies are
  // single-use streams, so mocking with `mockResolvedValue(new Response(...))`
  // would 'Body has already been read' the second time `moderateImage`
  // runs in the same test (which the rate-limit + cooldown specs need).
  const status = init.status ?? 200;
  const body = JSON.stringify(response);
  return vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(body, {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

/**
 * Minimal PNG carrying a real IHDR, so the encoding guard in
 * `image-moderation.ts` reads the bit depth / colour type it would read
 * off a genuine file. Only the header matters — nothing decodes these.
 */
function pngWithIhdr(bitDepth: number, colourType: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  bytes.set([0x00, 0x00, 0x00, 0x01], 16); // width 1
  bytes.set([0x00, 0x00, 0x00, 0x01], 20); // height 1
  bytes[24] = bitDepth;
  bytes[25] = colourType;
  return bytes;
}

/**
 * One upload from a fixed IP, for the specs that need several in a row
 * to walk the retry / backoff state machine. Defaults to an RGBA PNG so
 * the encoding guard stays out of the way.
 */
function uploadFrom(
  app: Hono<{ Bindings: AppBindings }>,
  ip: string,
  bytes: Uint8Array = pngWithIhdr(8, 6),
) {
  const formData = new FormData();
  formData.append("file", new File([bytes], "logo.png", { type: "image/png" }));
  return app.request(
    "/api/v1/images",
    {
      method: "POST",
      body: formData,
      headers: { "CF-Connecting-IP": ip, Host: "api.altfun.com" },
    },
    makeEnv(),
  );
}

function makeEnv(overrides: Partial<AppBindings> = {}): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    OPENAI_API_KEY: "sk-test",
    IMAGES_BUCKET: {
      put: mockR2Put,
      get: mockR2Get,
    } as unknown as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

/**
 * Drives an upload through the *private* mount at `/api/v1/images` so
 * tests exercise the same wiring as production. A previous regression
 * had the upload route shadow-mounted at the bare `/images` prefix with
 * no auth and no rate limit (issue #509); routing the test through the
 * private mount makes sure we don't reintroduce that.
 */
async function uploadRequest(
  app: Hono<{ Bindings: AppBindings }>,
  init: RequestInit,
  env: AppBindings = makeEnv(),
) {
  return app.request("/api/v1/images", init, env);
}

describe("POST /api/v1/images — image upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    globalThis.fetch = mockOpenAIFetch(makeOpenAIModerationResponse());
    __resetUploadRateLimitForTests();
    __resetModerationCooldownForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 400 when no file is uploaded", async () => {
    const app = createApp();
    const formData = new FormData();
    const res = await uploadRequest(app, { method: "POST", body: formData });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("No file uploaded");
  });

  it("returns 400 for invalid file type", async () => {
    const app = createApp();
    const formData = new FormData();
    formData.append("file", new File(["data"], "test.txt", { type: "text/plain" }));

    const res = await uploadRequest(app, { method: "POST", body: formData });

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

    const res = await uploadRequest(app, { method: "POST", body: formData });

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

    const res = await uploadRequest(app, { method: "POST", body: formData });

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

    const res = await uploadRequest(app, { method: "POST", body: formData });

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

    const res = await uploadRequest(app, { method: "POST", body: formData });

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

    const res = await uploadRequest(app, { method: "POST", body: formData });

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toContain("temporarily unavailable");
    expect(mockR2Put).not.toHaveBeenCalled();
  });

  it.each([
    ["8-bit grayscale + alpha", 8, 4],
    ["16-bit grayscale", 16, 0],
  ])(
    "returns 400 without calling OpenAI for a %s PNG",
    async (_label, bitDepth, colourType) => {
      // OpenAI reports "I can't decode this file" with the same 500 it
      // uses for its own outages, which used to strand the uploader on
      // retry-forever copy *and* arm the 30s cooldown against everyone
      // else on the isolate. Both encodings are ordinary Pillow /
      // ImageMagick output for a monochrome logo with transparency.
      const app = createApp();
      const formData = new FormData();
      formData.append(
        "file",
        new File([pngWithIhdr(bitDepth, colourType)], "logo.png", {
          type: "image/png",
        }),
      );

      const res = await uploadRequest(app, { method: "POST", body: formData });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { status: string; error: string | null; data: unknown };
      expect(body.error).toContain("could not be read");
      // Fail-closed, and cheap: no R2 write, no `moderation_logs` row
      // (nothing was classified), and no request spent on OpenAI.
      expect(mockR2Put).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["8-bit grayscale", 8, 0],
    ["RGB", 8, 2],
    ["palette", 8, 3],
    ["RGBA", 8, 6],
    ["16-bit RGBA", 16, 6],
    // The near misses that matter most: each is one field away from a
    // rejected pair and verified to moderate fine against the live
    // endpoint, so a guard that matched on colour type alone (or bit
    // depth alone) would start rejecting valid logos.
    ["16-bit grayscale + alpha", 16, 4],
    ["1-bit grayscale", 1, 0],
    ["4-bit grayscale", 4, 0],
  ])("still moderates a %s PNG", async (_label, bitDepth, colourType) => {
    const app = createApp();
    const formData = new FormData();
    formData.append(
      "file",
      new File([pngWithIhdr(bitDepth, colourType)], "logo.png", {
        type: "image/png",
      }),
    );

    const res = await uploadRequest(app, { method: "POST", body: formData });

    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(mockR2Put).toHaveBeenCalledTimes(1);
  });

  it("only reads the IHDR of an actual PNG, not of any payload", async () => {
    // Without the signature gate this buffer would be read as 8-bit
    // grayscale-plus-alpha and rejected, taking WebP / JPEG / GIF
    // uploads that happen to carry those byte values with it.
    const notPng = pngWithIhdr(8, 4);
    notPng[0] = 0x52; // break the PNG signature ("RIFF"-ish first byte)

    const app = createApp();
    const formData = new FormData();
    formData.append(
      "file",
      new File([notPng], "logo.webp", { type: "image/webp" }),
    );

    const res = await uploadRequest(app, { method: "POST", body: formData });

    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no result fields at all", {}],
    ["no verdict", { categories: {}, category_scores: {} }],
    ["a verdict but nothing scored", { flagged: false, categories: {}, category_scores: {} }],
  ])("fails closed on a 200 carrying %s", async (_label, result) => {
    // The dangerous one is the third: every score reads as absent, so
    // `decide` finds nothing to reject and would hand back `safe` for an
    // image nothing ever looked at, putting it in R2 unmoderated.
    globalThis.fetch = mockOpenAIFetch({
      id: "modr-test",
      model: "omni-moderation-latest",
      results: [result],
    });

    const app = createApp();
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array(100)], "test.png", { type: "image/png" }),
    );

    const res = await uploadRequest(app, { method: "POST", body: formData });

    expect(res.status).toBe(503);
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

    const res = await uploadRequest(
      app,
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

    const res = await uploadRequest(app, { method: "POST", body: formData });

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

    await uploadRequest(app, { method: "POST", body: formData });

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
      __resetUploadRateLimitForTests();

      const app = createApp();
      const formData = new FormData();
      const ext = type.split("/")[1];
      formData.append(
        "file",
        new File([new Uint8Array(100)], `test.${ext}`, { type }),
      );

      const res = await uploadRequest(app, { method: "POST", body: formData });

      expect(res.status).toBe(200);
    }
  });
});

describe("POST /images — bare-prefix mount is read-only (issue #509)", () => {
  // The bare `/images` prefix exists so on-chain image URLs
  // (`/images/{prefix}/{key}`, see issue #450) resolve via the same
  // Worker. Before this fix, the same router was mounted at both
  // `/api/v1/images` (gated by `apiKeyAuth`) and `/images` (no auth, no
  // rate limit), so `POST /images` was reachable by any anonymous
  // client. Pin the behaviour so a future router refactor can't
  // reintroduce the bypass.
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockOpenAIFetch(makeOpenAIModerationResponse());
    __resetUploadRateLimitForTests();
    __resetModerationCooldownForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does not expose POST on the bare /images mount", async () => {
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

    // Hono returns 404 for an unmatched method+path on a router. The
    // important assertion is that we did NOT reach the upload handler:
    // no R2 PUT, no OpenAI call.
    expect(res.status).not.toBe(200);
    expect(mockR2Put).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/images — per-IP write quota (issue #509)", () => {
  // Defensive fallback behind the planned Cloudflare edge rule. Hard
  // limit of 10 req/min/IP to keep the OpenAI moderation call + R2 PUT
  // + Neon insert cost bounded under local `wrangler dev` or if the
  // edge rule is missing/misconfigured.
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    globalThis.fetch = mockOpenAIFetch(makeOpenAIModerationResponse());
    __resetUploadRateLimitForTests();
    __resetModerationCooldownForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function buildUpload() {
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array(100)], "test.png", { type: "image/png" }),
    );
    return formData;
  }

  it("rate-limits an IP after 10 uploads in the window", async () => {
    const app = createApp();
    const prodHeaders = {
      "CF-Connecting-IP": "198.51.100.7",
      Host: "api.altfun.com",
    };

    for (let i = 0; i < 10; i++) {
      const res = await app.request(
        "/api/v1/images",
        { method: "POST", body: buildUpload(), headers: prodHeaders },
        makeEnv(),
      );
      expect(res.status).toBe(200);
    }

    const res = await app.request(
      "/api/v1/images",
      { method: "POST", body: buildUpload(), headers: prodHeaders },
      makeEnv(),
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as {
      status: string;
      error: string | null;
      data: unknown;
    };
    expect(body.error).toBe("Rate limit exceeded");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("buckets per-IP — a second IP retains its full budget after the first IP is throttled", async () => {
    const app = createApp();
    const prodHostHeader = { Host: "api.altfun.com" };

    for (let i = 0; i < 11; i++) {
      await app.request(
        "/api/v1/images",
        {
          method: "POST",
          body: buildUpload(),
          headers: { ...prodHostHeader, "CF-Connecting-IP": "198.51.100.1" },
        },
        makeEnv(),
      );
    }

    const res = await app.request(
      "/api/v1/images",
      {
        method: "POST",
        body: buildUpload(),
        headers: { ...prodHostHeader, "CF-Connecting-IP": "198.51.100.2" },
      },
      makeEnv(),
    );
    expect(res.status).toBe(200);
  });

  it("bypasses the limiter on loopback Hosts (local dev parity with apiKeyAuth)", async () => {
    // Same rationale as `apiKeyAuth`'s loopback bypass: under
    // `wrangler dev` Miniflare populates `CF-Connecting-IP` with a
    // loopback address, so all local sessions share a single bucket and
    // the limiter would 429 within seconds. Detect dev via the `Host`
    // header (Cloudflare rewrites it in production — impossible to
    // spoof) and skip.
    const app = createApp();
    for (let i = 0; i < 25; i++) {
      const res = await app.request(
        "/api/v1/images",
        {
          method: "POST",
          body: buildUpload(),
          headers: { Host: "localhost:8787", "CF-Connecting-IP": "127.0.0.1" },
        },
        makeEnv(),
      );
      expect(res.status).toBe(200);
    }
  });
});

describe("POST /api/v1/images — OpenAI cooldown cache (issue #509)", () => {
  // Once OpenAI returns 429 / 5xx, short-circuit subsequent calls for
  // `COOLDOWN_MS` so we don't compound their rate limit during abuse
  // bursts. Legitimate users during the burst get the same 503 they
  // would have gotten anyway — without us spending a request to learn it.
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    __resetUploadRateLimitForTests();
    __resetModerationCooldownForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("short-circuits subsequent calls after a 429 from OpenAI without re-hitting OpenAI", async () => {
    const fetchMock = mockOpenAIFetch({}, { status: 429 });
    globalThis.fetch = fetchMock;

    const app = createApp();
    const headers = {
      "CF-Connecting-IP": "198.51.100.50",
      Host: "api.altfun.com",
    };

    const formData1 = new FormData();
    formData1.append(
      "file",
      new File([new Uint8Array(100)], "a.png", { type: "image/png" }),
    );
    const res1 = await app.request(
      "/api/v1/images",
      { method: "POST", body: formData1, headers },
      makeEnv(),
    );
    expect(res1.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const formData2 = new FormData();
    formData2.append(
      "file",
      new File([new Uint8Array(100)], "b.png", { type: "image/png" }),
    );
    const res2 = await app.request(
      "/api/v1/images",
      { method: "POST", body: formData2, headers },
      makeEnv(),
    );
    expect(res2.status).toBe(503);
    // Critical assertion: the second request did NOT call OpenAI again.
    // Hammering them with retries after a 429 extends the penalty.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockR2Put).not.toHaveBeenCalled();
  });

  it("retries a 5xx once and returns the retry's verdict", async () => {
    // OpenAI's 500 is usually a single-request fault, and moderation is
    // idempotent, so the retry turns it into a clean pass rather than a
    // 503 the user has to act on.
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(new Response("{}", { status: 500 })),
      )
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify(makeOpenAIModerationResponse()), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );
    globalThis.fetch = fetchMock;

    const res = await uploadFrom(createApp(), "198.51.100.55");

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockR2Put).toHaveBeenCalledTimes(1);
  });

  it("lets the next upload through instead of backing off on one failure", async () => {
    // One failed upload is not an outage. Arming the cooldown on it
    // would turn one person's bad luck into a 30s outage for everyone
    // else routed through this isolate.
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(new Response("{}", { status: 500 })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(new Response("{}", { status: 500 })),
      )
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify(makeOpenAIModerationResponse()), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );
    globalThis.fetch = fetchMock;
    const app = createApp();

    const failed = await uploadFrom(app, "198.51.100.56");
    expect(failed.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const next = await uploadFrom(app, "198.51.100.56");
    expect(next.status).toBe(200);
  });

  it("backs off and raises an alert after three consecutive failures", async () => {
    const fetchMock = mockOpenAIFetch({}, { status: 503 });
    globalThis.fetch = fetchMock;
    const logSpy = vi.spyOn(console, "log");
    const app = createApp();

    for (let i = 0; i < 3; i++) {
      const res = await uploadFrom(app, "198.51.100.51");
      expect(res.status).toBe(503);
    }
    // Three uploads, each retried once.
    expect(fetchMock).toHaveBeenCalledTimes(6);

    const alerts = logSpy.mock.calls
      .map(([line]) => (typeof line === "string" ? line : ""))
      .filter((line) => line.includes("openai_moderation_repeated_failures"));
    // On-call alerts match this event name — one per cooldown window, so
    // a sustained outage pages once rather than per upload.
    expect(alerts).toHaveLength(1);
    expect(JSON.parse(alerts[0]).level).toBe("error");
    expect(JSON.parse(alerts[0]).consecutiveFailures).toBe(3);
    logSpy.mockRestore();

    const afterBackoff = await uploadFrom(app, "198.51.100.51");
    expect(afterBackoff.status).toBe(503);
    // Cooldown armed — no further requests spent on a known-sick upstream.
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("does not let an undecodable PNG arm the cooldown against other callers", async () => {
    // The blast radius is the point: the encoding guard runs before the
    // OpenAI call, so the 5xx that used to 503 every other caller on
    // this isolate for 30s never happens.
    const fetchMock = mockOpenAIFetch(makeOpenAIModerationResponse());
    globalThis.fetch = fetchMock;

    const app = createApp();
    const headers = {
      "CF-Connecting-IP": "198.51.100.54",
      Host: "api.altfun.com",
    };

    const badUpload = new FormData();
    badUpload.append(
      "file",
      new File([pngWithIhdr(8, 4)], "grayscale-alpha.png", { type: "image/png" }),
    );
    const res1 = await app.request(
      "/api/v1/images",
      { method: "POST", body: badUpload, headers },
      makeEnv(),
    );
    expect(res1.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    const goodUpload = new FormData();
    goodUpload.append(
      "file",
      new File([pngWithIhdr(8, 6)], "fine.png", { type: "image/png" }),
    );
    const res2 = await app.request(
      "/api/v1/images",
      { method: "POST", body: goodUpload, headers },
      makeEnv(),
    );
    expect(res2.status).toBe(200);
    expect(mockR2Put).toHaveBeenCalledTimes(1);
  });

  it("treats a result missing its score maps as a payload problem, not an outage", async () => {
    // Most likely an upstream schema change. Classifying it as unhealthy
    // would retry every upload and then page the on-call about an
    // "outage" that no amount of waiting fixes.
    globalThis.fetch = mockOpenAIFetch({
      id: "modr-test",
      model: "omni-moderation-latest",
      results: [{}],
    });
    const app = createApp();

    for (let i = 0; i < 4; i++) {
      const res = await uploadFrom(app, "198.51.100.60");
      expect(res.status).toBe(503);
    }
    // One call per upload: no retry, and no backoff after three of them.
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    expect(mockR2Put).not.toHaveBeenCalled();
  });

  it("raises one alert even when the streak breaks on concurrent uploads", async () => {
    // Uploads already in flight when the third failure lands also see a
    // broken streak. Without the alert floor each one would page.
    globalThis.fetch = mockOpenAIFetch({}, { status: 503 });
    const logSpy = vi.spyOn(console, "log");
    const app = createApp();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => uploadFrom(app, "198.51.100.58")),
    );

    for (const res of results) expect(res.status).toBe(503);
    const alerts = logSpy.mock.calls
      .map(([line]) => (typeof line === "string" ? line : ""))
      .filter((line) => line.includes("openai_moderation_repeated_failures"));
    expect(alerts).toHaveLength(1);
    logSpy.mockRestore();
  });

  it("does not retry when the first attempt spent the whole budget", async () => {
    // The retry shares one budget with the first attempt, so a slow
    // failure gets no second try — the point is that choosing to retry
    // can never double the wait the caller already signed up for.
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(
        (_url: unknown, init: { signal: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
          }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const pending = uploadFrom(createApp(), "198.51.100.59");
      await vi.advanceTimersByTimeAsync(26_000);

      expect((await pending).status).toBe(503);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts a request that never yields a status toward the backoff streak", async () => {
    // A hung upstream times out before returning 5xx (AbortError) and a
    // dead TCP path throws outright. Both are the "upstream is unhealthy
    // from this isolate" case the cooldown exists to dampen — without
    // counting them, a slow OpenAI would escape backoff entirely and
    // every upload would burn the full budget for the whole burst.
    const fetchMock = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      );
    globalThis.fetch = fetchMock;

    const app = createApp();

    for (let i = 0; i < 3; i++) {
      const res = await uploadFrom(app, "198.51.100.53");
      expect(res.status).toBe(503);
    }
    expect(fetchMock).toHaveBeenCalledTimes(6);

    const afterBackoff = await uploadFrom(app, "198.51.100.53");
    expect(afterBackoff.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("does not trip the cooldown on a 4xx that isn't 429 (auth / payload errors)", async () => {
    // 401 / 403 / 400 mean *we* are wrong (revoked key, malformed
    // payload). Retrying doesn't hurt OpenAI, so it shouldn't penalise
    // downstream callers either. Keep this test specific so a future
    // refactor that broadens the cooldown branch trips it.
    globalThis.fetch = mockOpenAIFetch({}, { status: 401 });
    const app = createApp();
    const headers = {
      "CF-Connecting-IP": "198.51.100.52",
      Host: "api.altfun.com",
    };

    const formData1 = new FormData();
    formData1.append(
      "file",
      new File([new Uint8Array(100)], "a.png", { type: "image/png" }),
    );
    const res1 = await app.request(
      "/api/v1/images",
      { method: "POST", body: formData1, headers },
      makeEnv(),
    );
    expect(res1.status).toBe(503);

    // Second call hits OpenAI again — the cooldown didn't fire.
    const formData2 = new FormData();
    formData2.append(
      "file",
      new File([new Uint8Array(100)], "b.png", { type: "image/png" }),
    );
    const res2 = await app.request(
      "/api/v1/images",
      { method: "POST", body: formData2, headers },
      makeEnv(),
    );
    expect(res2.status).toBe(503);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
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
    // Content-addressed blob: without the zone directive every first
    // view by every visitor was still a Worker invocation plus an R2
    // read.
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
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
