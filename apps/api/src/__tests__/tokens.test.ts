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

// Pin the graduation threshold to a fixed test value so the curve-fill
// percentage assertions below stay valid as the production default
// (`DEFAULT_GRADUATION_THRESHOLD_USD` in `@launchpad/shared`) is retuned.
// The fixture math throughout this file is sized for $12K — we don't want
// these unit tests to keep migrating each time the dial moves on-chain.
// `protocol-config.getGraduationThresholdUsd` is route-level concern, so
// mocking it at the module boundary is the cleanest way to isolate the
// curve math from external config drift.
vi.mock("../lib/protocol-config.js", () => ({
  getGraduationThresholdUsd: vi.fn(async () => 12_000),
  _resetGraduationThresholdCache: vi.fn(),
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

  it("returns 400 when name is too long (byte length)", async () => {
    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: VALID_ADDRESS,
          name: "A".repeat(35),
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
    expect(body.error).toContain("Name too long");
  });

  it("returns 400 when ticker is too long (byte length)", async () => {
    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: VALID_ADDRESS,
          name: "Test",
          ticker: "A".repeat(11),
          ltPair: VALID_ADDRESS,
          creator: VALID_CREATOR,
          signature: "0xabc",
        }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toContain("Ticker too long");
  });

  it("rejects multi-byte symbols that exceed the on-chain byte limit", async () => {
    // 4 emojis = 16 UTF-8 bytes (> 10 byte ticker cap), but only 8 UTF-16
    // code units, so a plain `.max(10)` on JS string length would let this
    // through and it would revert on-chain.
    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: VALID_ADDRESS,
          name: "Test",
          ticker: "🚀🚀🚀🚀",
          ltPair: VALID_ADDRESS,
          creator: VALID_CREATOR,
          signature: "0xabc",
        }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toContain("Ticker too long");
  });

  it("returns 400 when name is empty", async () => {
    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: VALID_ADDRESS,
          name: "",
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
    expect(body.error).toContain("Name is required");
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
    // `curveSupply` / `ltReserve` are the *virtual* AMM reserves (what
    // `Bonding.Trade` emits). `k` = TOTAL_SUPPLY × virtualLtAtLaunch; with
    // virtualLtAtLaunch = 2000 LT (= $4K at $2/LT launch rate) → k = 2e48.
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "2000000000000000000000000000000000000000000000000",
        curveSupply: "500000000000000000000000000",
        ltReserve: "2000000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        organicUsdcRaised: "0",
        volumeUsd: "12500000",
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
    expect(body.data.ltReserve).toBe("2000000000000000000000");
    expect(body.data.bondingPair).toBe("0xbondingpair");
    expect(typeof body.data.curveFilled).toBe("number");
    expect(body.data.curveFilledOrganic).not.toBeNull();
    expect(body.data.curveFilledLeverageBoost).not.toBeNull();
    expect(body.data.mcapUsd).not.toBeNull();
    expect(body.data.totalVolumeUsd).toBe(12.5);
  });

  it("returns totalVolumeUsd = 0 when the token has been indexed but never traded", async () => {
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "2000000000000000000000000000000000000000000000000",
        curveSupply: "1000000000000000000000000000",
        ltReserve: "2000000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        organicUsdcRaised: "0",
        volumeUsd: "0",
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "2000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    const body = (await res.json()) as { data: { totalVolumeUsd: number | null } };
    expect(body.data.totalVolumeUsd).toBe(0);
  });

  it("splits curveFilled into organic USD vs LT boost", async () => {
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    // Virtual-reserve math:
    //   k = 1e48 ⇒ virtualLtAtLaunch = k / TOTAL_SUPPLY = 1000 LT
    //   reserve1 = 1600 LT ⇒ realLt = 1600 − 1000 = 600 LT
    //   @ $4/LT ⇒ usdRaised = $2,400 ⇒ usdFilled = 20%
    //   reserve0 = 850M ⇒ realRemaining = 850M − 250M = 600M ⇒ supplyFilled = 20%
    //   total = max(20%, 20%) = 20%
    //   organic = $1,200 / $12K = 10%; boost = total − organic = 10%.
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "1000000000000000000000000000000000000000000000000",
        curveSupply: "850000000000000000000000000",
        ltReserve: "1600000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        organicUsdcRaised: "1200000000",
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "4000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: {
        curveFilled: number;
        curveFilledOrganic: number;
        curveFilledLeverageBoost: number;
      };
    };
    expect(body.data.curveFilled).toBeCloseTo(20, 1);
    expect(body.data.curveFilledOrganic).toBeCloseTo(10, 1);
    expect(body.data.curveFilledLeverageBoost).toBeCloseTo(10, 1);
  });

  it("clamps leverageBoost to 0 when the LT has dropped", async () => {
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    // Token launched at $4/LT (so virtualLtAtLaunch = 1000 LT, k = 1e48),
    // user put $3,000 organic in → bought ~750 LT worth into reserve1
    // (reserve1 = 1000 + 750 = 1750 LT). LT then dropped to $2/LT.
    // Now: realLt = 750 LT @ $2 = $1,500 → usdFilled = 12.5%.
    // supplyFilled: reserve0 = 950M → realRemaining = 700M → sold = 50M
    // → supplyFilled ≈ 6.67%. total = max(6.67%, 12.5%) = 12.5%.
    // organic = $3,000/$12K = 25%, clamped to total = 12.5%; boost = 0.
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "1000000000000000000000000000000000000000000000000",
        curveSupply: "950000000000000000000000000",
        ltReserve: "1750000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        organicUsdcRaised: "3000000000",
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "2000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    const body = (await res.json()) as {
      data: {
        curveFilled: number;
        curveFilledOrganic: number;
        curveFilledLeverageBoost: number;
      };
    };
    expect(body.data.curveFilled).toBeCloseTo(12.5, 1);
    expect(body.data.curveFilledOrganic).toBeCloseTo(12.5, 1);
    expect(body.data.curveFilledLeverageBoost).toBe(0);
  });

  it("uses USD raised as the headline, not the supply-side AMM lead", async () => {
    // Regression for the user-visible "23% buy pressure on a $20 raise toward
    // a $300 threshold" bug. Under the constant-product AMM, every dollar
    // moves the supply-% counter way faster than the USD-% counter, so the
    // previous `total = max(supplyFilled, usdFilled)` formula made a fresh
    // token with $20 of seed buys look ~3× further along than the dollars
    // actually represented. The headline must track USD raised — that's the
    // framing users think in ("we need $X, we've put in $Y, we're Y/X
    // there"). The supply trigger is a bear-market backstop, not a progress
    // signal.
    //
    // Fixture: $20 organic USDC in a token launched against a flat LT at
    // $1/LT, with a $12K threshold (test-suite default — see top-of-file
    // mock). `VIRTUAL_LIQUIDITY_USD` modelled at $100 to surface the
    // supply-vs-USD divergence:
    //   k = 1B × 100 LT virtualLtAtLaunch = 1e29 (× 1e18 fixed-point = 1e47).
    //   reserve1 = 120 LT (100 virtual + 20 real), reserve0 = k/r1 ≈ 833.33M
    //   → supplyFilled ≈ 22.2%, but realLt = 20 → usdFilled = 20/12000 ≈
    //   0.167%. New formula: total = usdFilled ≈ 0.17%, organic ≈ 0.17%,
    //   leverageBoost = 0.
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "100000000000000000000000000000000000000000000000",
        curveSupply: "833333333333333333333333333",
        ltReserve: "120000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        organicUsdcRaised: "20000000",
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "1000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    const body = (await res.json()) as {
      data: {
        curveFilled: number;
        curveFilledOrganic: number;
        curveFilledLeverageBoost: number;
      };
    };
    // Headline = USD raised / threshold, NOT supply-% (which would be ~22%).
    expect(body.data.curveFilled).toBeCloseTo(0.167, 2);
    expect(body.data.curveFilledOrganic).toBeCloseTo(0.167, 2);
    expect(body.data.curveFilledLeverageBoost).toBe(0);
  });

  it("returns null split (not 0) when organicUsdcRaised is missing from indexer", async () => {
    // Guards against indexer-version skew: a stale indexer response could be
    // missing `organicUsdcRaised` while every other field is present. Treating
    // that as `organic=0` would render the bar as 100% leverage boost, which
    // is a lie. We surface `null` so the frontend falls back to a solid fill.
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "1000000000000000000000000000000000000000000000000",
        curveSupply: "850000000000000000000000000",
        ltReserve: "1600000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        // organicUsdcRaised intentionally omitted
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "4000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        curveFilled: number;
        curveFilledOrganic: number | null;
        curveFilledLeverageBoost: number | null;
      };
    };
    // Total still computable from ltReserve × exchangeRate.
    expect(body.data.curveFilled).toBeCloseTo(20, 1);
    // ...but the split is "unknown", not "all leverage".
    expect(body.data.curveFilledOrganic).toBeNull();
    expect(body.data.curveFilledLeverageBoost).toBeNull();
  });

  it("reports 0% at launch (virtual reserve0 = TOTAL_SUPPLY)", async () => {
    // Regression test for the virtual-vs-real-reserves fix. At launch the
    // indexer persists reserve0 = TOTAL_SUPPLY (1B × 1e18), not 0. Naive
    // "remaining / CURVE_ALLOCATION" math would report −33% (or silently 0%
    // only via an early-return). We want a genuine 0% here.
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "1000000000000000000000000000000000000000000000000",
        // TOTAL_SUPPLY = 1B × 1e18, untouched curve
        curveSupply: "1000000000000000000000000000",
        // virtualLtAtLaunch = k / TOTAL_SUPPLY = 1000 × 1e18
        ltReserve: "1000000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        organicUsdcRaised: "0",
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "4000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    const body = (await res.json()) as {
      data: {
        curveFilled: number;
        curveFilledOrganic: number;
        curveFilledLeverageBoost: number;
      };
    };
    expect(body.data.curveFilled).toBe(0);
    expect(body.data.curveFilledOrganic).toBe(0);
    expect(body.data.curveFilledLeverageBoost).toBe(0);
  });

  it("reports 100% at full sellout (virtual reserve0 = LP_RESERVE)", async () => {
    // Regression test: at full sellout reserve0 floors at LP_RESERVE_RAW
    // (250M × 1e18), not 0. Pre-fix math reported ~66.67% here.
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "1000000000000000000000000000000000000000000000000",
        // reserve0 = LP_RESERVE_RAW = 250M × 1e18
        curveSupply: "250000000000000000000000000",
        // AMM invariant at sellout: reserve1 = k / reserve0 = 4000 LT
        ltReserve: "4000000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        organicUsdcRaised: "0",
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "4000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    const body = (await res.json()) as {
      data: {
        curveFilled: number;
        curveFilledOrganic: number;
        curveFilledLeverageBoost: number;
      };
    };
    expect(body.data.curveFilled).toBe(100);
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
    expect(body.data.totalVolumeUsd).toBeNull();
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
