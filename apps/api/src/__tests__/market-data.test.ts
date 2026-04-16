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
    AI: {} as Ai,
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
    vi.clearAllMocks();
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

  it("returns 503 when BounceTech snapshot DB is unreachable", async () => {
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

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("BounceTech snapshot DB");
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

  it("returns change24h=null when the token is newer than the cutoff", async () => {
    const recentLaunch = Math.floor(Date.now() / 1000) - 1000;
    mockPonderPaginatedQuery.mockResolvedValueOnce({
      items: [
        {
          address: TOKEN_A,
          ltToken: LT_A,
          curveSupply: "1000000000000000000000000",
          ltReserve: "200000000000000000000",
          timestamp: String(recentLaunch),
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
    vi.clearAllMocks();
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
