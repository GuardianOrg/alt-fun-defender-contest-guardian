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
  fetchTrendingCandidatesByVolume: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  createDb: () => ({}),
}));

const mockNeonQuery = vi.fn();
vi.mock("@neondatabase/serverless", () => ({
  neon: () => mockNeonQuery,
}));

// `fetchLiveLtRates` now reads through `readLiveLtRates` from the
// `lt_directory` mirror. Mock it so the per-test rate seeding via
// `mockBounceLtResponse({ ... })` still drives the price/mcap math.
const mockReadLiveLtRates = vi.fn();
vi.mock("../lib/lt-directory-reads.js", () => ({
  readLtDirectory: vi.fn(),
  readSupportedLtDirectory: vi.fn(),
  readLiveLtRates: mockReadLiveLtRates,
  readLtByAddress: vi.fn(),
  readDirectoryLastUpdatedAt: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
vi.stubGlobal("caches", undefined);

const { default: marketDataRoute } = await import("../routes/market-data.js");
const { _resetLiveLtRatesCache } = await import("../lib/market-data.js");

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
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

// Valid EIP-55 checksums — `isAddress()` rejects all-lowercase long hex with
// mixed expected characters, so we use real checksummed addresses here.
const TOKEN_A = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const LT_A = "0xb88339CB7199b77E23DB6E890353E22632Ba630f";

function mockBounceLtResponse(rates: Record<string, string>) {
  const map = new Map<string, number>();
  for (const [address, exchangeRate] of Object.entries(rates)) {
    map.set(address.toLowerCase(), Number(BigInt(exchangeRate)) / 1e18);
  }
  mockReadLiveLtRates.mockResolvedValue(map);
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
    _resetLiveLtRatesCache();
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
    expect(mockReadLiveLtRates).not.toHaveBeenCalled();
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
    _resetLiveLtRatesCache();
  });

  it("returns 503 when the lt_directory mirror (live LT rates) is unreachable", async () => {
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
    mockReadLiveLtRates.mockResolvedValueOnce(null);

    const res = await postMarketData([TOKEN_A]);

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("LT directory mirror");
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

/**
 * Cloudflare's `caches.default` exposes `match` / `put` against a
 * keyed-by-URL+method store. The fake below records calls and stores
 * the response body keyed by the synthetic GET URL the route builds
 * from the canonicalised address set — enough surface to assert the
 * cold-write → warm-read pipeline, key canonicalisation, and per-TTL
 * branch (live vs degraded) without spinning up a real Workers
 * runtime.
 */
type FakeCache = {
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  store: Map<string, Response>;
};

function createFakeCache(): FakeCache {
  const store = new Map<string, Response>();
  const match = vi.fn(async (key: Request) => {
    const hit = store.get(key.url);
    return hit ? hit.clone() : undefined;
  });
  const put = vi.fn(async (key: Request, value: Response) => {
    store.set(key.url, value);
  });
  return { match, put, store };
}

function mockHappyMarketDataPipeline(opts: {
  address: string;
  ltToken: string;
  ltExchangeRate?: string;
  pastLtRate?: string;
}) {
  mockFetchTokensOnchainByAddresses.mockResolvedValueOnce([
    {
      address: opts.address,
      ltToken: opts.ltToken,
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
  mockBounceLtResponse({
    [opts.ltToken]: opts.ltExchangeRate ?? "2000000000000000000",
  });
  mockFetchHistoricalCurveSnapshots.mockResolvedValueOnce(new Map());
  mockFetchRouterTradeActivity.mockResolvedValueOnce(new Map());
  mockNeonQuery.mockResolvedValueOnce([
    {
      token_address: opts.ltToken,
      exchange_rate: opts.pastLtRate ?? "1000000000000000000",
    },
  ]);
}

describe("POST /market-data — server-side cache (issue #928)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _resetLiveLtRatesCache();
    vi.stubGlobal("caches", undefined);
  });

  it("(a) cold call writes the response into the edge cache", async () => {
    const cache = createFakeCache();
    vi.stubGlobal("caches", { default: cache });

    mockHappyMarketDataPipeline({ address: TOKEN_A, ltToken: LT_A });

    const res = await postMarketData([TOKEN_A]);
    expect(res.status).toBe(200);
    expect(cache.match).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.store.size).toBe(1);

    // Pipeline ran once on the cold path — exactly one fan-out.
    expect(mockFetchTokensOnchainByAddresses).toHaveBeenCalledTimes(1);
  });

  it("(b) warm call returns the cached response without re-running the pipeline", async () => {
    const cache = createFakeCache();
    vi.stubGlobal("caches", { default: cache });

    mockHappyMarketDataPipeline({ address: TOKEN_A, ltToken: LT_A });

    const first = await postMarketData([TOKEN_A]);
    const firstBody = await first.json();
    expect(mockFetchTokensOnchainByAddresses).toHaveBeenCalledTimes(1);

    // Second call must hit the cache verbatim — no further fan-out, no
    // mirror read, no Neon roundtrip. The body must be byte-identical
    // to the cold response.
    const second = await postMarketData([TOKEN_A]);
    expect(second.status).toBe(200);
    const secondBody = await second.json();

    expect(secondBody).toEqual(firstBody);
    expect(mockFetchTokensOnchainByAddresses).toHaveBeenCalledTimes(1);
    expect(mockReadLiveLtRates).toHaveBeenCalledTimes(1);
    expect(mockNeonQuery).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.match).toHaveBeenCalledTimes(2);
  });

  it("(c) different orderings / casings / dupes of the same set hit the same cache key", async () => {
    const cache = createFakeCache();
    vi.stubGlobal("caches", { default: cache });

    // Use two addresses so the canonicalisation actually has something
    // to sort. `TOKEN_B` is a second valid EIP-55 checksum.
    const TOKEN_B = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
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
    mockNeonQuery.mockResolvedValueOnce([
      { token_address: LT_A, exchange_rate: "1000000000000000000" },
    ]);

    // First call: `[A, B]` in checksummed form.
    const first = await postMarketData([TOKEN_A, TOKEN_B]);
    expect(first.status).toBe(200);
    expect(cache.put).toHaveBeenCalledTimes(1);

    // Second call: reversed order, lowercased, with a duplicate. Must
    // resolve to the same cache slot — no second compute fan-out, no
    // second `cache.put`.
    const second = await postMarketData([
      TOKEN_B.toLowerCase(),
      TOKEN_A.toLowerCase(),
      TOKEN_B.toLowerCase(),
    ]);
    expect(second.status).toBe(200);

    expect(mockFetchTokensOnchainByAddresses).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.store.size).toBe(1);
    expect(cache.match).toHaveBeenCalledTimes(2);
  });

  it("(d) different address sets land in different cache slots", async () => {
    const cache = createFakeCache();
    vi.stubGlobal("caches", { default: cache });

    const TOKEN_B = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

    // Two distinct cold calls — one per address — each must miss the
    // cache, run the pipeline, and write its own slot.
    mockHappyMarketDataPipeline({ address: TOKEN_A, ltToken: LT_A });
    const first = await postMarketData([TOKEN_A]);
    expect(first.status).toBe(200);

    mockHappyMarketDataPipeline({ address: TOKEN_B, ltToken: LT_A });
    const second = await postMarketData([TOKEN_B]);
    expect(second.status).toBe(200);

    expect(mockFetchTokensOnchainByAddresses).toHaveBeenCalledTimes(2);
    expect(cache.put).toHaveBeenCalledTimes(2);
    expect(cache.store.size).toBe(2);
  });

  it("(e) degraded responses set the shorter (1s) TTL", async () => {
    const cache = createFakeCache();
    vi.stubGlobal("caches", { default: cache });

    // Triggers the degraded path: BounceTech snapshot DB rejects, so
    // `change24h` collapses to null and `dataSource` flips to
    // `"degraded"` — see the existing degraded test at the top of this
    // file for the exact mock shape this exercises.
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
    const body = (await res.json()) as { dataSource: string };
    expect(body.dataSource).toBe("degraded");

    const cacheControl = res.headers.get("Cache-Control") ?? "";
    expect(cacheControl).toContain("s-maxage=1");
    expect(cacheControl).not.toContain("s-maxage=3");
  });

  it("empty `addresses[]` short-circuit is not cached", async () => {
    const cache = createFakeCache();
    vi.stubGlobal("caches", { default: cache });

    const res = await postMarketData([]);
    expect(res.status).toBe(200);
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
    expect(cache.store.size).toBe(0);
  });

  it("falls through to live compute when the cache binding is missing (worker dev / unit tests)", async () => {
    // No `caches` global — module-level stub in this file already does
    // this, but we set it again here so future readers see the intent.
    vi.stubGlobal("caches", undefined);

    mockHappyMarketDataPipeline({ address: TOKEN_A, ltToken: LT_A });

    const res = await postMarketData([TOKEN_A]);
    expect(res.status).toBe(200);
    expect(mockFetchTokensOnchainByAddresses).toHaveBeenCalledTimes(1);
  });
});

describe("GET /market-data/:address", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _resetLiveLtRatesCache();
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
