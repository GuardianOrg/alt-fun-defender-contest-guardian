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

/**
 * Helper for the new `POST /market-data { addresses }` contract — same
 * Hono.request invocation as the GET tests, just method=POST + JSON body.
 */
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
      { method: "POST", body: "not-json", headers: { "Content-Type": "application/json" } },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when `addresses` is missing or not an array", async () => {
    const res1 = await createApp().request(
      "/market-data",
      { method: "POST", body: JSON.stringify({}), headers: { "Content-Type": "application/json" } },
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
    // Empty input short-circuits — never touches Ponder or BounceTech.
    expect(mockPonderPaginatedQuery).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 400 when an entry isn't a valid EVM address", async () => {
    const res = await postMarketData(["not-an-address"]);
    expect(res.status).toBe(400);
  });

  it("returns 400 when more than 200 addresses are requested", async () => {
    // Bounded fan-out: the route caps `addresses[]` at 200 so a runaway
    // client can't trigger an unbounded Ponder query batch fan-out.
    const tooMany: string[] = [];
    for (let i = 0; i < 201; i++) {
      // Synthesise distinct valid EIP-55 addresses by varying the trailing
      // byte. `isAddress` only validates hex shape + checksum, so a
      // lowercase 40-hex string passes the format check (we hand-roll
      // valid hex below).
      tooMany.push(`0x${i.toString(16).padStart(40, "0")}`);
    }
    const res = await postMarketData(tooMany);
    expect(res.status).toBe(400);
    // Assert the specific cap message — without it the test would also
    // pass if the route 400'd for an unrelated reason (e.g. one of the
    // synthesised addresses failed checksum validation), masking a
    // regression in the cap-vs-format ordering.
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("200");
  });

  it("returns 400 for a JSON `null` body (no addresses field to read)", async () => {
    // Regression coverage: `c.req.json()` parses a literal `null` body
    // as valid JSON, but the route's `body.addresses` access would
    // throw on it without an explicit null/non-object guard, surfacing
    // as a 500 instead of the user-visible 400 we want. CodeRabbit
    // feedback on PR #872.
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

    const res = await postMarketData([TOKEN_A]);

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("BounceTech API");
  });

  it("degrades (200 with null change24h, dataSource=degraded) when BounceTech snapshot DB is unreachable", async () => {
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
