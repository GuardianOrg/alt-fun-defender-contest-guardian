import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppBindings } from "../lib/types.js";

const mockPonderQuery = vi.fn();
const mockPonderPaginatedQuery = vi.fn();

vi.mock("../lib/ponder-client.js", () => ({
  createPonderQuery: () => mockPonderQuery,
  createPonderPaginatedQuery: () => mockPonderPaginatedQuery,
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

describe("GET /market-data", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 503 when the indexer is unreachable", async () => {
    mockPonderPaginatedQuery.mockRejectedValueOnce(
      new Error("indexer offline"),
    );

    const app = createApp();
    const res = await app.request("/market-data", {}, makeEnv());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Indexer unavailable");
  });

  it("returns 503 when BounceTech API is unreachable", async () => {
    mockPonderPaginatedQuery.mockResolvedValueOnce({
      items: [
        {
          address: TOKEN_A,
          ltToken: LT_A,
          curveSupply: "1000000000000000000000000",
          ltReserve: "100000000000000000000",
          timestamp: "1700000000",
        },
      ],
    });
    mockFetch.mockResolvedValueOnce({ ok: false });

    const app = createApp();
    const res = await app.request("/market-data", {}, makeEnv());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("BounceTech API");
  });

  it("degrades gracefully (200 with null change24h, dataSource=degraded) when BounceTech snapshot DB is unreachable", async () => {
    // BounceTech's snapshot DB feeds *historical* price math
    // (`past24hPriceUsd` / `change24h` / `ltChange24h`). The live LT rate
    // (and therefore `priceUsd` / `mcapUsd`) comes from a separate
    // BounceTech endpoint — so a snapshot-DB outage shouldn't 503 the
    // whole price feed, it should just null-out the change fields. The
    // route flips `dataSource` to "degraded" so the frontend's apiFetch
    // can surface a status banner. See `buildBatchFromTokens` for the
    // policy split.
    mockPonderPaginatedQuery.mockResolvedValueOnce({
      items: [
        {
          address: TOKEN_A,
          ltToken: LT_A,
          curveSupply: "1000000000000000000000000",
          ltReserve: "200000000000000000000",
          timestamp: "1700000000",
        },
      ],
    });
    mockBounceLtResponse({ [LT_A]: "2000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockRejectedValueOnce(new Error("db down"));

    const app = createApp();
    const res = await app.request("/market-data", {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dataSource: string;
      data: Record<
        string,
        {
          mcapUsd: number | null;
          change24h: number | null;
          ltChange24h: number | null;
        }
      >;
    };
    expect(body.dataSource).toBe("degraded");
    const entry = body.data[TOKEN_A.toLowerCase()];
    expect(entry.mcapUsd).toBeGreaterThan(0);
    expect(entry.change24h).toBeNull();
    expect(entry.ltChange24h).toBeNull();
  });

  it("degrades gracefully (200 with null change24h, dataSource=degraded) when the historical curve query fails", async () => {
    // The aliased `tokenSnapshots` query in `fetchHistoricalCurveSnapshots`
    // is the heavy one — 50 token aliases per batch — and is what trips
    // the live-prod 503 the frontend sees when a slow Ponder query
    // returns errors mid-batch. With the graceful-degradation policy, a
    // null return from the historical curve fetch should only null-out
    // the past-price-derived fields; the live `priceUsd` / `mcapUsd`
    // path is untouched.
    mockPonderPaginatedQuery.mockResolvedValueOnce({
      items: [
        {
          address: TOKEN_A,
          ltToken: LT_A,
          curveSupply: "1000000000000000000000000",
          ltReserve: "200000000000000000000",
          timestamp: "1700000000",
        },
      ],
    });
    mockBounceLtResponse({ [LT_A]: "2000000000000000000" });
    // Historical curve query returns null (queryPonder swallowed an
    // upstream error). Old token path → past24h fields null.
    mockPonderQuery.mockResolvedValueOnce(null);
    // BounceTech historical rates are still up.
    mockNeonQuery.mockResolvedValueOnce([
      { token_address: LT_A, exchange_rate: "1500000000000000000" },
    ]);

    const app = createApp();
    const res = await app.request("/market-data", {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dataSource: string;
      data: Record<
        string,
        {
          mcapUsd: number | null;
          change24h: number | null;
          past24hPriceUsd: number | null;
        }
      >;
    };
    expect(body.dataSource).toBe("degraded");
    const entry = body.data[TOKEN_A.toLowerCase()];
    expect(entry.mcapUsd).toBeGreaterThan(0);
    expect(entry.change24h).toBeNull();
    expect(entry.past24hPriceUsd).toBeNull();
  });

  it("computes mcap and change24h from curve snapshot + historical LT rate", async () => {
    mockPonderPaginatedQuery.mockResolvedValueOnce({
      items: [
        {
          address: TOKEN_A,
          ltToken: LT_A,
          curveSupply: "1000000000000000000000000",
          ltReserve: "200000000000000000000",
          timestamp: "1700000000",
        },
      ],
    });

    // Current LT exchange rate = 2.0 (2e18)
    mockBounceLtResponse({ [LT_A]: "2000000000000000000" });

    // Historical curve snapshot: supply=1e24, reserve=1e20 → ratio=1e-4
    mockPonderQuery.mockResolvedValueOnce({
      t0: {
        items: [
          {
            curveSupply: "1000000000000000000000000",
            ltReserve: "100000000000000000000",
            timestamp: "1699999000",
          },
        ],
      },
    });

    // Historical LT rate = 1.5 (1.5e18). BounceTech DB returns checksummed address.
    mockNeonQuery.mockResolvedValueOnce([
      {
        token_address: LT_A,
        exchange_rate: "1500000000000000000",
      },
    ]);

    const app = createApp();
    const res = await app.request("/market-data", {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: Record<
        string,
        { mcapUsd: number | null; change24h: number | null }
      >;
    };

    const entry = body.data[TOKEN_A.toLowerCase()];
    expect(entry).toBeDefined();
    // Current price = 2e-4 × 2.0 = 4e-4 → mcap = 4e-4 × 1e9 = 400k
    expect(entry.mcapUsd).toBeGreaterThan(0);
    // past price = 1e-4 × 1.5 = 1.5e-4; change = (4e-4 - 1.5e-4)/1.5e-4 × 100
    expect(entry.change24h).not.toBeNull();
    expect(entry.change24h!).toBeCloseTo(((4e-4 - 1.5e-4) / 1.5e-4) * 100, 1);
  });

  it("falls back to current curve state when no trade snapshot ≤ cutoff exists", async () => {
    mockPonderPaginatedQuery.mockResolvedValueOnce({
      items: [
        {
          address: TOKEN_A,
          ltToken: LT_A,
          curveSupply: "1000000000000000000000000",
          ltReserve: "200000000000000000000",
          timestamp: "1700000000",
        },
      ],
    });
    mockBounceLtResponse({ [LT_A]: "2000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([
      { token_address: LT_A, exchange_rate: "1000000000000000000" },
    ]);

    const app = createApp();
    const res = await app.request("/market-data", {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Record<string, { change24h: number | null }>;
    };
    // past rate 1.0, current rate 2.0, same curve → change = 100%
    expect(body.data[TOKEN_A.toLowerCase()].change24h).toBeCloseTo(100, 1);
  });

  it("computes since-launch change when token is newer than the 24h cutoff", async () => {
    const recentLaunch = Math.floor(Date.now() / 1000) - 1000;
    // k = 1e48 → launch supply = TOTAL_SUPPLY_RAW = 1e27, launch reserve = k/1e27 = 1e21.
    // Launch ratio = 1e21 / 1e27 = 1e-6.
    // Current curve: supply=1e24, reserve=2e20 → ratio = 2e-4.
    mockPonderPaginatedQuery.mockResolvedValueOnce({
      items: [
        {
          address: TOKEN_A,
          ltToken: LT_A,
          k: "1000000000000000000000000000000000000000000000000",
          curveSupply: "1000000000000000000000000",
          ltReserve: "200000000000000000000",
          timestamp: String(recentLaunch),
        },
      ],
    });
    // Current LT rate = 2.0 → current price = 2e-4 × 2.0 = 4e-4.
    mockBounceLtResponse({ [LT_A]: "2000000000000000000" });
    // No old tokens → no historical curve snapshots are queried.
    // `fetchHistoricalLtRates` is still called for all LTs (for
    // `ltChange24h`); we let it return an empty map — this test doesn't
    // assert on `ltChange24h`, only on `change24h`, which is driven by
    // `fetchLtRatesAtLaunches` for new tokens.
    mockNeonQuery.mockResolvedValueOnce([]);
    // New tokens → `fetchLtRatesAtLaunches` returns LT rate at launch = 1.0.
    // Launch price = 1e-6 × 1.0 = 1e-6 → change = (4e-4 - 1e-6) / 1e-6 × 100.
    // Note: this query's `SELECT a.token_address` returns the token address
    // (not the LT) — the map is keyed by token so tokens sharing an LT but
    // with different launch timestamps don't collide.
    mockNeonQuery.mockResolvedValueOnce([
      { token_address: TOKEN_A, exchange_rate: "1000000000000000000" },
    ]);

    const app = createApp();
    const res = await app.request("/market-data", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Record<string, { mcapUsd: number | null; change24h: number | null }>;
    };

    const entry = body.data[TOKEN_A.toLowerCase()];
    expect(entry.mcapUsd).toBeGreaterThan(0);
    expect(entry.change24h).not.toBeNull();
    expect(entry.change24h!).toBeCloseTo(((4e-4 - 1e-6) / 1e-6) * 100, 1);
  });

  it("returns change24h=null for a newer-than-cutoff token when BounceTech has no rate at launch", async () => {
    const recentLaunch = Math.floor(Date.now() / 1000) - 1000;
    mockPonderPaginatedQuery.mockResolvedValueOnce({
      items: [
        {
          address: TOKEN_A,
          ltToken: LT_A,
          k: "1000000000000000000000000000000000000000000000000",
          curveSupply: "1000000000000000000000000",
          ltReserve: "200000000000000000000",
          timestamp: String(recentLaunch),
        },
      ],
    });
    mockBounceLtResponse({ [LT_A]: "2000000000000000000" });
    // fetchHistoricalLtRates (all LTs, cutoff) — empty, LT has no 24h-ago rate.
    mockNeonQuery.mockResolvedValueOnce([]);
    // fetchLtRatesAtLaunches — empty, no rate at launch → change24h null.
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request("/market-data", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Record<string, { mcapUsd: number | null; change24h: number | null }>;
    };

    const entry = body.data[TOKEN_A.toLowerCase()];
    expect(entry.mcapUsd).toBeGreaterThan(0);
    expect(entry.change24h).toBeNull();
  });

  it("returns change24h=null when BounceTech has no historical rate for the LT", async () => {
    mockPonderPaginatedQuery.mockResolvedValueOnce({
      items: [
        {
          address: TOKEN_A,
          ltToken: LT_A,
          curveSupply: "1000000000000000000000000",
          ltReserve: "200000000000000000000",
          timestamp: "1700000000",
        },
      ],
    });
    mockBounceLtResponse({ [LT_A]: "2000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request("/market-data", {}, makeEnv());
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
    mockPonderQuery.mockResolvedValueOnce({ token: null });

    const app = createApp();
    const res = await app.request(`/market-data/${TOKEN_A}`, {}, makeEnv());

    expect(res.status).toBe(404);
  });

  it("returns single-token stats", async () => {
    mockPonderQuery
      .mockResolvedValueOnce({
        token: {
          address: TOKEN_A,
          ltToken: LT_A,
          curveSupply: "1000000000000000000000000",
          ltReserve: "200000000000000000000",
          timestamp: "1700000000",
        },
      })
      .mockResolvedValueOnce({
        t0: { items: [] },
      });
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
