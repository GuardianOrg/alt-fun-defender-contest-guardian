import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

// --- DB mock ---
const mockDbReturning = vi.fn();
const mockInsertValues = vi.fn().mockReturnValue({ returning: mockDbReturning });
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
const mockSelectOffset = vi.fn().mockResolvedValue([]);
const mockSelectLimit = vi.fn().mockReturnValue({ offset: mockSelectOffset });
const mockSelectOrderBy = vi.fn().mockReturnValue({ limit: mockSelectLimit });
const mockSelectWhere = vi.fn().mockReturnValue({ orderBy: mockSelectOrderBy });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });
const mockDb = {
  select: mockSelect,
  insert: mockInsert,
};

vi.mock("../db/client.js", () => ({
  createDb: () => mockDb,
}));

// --- Signature mock ---
vi.mock("viem", async () => {
  const actual = await vi.importActual("viem");
  return {
    ...actual,
    recoverMessageAddress: vi.fn(),
  };
});

const { recoverMessageAddress } = await import("viem");
const mockedRecoverMessageAddress = vi.mocked(recoverMessageAddress);

const { default: commentsRoute } = await import("../routes/comments.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/tokens", commentsRoute);
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

const VALID_TOKEN = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const VALID_AUTHOR = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";

describe("GET /tokens/:address/comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectWhere.mockReturnValue({ orderBy: mockSelectOrderBy });
  });

  it("returns 400 for invalid address", async () => {
    const app = createApp();
    const res = await app.request("/tokens/not-valid/comments", {}, makeEnv());

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Invalid address");
  });

  it("returns comments for valid address", async () => {
    const items = [
      { id: 1, tokenAddress: VALID_TOKEN, author: VALID_AUTHOR, content: "hello", createdAt: new Date().toISOString() },
    ];
    mockSelectOffset.mockResolvedValue(items);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_TOKEN}/comments`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.status).toBe("success");
    expect(body.data).toHaveLength(1);
  });
});

describe("POST /tokens/:address/comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid token address", async () => {
    const app = createApp();
    const res = await app.request(
      "/tokens/not-valid/comments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: VALID_AUTHOR,
          content: "hello",
          signature: "0xabc",
          timestamp: Date.now(),
        }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Invalid address");
  });

  it("returns 400 for invalid JSON body", async () => {
    const app = createApp();
    const res = await app.request(
      `/tokens/${VALID_TOKEN}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not json",
      },
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.status).toBe("error");
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when required fields are missing", async () => {
    const app = createApp();
    const res = await app.request(
      `/tokens/${VALID_TOKEN}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: VALID_AUTHOR }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.status).toBe("error");
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when content exceeds 500 chars", async () => {
    const app = createApp();
    const res = await app.request(
      `/tokens/${VALID_TOKEN}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: VALID_AUTHOR,
          content: "x".repeat(501),
          signature: "0xabc",
          timestamp: Date.now(),
        }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toContain("Comment too long (max 500 chars)");
  });

  it("returns 400 when author address is invalid", async () => {
    const app = createApp();
    const res = await app.request(
      `/tokens/${VALID_TOKEN}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "not-an-address",
          content: "hello",
          signature: "0xabc",
          timestamp: Date.now(),
        }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toContain("Invalid author address");
  });

  it("returns 401 when signature timestamp is expired", async () => {
    const app = createApp();
    const expiredTimestamp = Date.now() - 6 * 60 * 1000; // 6 minutes ago
    const res = await app.request(
      `/tokens/${VALID_TOKEN}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: VALID_AUTHOR,
          content: "hello",
          signature: "0xabc",
          timestamp: expiredTimestamp,
        }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Expired signature timestamp");
  });

  it("returns 401 when signature is invalid", async () => {
    mockedRecoverMessageAddress.mockRejectedValue(new Error("bad sig"));

    const app = createApp();
    const res = await app.request(
      `/tokens/${VALID_TOKEN}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: VALID_AUTHOR,
          content: "hello",
          signature: "0xbadsig",
          timestamp: Date.now(),
        }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Invalid signature");
  });

  it("returns 401 when recovered address does not match author", async () => {
    mockedRecoverMessageAddress.mockResolvedValue(
      "0x0000000000000000000000000000000000000001",
    );

    const app = createApp();
    const res = await app.request(
      `/tokens/${VALID_TOKEN}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: VALID_AUTHOR,
          content: "hello",
          signature: "0xsig",
          timestamp: Date.now(),
        }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Signature does not match author");
  });

  it("returns 201 on successful comment creation", async () => {
    const comment = {
      id: 1,
      tokenAddress: VALID_TOKEN,
      author: VALID_AUTHOR,
      content: "hello",
      createdAt: new Date().toISOString(),
    };
    mockedRecoverMessageAddress.mockResolvedValue(VALID_AUTHOR);
    mockDbReturning.mockResolvedValue([comment]);

    const app = createApp();
    const res = await app.request(
      `/tokens/${VALID_TOKEN}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: VALID_AUTHOR,
          content: "hello",
          signature: "0xvalidsig",
          timestamp: Date.now(),
        }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; error: string | null; data: Record<string, unknown> };
    expect(body.status).toBe("success");
    expect((body.data as Record<string, unknown>).content).toBe("hello");
  });

  it("returns 400 when timestamp is not a number", async () => {
    const app = createApp();
    const res = await app.request(
      `/tokens/${VALID_TOKEN}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: VALID_AUTHOR,
          content: "hello",
          signature: "0xabc",
          timestamp: "not-a-number",
        }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.status).toBe("error");
    expect(body.error).toBeTruthy();
  });
});
