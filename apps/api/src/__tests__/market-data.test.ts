import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppBindings } from "../lib/types.js";

const mockFetchTokensOnchainByAddresses = vi.fn();
const mockFetchTokenOnchain = vi.fn();
const mockFetchHistoricalCurveSnapshots = vi.fn();
const mockFetchRouterTradeActivity = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchTokensOnchainByAddresses: (...args: unknown[]) =>
    mockFetchTokensOnchainByAddresses(...args),
  fetchTokenOnchain: (...args: unknown[]) => mockFetchTokenOnchain(...args),
  fetchHistoricalCurveSnapshots: (...args: unknown[]) =>
    mockFetchHistoricalCurveSnapshots(...args),
  fetchRouterTradeActivity: (...args: unknown[]) =>
    mockFetchRouterTradeActivity(...args),
  // Functions market-data.ts doesn't reach in this test surface but the
  // module still imports — stub them so the module compiles under
  // `vi.mock`'s factory.
  fetchGraduatedTokensOnchain: vi.fn(),
  fetchNonGraduatedTokensOnchain: vi.fn(),
  fetchTrendingCandidateAddresses: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  createDb: () => ({}),
}));

const mockNeonQuery = vi.fn();
vi.mock("@neondatabase/serverless", () => ({
  neon: () => mockNeonQuery,
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
vi.stubGlobal("caches", undefined);

const { default: marketDataRoute } = await import("../routes/market-data.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/market-data", marketDataRoute);
  return app;
}

function makeEnv(): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "postgres://bouncetech",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "http://localhost:42069",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
  };
}

// Valid EIP-55 checksums — `isAddress()` rejects all-lowercase long hex with
// mixed expected characters, so we use real checksummed addresses here.
const TOKEN_A = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const LT_A = "0xb88339CB7199b77E23DB6E890353E22632Ba630f";

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

function snapshotMapForCutoff(addr: string, supply: string, reserve: string) {
  // Mirrors the `Map<lowercaseAddress, snapshot | null>` shape that
  // `fetchHistoricalCurveSnapshots` resolves to. Empty entries map to
  // `null` so the route's fallback-to-current-curve path can be exercised.
  return new Map<
    string,
    { curveSupply: string; ltReserve: string; timestamp: string } | null
  >([
    [
      addr.toLowerCase(),
      { curveSupply: supply, ltReserve: reserve, timestamp: "1699999000" },
    ],
  ]);
}

function postMarketData(addresses: string[]) {
  return createApp().request(
    "/market-data",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses }),
    },
    makeEnv(),
  );
}

describe("POST /market-data { addresses } — input validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 400 on a non-JSON body", async () => {
    const res = await createApp().request(
      "/market-data",
      {
        method: "POST",
        body: "not-json",
        headers: { "Content-Type": "application/json" },
      },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when `addresses` is missing or not an array", async () => {
    const res1 = await createApp().request(
      "/market-data",
      {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      },
      makeEnv(),
    );
    expect(res1.status).toBe(400);

    const res2 = await createApp().request(
      "/market-data",
      {
        method: "POST",
        body: JSON.stringify({ addresses: "not-an-array" }),
        headers: { "Content-Type": "application/json" },
      },
      makeEnv(),
    );
    expect(res2.status).toBe(400);
  });

  it("returns 200 with empty map on empty `addresses[]` (no upstream calls)", async () => {
    const res = await postMarketData([]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toEqual({});
    expect(mockFetchTokensOnchainByAddresses).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 400 when an entry isn't a valid EVM address", async () => {
    const res = await postMarketData(["not-an-address"]);
    expect(res.status).toBe(400);
  });

  it("returns 400 when more than 200 addresses are requested", async () => {
    const tooMany: string[] = [];
    for (let i = 0; i < 201; i++) {
      tooMany.push(`0x${i.toString(16).padStart(40, "0")}`);
    }
    const res = await postMarketData(tooMany);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("200");
  });

  it("returns 400 for a JSON `null` body (no addresses field to read)", async () => {
    const res = await createApp().request(
      "/market-data",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "null",
      },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /market-data { addresses } — happy + degraded paths", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 503 when BounceTech API (live LT rates) is unreachable", async () => {
    mockFetchTokensOnchainByAddresses.mockResolvedValueOnce([
      {
        address: TOKEN_A,
        ltToken: LT_A,
        k: "1000000000000000000000000000000000000000000000000",
        curveSupply: "1000000000000000000000000",
        ltReserve: "100000000000000000000",
        pendingGraduation: false,
        pendingGraduationAt: null,
        graduated: false,
        graduatedAt: null,
        bondingPair: null,
        hyperswapPair: null,
        organicUsdcRaised: "0",
        volumeUsd: "0",
        creatorFeesUsd: "0",
        protocolFeesUsd: "0",
        timestamp: "1700000000",
      },
    ]);
    mockFetch.mockResolvedValueOnce({ ok: false });

    const res = await postMarketData([TOKEN_A]);

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("BounceTech API");
  });

  it("degrades (200 with null change24h, dataSource=degraded) when BounceTech snapshot DB is unreachable", async () => {
    mockFetchTokensOnchainByAddresses.mockResolvedValueOnce([
      {
        address: TOKEN_A,
        ltToken: LT_A,
        k: "1000000000000000000000000000000000000000000000000",
        curveSupply: "1000000000000000000000000",
        ltReserve: "200000000000000000000",
        pendingGraduation: false,
        pendingGraduationAt: null,
        graduated: false,
        graduatedAt: null,
        bondingPair: null,
        hyperswapPair: null,
        organicUsdcRaised: "0",
        volumeUsd: "0",
        creatorFeesUsd: "0",
        protocolFeesUsd: "0",
        timestamp: "1700000000",
      },
    ]);
    mockBounceLtResponse({ [LT_A]: "2000000000000000000" });
    mockFetchHistoricalCurveSnapshots.mockResolvedValueOnce(new Map());
    mockFetchRouterTradeActivity.mockResolvedValueOnce(new Map());
    mockNeonQuery.mockRejectedValueOnce(new Error("db down"));

    const res = await postMarketData([TOKEN_A]);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dataSource: string;
      data: Record<string, { mcapUsd: number | null; change24h: number | null }>;
    };
    expect(body.dataSource).toBe("degraded");
    const entry = body.data[TOKEN_A.toLowerCase()];
    expect(entry.mcapUsd).toBeGreaterThan(0);
    expect(entry.change24h).toBeNull();
  });

  it("computes mcap and change24h from curve snapshot + historical LT rate", async () => {
    mockFetchTokensOnchainByAddresses.mockResolvedValueOnce([
      {
        address: TOKEN_A,
        ltToken: LT_A,
        k: "1000000000000000000000000000000000000000000000000",
        curveSupply: "1000000000000000000000000",
        ltReserve: "200000000000000000000",
        pendingGraduation: false,
        pendingGraduationAt: null,
        graduated: false,
        graduatedAt: null,
        bondingPair: null,
        hyperswapPair: null,
        organicUsdcRaised: "0",
        volumeUsd: "0",
        creatorFeesUsd: "0",
        protocolFeesUsd: "0",
        timestamp: "1700000000",
      },
    ]);

    mockBounceLtResponse({ [LT_A]: "2000000000000000000" });
    mockFetchHistoricalCurveSnapshots.mockResolvedValueOnce(
      snapshotMapForCutoff(
        TOKEN_A,
        "1000000000000000000000000",
        "100000000000000000000",
      ),
    );
    mockFetchRouterTradeActivity.mockResolvedValueOnce(new Map());
    mockNeonQuery.mockResolvedValueOnce([
      { token_address: LT_A, exchange_rate: "1500000000000000000" },
    ]);

    const res = await postMarketData([TOKEN_A]);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Record<string, { mcapUsd: number | null; change24h: number | null }>;
    };

    const entry = body.data[TOKEN_A.toLowerCase()];
    expect(entry).toBeDefined();
    expect(entry.mcapUsd).toBeGreaterThan(0);
    expect(entry.change24h).not.toBeNull();
    // past price = 1e-4 × 1.5 = 1.5e-4; current = 2e-4 × 2.0 = 4e-4
    expect(entry.change24h!).toBeCloseTo(((4e-4 - 1.5e-4) / 1.5e-4) * 100, 1);
  });

  it("falls back to current curve state when no trade snapshot ≤ cutoff exists", async () => {
    mockFetchTokensOnchainByAddresses.mockResolvedValueOnce([
      {
        address: TOKEN_A,
        ltToken: LT_A,
        k: "1000000000000000000000000000000000000000000000000",
        curveSupply: "1000000000000000000000000",
        ltReserve: "200000000000000000000",
        pendingGraduation: false,
        pendingGraduationAt: null,
        graduated: false,
        graduatedAt: null,
        bondingPair: null,
        hyperswapPair: null,
        organicUsdcRaised: "0",
        volumeUsd: "0",
        creatorFeesUsd: "0",
        protocolFeesUsd: "0",
        timestamp: "1700000000",
      },
    ]);
    mockBounceLtResponse({ [LT_A]: "2000000000000000000" });
    // Empty snapshot map → fall through to live curve.
    mockFetchHistoricalCurveSnapshots.mockResolvedValueOnce(new Map());
    mockFetchRouterTradeActivity.mockResolvedValueOnce(new Map());
    mockNeonQuery.mockResolvedValueOnce([
      { token_address: LT_A, exchange_rate: "1000000000000000000" },
    ]);

    const res = await postMarketData([TOKEN_A]);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Record<string, { change24h: number | null }>;
    };
    // past rate 1.0, current rate 2.0, same curve → change = 100%
    expect(body.data[TOKEN_A.toLowerCase()].change24h).toBeCloseTo(100, 1);
  });

  it("computes since-launch change when token is newer than the 24h cutoff", async () => {
    const recentLaunch = Math.floor(Date.now() / 1000) - 1000;
    mockFetchTokensOnchainByAddresses.mockResolvedValueOnce([
      {
        address: TOKEN_A,
        ltToken: LT_A,
        k: "1000000000000000000000000000000000000000000000000",
        curveSupply: "1000000000000000000000000",
        ltReserve: "200000000000000000000",
        pendingGraduation: false,
        pendingGraduationAt: null,
        graduated: false,
        graduatedAt: null,
        bondingPair: null,
        hyperswapPair: null,
        organicUsdcRaised: "0",
        volumeUsd: "0",
        creatorFeesUsd: "0",
        protocolFeesUsd: "0",
        timestamp: String(recentLaunch),
      },
    ]);
    mockBounceLtResponse({ [LT_A]: "2000000000000000000" });
    mockFetchHistoricalCurveSnapshots.mockResolvedValueOnce(new Map());
    mockFetchRouterTradeActivity.mockResolvedValueOnce(new Map());
    // Order matters — `buildBatchFromTokens` resolves cutoff rates first,
    // then launch rates. Empty cutoff result + populated launch result
    // exercises the since-launch reconstruction branch.
    mockNeonQuery.mockResolvedValueOnce([]);
    mockNeonQuery.mockResolvedValueOnce([
      { token_address: TOKEN_A, exchange_rate: "1000000000000000000" },
    ]);

    const res = await postMarketData([TOKEN_A]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Record<string, { mcapUsd: number | null; change24h: number | null }>;
    };

    const entry = body.data[TOKEN_A.toLowerCase()];
    expect(entry.mcapUsd).toBeGreaterThan(0);
    expect(entry.change24h).not.toBeNull();
    expect(entry.change24h!).toBeCloseTo(((4e-4 - 1e-6) / 1e-6) * 100, 1);
  });

  it("returns change24h=null when BounceTech has no historical rate for the LT", async () => {
    mockFetchTokensOnchainByAddresses.mockResolvedValueOnce([
      {
        address: TOKEN_A,
        ltToken: LT_A,
        k: "1000000000000000000000000000000000000000000000000",
        curveSupply: "1000000000000000000000000",
        ltReserve: "200000000000000000000",
        pendingGraduation: false,
        pendingGraduationAt: null,
        graduated: false,
        graduatedAt: null,
        bondingPair: null,
        hyperswapPair: null,
        organicUsdcRaised: "0",
        volumeUsd: "0",
        creatorFeesUsd: "0",
        protocolFeesUsd: "0",
        timestamp: "1700000000",
      },
    ]);
    mockBounceLtResponse({ [LT_A]: "2000000000000000000" });
    mockFetchHistoricalCurveSnapshots.mockResolvedValueOnce(new Map());
    mockFetchRouterTradeActivity.mockResolvedValueOnce(new Map());
    mockNeonQuery.mockResolvedValueOnce([]);

    const res = await postMarketData([TOKEN_A]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Record<string, { change24h: number | null }>;
    };
    expect(body.data[TOKEN_A.toLowerCase()].change24h).toBeNull();
  });
});

describe("GET /market-data/:address", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 400 for invalid address", async () => {
    const app = createApp();
    const res = await app.request("/market-data/not-an-address", {}, makeEnv());
    expect(res.status).toBe(400);
  });

  it("returns 404 when token is unknown", async () => {
    mockFetchTokenOnchain.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request(`/market-data/${TOKEN_A}`, {}, makeEnv());

    expect(res.status).toBe(404);
  });

  it("returns single-token stats", async () => {
    mockFetchTokenOnchain.mockResolvedValueOnce({
      address: TOKEN_A,
      ltToken: LT_A,
      k: "1000000000000000000000000000000000000000000000000",
      curveSupply: "1000000000000000000000000",
      ltReserve: "200000000000000000000",
      pendingGraduation: false,
      pendingGraduationAt: null,
      graduated: false,
      graduatedAt: null,
      bondingPair: null,
      hyperswapPair: null,
      organicUsdcRaised: "0",
      volumeUsd: "0",
      creatorFeesUsd: "0",
      protocolFeesUsd: "0",
      timestamp: "1700000000",
    });
    mockFetchHistoricalCurveSnapshots.mockResolvedValueOnce(new Map());
    mockFetchRouterTradeActivity.mockResolvedValueOnce(new Map());
    mockBounceLtResponse({ [LT_A]: "2000000000000000000" });
    mockNeonQuery.mockResolvedValueOnce([
      { token_address: LT_A, exchange_rate: "1000000000000000000" },
    ]);

    const app = createApp();
    const res = await app.request(`/market-data/${TOKEN_A}`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { mcapUsd: number | null; change24h: number | null };
    };
    expect(body.data.mcapUsd).toBeGreaterThan(0);
    expect(body.data.change24h).toBeCloseTo(100, 1);
  });
});
