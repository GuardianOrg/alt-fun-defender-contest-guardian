import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

// Mock createDb before importing the middleware
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockDb = {
  select: mockSelect,
};

vi.mock("../db/client.js", () => ({
  createDb: () => mockDb,
}));

// Import after mock setup
const { apiKeyAuth } = await import("../middleware/api-key-auth.js");
const { hashApiKey, extractPrefix } = await import("../utils/api-key-hash.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.use("*", apiKeyAuth);
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

function makeEnv(): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    AI: {} as Ai,
  };
}

describe("apiKeyAuth middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
  });

  it("passes through when no X-API-Key header is provided", async () => {
    const app = createApp();
    const res = await app.request("/test", {}, makeEnv());

    expect(res.status).toBe(200);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("returns 401 when API key is not found in database", async () => {
    mockWhere.mockResolvedValue([]);

    const app = createApp();
    const res = await app.request(
      "/test",
      { headers: { "X-API-Key": "abcdefgh-invalid-key" } },
      makeEnv(),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Invalid API key");
  });

  it("returns 403 when API key is deactivated", async () => {
    const rawKey = "abcdefgh-test-key-123";
    const keyHash = await hashApiKey(rawKey);
    const prefix = extractPrefix(rawKey);

    mockWhere.mockResolvedValue([
      {
        id: 1,
        keyHash,
        keyPrefix: prefix,
        name: "test",
        ownerAddress: "0x1234",
        rateLimit: 100,
        isActive: false,
        createdAt: new Date(),
      },
    ]);

    const app = createApp();
    const res = await app.request(
      "/test",
      { headers: { "X-API-Key": rawKey } },
      makeEnv(),
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("API key is deactivated");
  });

  it("passes through when API key is valid and active", async () => {
    const rawKey = "validkey-test-key-456";
    const keyHash = await hashApiKey(rawKey);
    const prefix = extractPrefix(rawKey);

    mockWhere.mockResolvedValue([
      {
        id: 2,
        keyHash,
        keyPrefix: prefix,
        name: "test",
        ownerAddress: "0x1234",
        rateLimit: 100,
        isActive: true,
        createdAt: new Date(),
      },
    ]);

    const app = createApp();
    const res = await app.request(
      "/test",
      { headers: { "X-API-Key": rawKey } },
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 429 for anonymous requests when per-IP rate limit is exceeded", async () => {
    const app = createApp();

    // The anonymous rate limit is 60 req/min. Send 61 requests from the same IP.
    const ip = "203.0.113.42";
    for (let i = 0; i < 60; i++) {
      const res = await app.request(
        "/test",
        { headers: { "CF-Connecting-IP": ip } },
        makeEnv(),
      );
      expect(res.status).toBe(200);
    }

    // 61st request should be rate limited
    const res = await app.request(
      "/test",
      { headers: { "CF-Connecting-IP": ip } },
      makeEnv(),
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Rate limit exceeded");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("does not rate limit anonymous requests from different IPs", async () => {
    const app = createApp();

    // Send requests from two different IPs — each should be under the limit
    for (let i = 0; i < 30; i++) {
      const res1 = await app.request(
        "/test",
        { headers: { "CF-Connecting-IP": "10.0.0.1" } },
        makeEnv(),
      );
      expect(res1.status).toBe(200);

      const res2 = await app.request(
        "/test",
        { headers: { "CF-Connecting-IP": "10.0.0.2" } },
        makeEnv(),
      );
      expect(res2.status).toBe(200);
    }
  });

  it("returns 429 when rate limit is exceeded", async () => {
    const rawKey = "ratelimi-test-key-789";
    const keyHash = await hashApiKey(rawKey);
    const prefix = extractPrefix(rawKey);

    mockWhere.mockResolvedValue([
      {
        id: 3,
        keyHash,
        keyPrefix: prefix,
        name: "test",
        ownerAddress: "0x1234",
        rateLimit: 2,
        isActive: true,
        createdAt: new Date(),
      },
    ]);

    const app = createApp();

    // First two requests should succeed
    const res1 = await app.request(
      "/test",
      { headers: { "X-API-Key": rawKey } },
      makeEnv(),
    );
    expect(res1.status).toBe(200);

    const res2 = await app.request(
      "/test",
      { headers: { "X-API-Key": rawKey } },
      makeEnv(),
    );
    expect(res2.status).toBe(200);

    // Third request should be rate limited
    const res3 = await app.request(
      "/test",
      { headers: { "X-API-Key": rawKey } },
      makeEnv(),
    );
    expect(res3.status).toBe(429);
    const body = (await res3.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Rate limit exceeded");
    expect(res3.headers.get("Retry-After")).toBeTruthy();
  });
});
