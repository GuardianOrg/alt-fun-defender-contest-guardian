import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

// --- DB mock ---
const mockDbReturning = vi.fn();
const mockDbOnConflictDoNothing = vi.fn().mockReturnValue({ returning: mockDbReturning });
const mockInsertValues = vi.fn().mockReturnValue({ onConflictDoNothing: mockDbOnConflictDoNothing });
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
const mockSelectWhere = vi.fn();
const mockSelectOrderBy = vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([]) }) });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere, orderBy: mockSelectOrderBy });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });
const mockDb = {
  select: mockSelect,
  insert: mockInsert,
};

vi.mock("../db/client.js", () => ({
  createDb: () => mockDb,
}));

// --- Ponder mock ---
const mockPonderQuery = vi.fn();
const mockPonderPaginatedQuery = vi.fn();
vi.mock("../lib/ponder-client.js", () => ({
  createPonderQuery: () => mockPonderQuery,
  createPonderPaginatedQuery: () => mockPonderPaginatedQuery,
}));

// --- BounceTech DB mock ---
const mockNeonQuery = vi.fn();
vi.mock("@neondatabase/serverless", () => ({
  neon: () => mockNeonQuery,
}));

// --- Global fetch mock (used by BounceTech live LT API) ---
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
vi.stubGlobal("caches", undefined);

// --- Broadcast mock ---
vi.mock("../lib/broadcast.js", () => ({
  broadcastToChannel: vi.fn().mockResolvedValue(undefined),
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

// Import route after mocks
const { default: tokensRoute } = await import("../routes/tokens/index.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/tokens", tokensRoute);
  return app;
}

function makeEnv(): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "postgres://bouncetech",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "http://localhost:42069",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {
      idFromName: () => "id",
      get: () => ({ fetch: vi.fn().mockResolvedValue(new Response("ok")) }),
    } as unknown as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    AI: {} as Ai,
  };
}

const VALID_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const VALID_CREATOR = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";

describe("POST /tokens — token creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectWhere.mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
  });

  it("returns 400 when JSON body is invalid", async () => {
    const app = createApp();
    const res = await app.request(
      "/tokens",
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
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: VALID_ADDRESS, name: "Test" }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.status).toBe("error");
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when address is invalid", async () => {
    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: "not-an-address",
          name: "Test",
          ticker: "TST",
          ltPair: VALID_ADDRESS,
          creator: VALID_CREATOR,
          signature: "0xabc",
        }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toContain("Invalid address");
  });

  it("returns 400 when ltPair is not a valid address", async () => {
    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: VALID_ADDRESS,
          name: "Test",
          ticker: "TST",
          ltPair: "not-an-address",
          creator: VALID_CREATOR,
          signature: "0xabc",
        }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toContain("Invalid LT pair address");
  });

  it("returns 401 when signature is invalid", async () => {
    mockedRecoverMessageAddress.mockRejectedValue(new Error("bad sig"));

    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: VALID_ADDRESS,
          name: "Test Token",
          ticker: "TST",
          ltPair: VALID_CREATOR,
          creator: VALID_CREATOR,
          signature: "0xbadsignature",
        }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Invalid signature");
  });

  it("returns 401 when recovered address does not match creator", async () => {
    mockedRecoverMessageAddress.mockResolvedValue(
      "0x0000000000000000000000000000000000000001",
    );

    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: VALID_ADDRESS,
          name: "Test Token",
          ticker: "TST",
          ltPair: VALID_CREATOR,
          creator: VALID_CREATOR,
          signature: "0xvalidsignature",
        }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Signature does not match creator");
  });

  it("returns 409 when token already exists", async () => {
    mockedRecoverMessageAddress.mockResolvedValue(VALID_CREATOR);
    mockDbReturning.mockResolvedValue([]);

    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: VALID_ADDRESS,
          name: "Test Token",
          ticker: "TST",
          ltPair: VALID_CREATOR,
          creator: VALID_CREATOR,
          signature: "0xvalidsignature",
        }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Token already exists");
  });

  it("returns 201 on successful token creation", async () => {
    const createdToken = {
      address: VALID_ADDRESS,
      name: "Test Token",
      ticker: "TST",
      ltPair: VALID_CREATOR,
      creator: VALID_CREATOR,
    };
    mockedRecoverMessageAddress.mockResolvedValue(VALID_CREATOR);
    mockDbReturning.mockResolvedValue([createdToken]);

    const app = createApp();
    const req = new Request("http://localhost/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: VALID_ADDRESS,
        name: "Test Token",
        ticker: "TST",
        ltPair: VALID_CREATOR,
        creator: VALID_CREATOR,
        signature: "0xvalidsignature",
      }),
    });

    const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} } as unknown as ExecutionContext;
    const res = await app.fetch(req, makeEnv(), executionCtx);

    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; error: string | null; data: Record<string, unknown> };
    expect(body.status).toBe("success");
    expect((body.data as Record<string, unknown>).name).toBe("Test Token");
  });
});

const LT_ADDR = "0xb88339CB7199b77E23DB6E890353E22632Ba630f";

function makeDbToken(overrides: Record<string, unknown> = {}) {
  return {
    address: VALID_ADDRESS,
    name: "Test",
    ticker: "TST",
    description: "",
    imageUrl: "",
    ltPair: LT_ADDR,
    ltDirection: "long",
    leverage: 2,
    underlying: "HYPE",
    status: "curve",
    graduatedAt: null,
    poolAddress: null,
    twitterUrl: "",
    telegramUrl: "",
    websiteUrl: "",
    creator: VALID_CREATOR,
    isHidden: false,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function mockBounceLtResponse(rates: Record<string, string>) {
  mockFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => ({
      data: Object.entries(rates).map(([address, exchangeRate]) => ({
        address,
        exchangeRate,
      })),
    }),
  }));
}

describe("GET /tokens/:address — token lookup with Ponder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid address", async () => {
    const app = createApp();
    const res = await app.request("/tokens/not-valid", {}, makeEnv());

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Invalid address");
  });

  it("returns 404 when token is not in database", async () => {
    mockSelectWhere.mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(404);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Token not found");
  });

  it("returns token with Ponder on-chain state + market data merged", async () => {
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    // First query: fetchTokenOnchain
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        curveSupply: "500000000000000000000000000",
        ltReserve: "1000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "2000000000000000000" });
    // Second ponder query: historical snapshots
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      dataSource?: string;
      data: Record<string, unknown>;
    };
    expect(body.status).toBe("success");
    expect(body.dataSource).toBe("live");
    expect(body.data.curveSupply).toBe("500000000000000000000000000");
    expect(body.data.ltReserve).toBe("1000000000000000000");
    expect(body.data.bondingPair).toBe("0xbondingpair");
    expect(typeof body.data.curveFilled).toBe("number");
    expect(body.data.mcapUsd).not.toBeNull();
  });

  it("returns token with degraded data source when market data is unavailable", async () => {
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      dataSource?: string;
      data: Record<string, unknown>;
    };
    expect(body.dataSource).toBe("degraded");
    expect(body.data.curveSupply).toBeNull();
    expect(body.data.ltReserve).toBeNull();
    expect(body.data.curveFilled).toBeNull();
    expect(body.data.status).toBe("curve");
  });
});

describe("GET /tokens — list tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid pagination parameters", async () => {
    const app = createApp();
    const res = await app.request("/tokens?limit=abc", {}, makeEnv());

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Invalid pagination parameters");
  });

  it("returns 400 for negative offset", async () => {
    const app = createApp();
    const res = await app.request("/tokens?offset=-1", {}, makeEnv());

    expect(res.status).toBe(400);
  });
});
