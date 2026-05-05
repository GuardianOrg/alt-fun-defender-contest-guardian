import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

// --- Ponder mock ---
const mockPonderQuery = vi.fn();
const mockPonderPaginatedQuery = vi.fn();

vi.mock("../lib/ponder-client.js", () => ({
  createPonderQuery: () => mockPonderQuery,
  createPonderPaginatedQuery: () => mockPonderPaginatedQuery,
}));

// --- DB mock ---
const mockDbSelect = vi.fn().mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([]),
    }),
  }),
});

vi.mock("../db/client.js", () => ({
  createDb: () => ({ select: mockDbSelect }),
}));

// --- Neon mock ---
const mockNeonQuery = vi.fn();
vi.mock("@neondatabase/serverless", () => ({
  neon: () => mockNeonQuery,
}));

const { default: chartRoute } = await import("../routes/chart.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/chart", chartRoute);
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
    LT_TICKER_DO: {} as DurableObjectNamespace,
    AI: {} as Ai,
  };
}

const VALID_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

describe("GET /chart/:address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPonderQuery.mockResolvedValue({ __typename: "Query" });
  });

  it("returns 400 for invalid address", async () => {
    const app = createApp();
    const res = await app.request("/chart/not-valid", {}, makeEnv());

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toBe("Invalid address");
  });

  it("returns 400 for invalid timeframe", async () => {
    const app = createApp();
    const res = await app.request(
      `/chart/${VALID_ADDRESS}?timeframe=2w`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Invalid timeframe");
  });

  it("returns 503 when indexer is unavailable", async () => {
    mockPonderQuery.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Indexer unavailable");
  });

  it("returns 404 when token has no LT address", async () => {
    mockPonderQuery
      .mockResolvedValueOnce({ __typename: "Query" })
      .mockResolvedValueOnce({ token: null });

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(404);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Token not found");
  });

  it("returns empty snapshot when no LT snapshots exist", async () => {
    mockPonderQuery
      .mockResolvedValueOnce({ __typename: "Query" })
      .mockResolvedValueOnce({
        token: {
          k: "1000000000000000000000",
          ltToken: "0xB5A5EcA6Ddc738943A6CaF716D4185B3680dE4b7",
          graduated: false,
          graduatedAt: null,
          timestamp: "1700000000",
        },
      });
    mockNeonQuery.mockResolvedValue([]);
    mockPonderPaginatedQuery.mockResolvedValue({ items: [], truncated: false });

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: {
        candles: unknown[];
        currentRatio: number;
        currentExchangeRate: number;
      };
    };
    expect(body.status).toBe("success");
    expect(body.data.candles).toEqual([]);
    expect(body.data.currentRatio).toBe(0);
    expect(body.data.currentExchangeRate).toBe(0);
  });

  it("returns 503 when trade history is truncated", async () => {
    mockPonderQuery
      .mockResolvedValueOnce({ __typename: "Query" })
      .mockResolvedValueOnce({
        token: {
          k: "1000000000000000000000",
          ltToken: "0xB5A5EcA6Ddc738943A6CaF716D4185B3680dE4b7",
          graduated: false,
          graduatedAt: null,
          timestamp: "1700000000",
        },
      });
    mockNeonQuery.mockResolvedValue([
      { ts: "1700000060", exchange_rate: "1000000000000000000" },
    ]);
    mockPonderPaginatedQuery.mockResolvedValue({ items: [], truncated: true });

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Trade history too large");
  });

  it("returns candles with correct shape on happy path", async () => {
    const nowSec = Math.floor(Date.now() / 1000);

    mockPonderQuery
      .mockResolvedValueOnce({ __typename: "Query" })
      .mockResolvedValueOnce({
        token: {
          // k = TOTAL_SUPPLY × virtualLtAtLaunch, with TOTAL_SUPPLY = 1B × 1e18
          // and a virtualLtAtLaunch of 1e18 → k = 1e45.
          k: "1000000000000000000000000000000000000000000000",
          ltToken: "0xB5A5EcA6Ddc738943A6CaF716D4185B3680dE4b7",
          graduated: false,
          graduatedAt: null,
          timestamp: String(nowSec - 3600),
        },
      });

    mockNeonQuery.mockResolvedValue([
      { ts: String(nowSec - 600), exchange_rate: "2000000000000000000" },
      { ts: String(nowSec - 300), exchange_rate: "2100000000000000000" },
      { ts: String(nowSec - 100), exchange_rate: "1900000000000000000" },
    ]);

    mockPonderPaginatedQuery.mockResolvedValue({
      items: [
        {
          curveSupply: "500000000000000000000000000",
          ltReserve: "2000000000000000000",
          timestamp: String(nowSec - 3500),
        },
      ],
      truncated: false,
    });

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: {
        candles: Record<string, unknown>[];
        currentRatio: number;
        currentExchangeRate: number;
      };
    };
    expect(body.status).toBe("success");
    expect(body.data.candles.length).toBeGreaterThan(0);
    expect(body.data.currentRatio).toBeGreaterThan(0);
    expect(body.data.currentExchangeRate).toBeCloseTo(1.9, 5);

    const candle = body.data.candles[0];
    expect(candle).toHaveProperty("time");
    expect(candle).toHaveProperty("open");
    expect(candle).toHaveProperty("high");
    expect(candle).toHaveProperty("low");
    expect(candle).toHaveProperty("close");
    expect(typeof candle.time).toBe("number");
    expect(typeof candle.open).toBe("number");
    expect(candle.open as number).toBeGreaterThan(0);
  });

  it("anchors prices with k / reserve0_at_launch (no double-scaling)", async () => {
    // Regression: `bigintRatio` already applies RATIO_PRECISION internally,
    // so the launch-anchor `initialLtReserve` must be plain `k / reserve0`
    // — pre-scaling by RATIO_PRECISION here used to inflate every fresh
    // token's anchor ratio by 1e18 (visible only when there are no indexed
    // trades yet, so the launch anchor is what gets priced against the LT
    // rows).
    const nowSec = Math.floor(Date.now() / 1000);

    mockPonderQuery
      .mockResolvedValueOnce({ __typename: "Query" })
      .mockResolvedValueOnce({
        token: {
          // k = reserve0 × reserve1 with no fixed-point factor (Pair.sol).
          // 1B × 1e18 reserve0 with virtualLt = 1.0 (1e18 wei) → k = 1e45.
          k: "1000000000000000000000000000000000000000000000",
          ltToken: "0xB5A5EcA6Ddc738943A6CaF716D4185B3680dE4b7",
          graduated: false,
          graduatedAt: null,
          timestamp: String(nowSec - 600),
        },
      });

    // LT rate constant at 2.0 across the window.
    mockNeonQuery.mockResolvedValue([
      { ts: String(nowSec - 300), exchange_rate: "2000000000000000000" },
      { ts: String(nowSec - 100), exchange_rate: "2000000000000000000" },
    ]);

    // No indexed trades yet → ratio timeline = just the launch anchor.
    mockPonderPaginatedQuery.mockResolvedValue({ items: [], truncated: false });

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: {
        candles: { open: number; close: number }[];
        currentRatio: number;
        currentExchangeRate: number;
      };
    };

    // launchRatio = (k / reserve0_at_launch) / reserve0_at_launch
    //             = (1e45 / 1e27) / 1e27 = 1e-9
    // priceUsd   = launchRatio × exRate = 1e-9 × 2 = 2e-9
    expect(body.data.currentRatio).toBeCloseTo(1e-9, 18);
    for (const candle of body.data.candles) {
      expect(candle.open).toBeGreaterThan(1e-9);
      expect(candle.open).toBeLessThan(1e-8);
    }
  });

  it("accepts all valid timeframes", async () => {
    mockPonderQuery
      .mockResolvedValue({ __typename: "Query" });

    const app = createApp();

    for (const tf of ["1d", "5d", "1m"]) {
      mockPonderQuery
        .mockResolvedValueOnce({ __typename: "Query" })
        .mockResolvedValueOnce({ token: null });

      const res = await app.request(
        `/chart/${VALID_ADDRESS}?timeframe=${tf}`,
        {},
        makeEnv(),
      );
      expect(res.status).toBe(404);
    }
  });

  it("accepts interval-only requests for all supported candle widths", async () => {
    const app = createApp();

    const supported = [
      5, 15, 30, 60, 300, 900, 1_800, 3_600, 14_400, 21_600, 43_200, 86_400,
    ];

    for (const seconds of supported) {
      mockPonderQuery
        .mockResolvedValueOnce({ __typename: "Query" })
        .mockResolvedValueOnce({ token: null });

      const res = await app.request(
        `/chart/${VALID_ADDRESS}?interval=${seconds}`,
        {},
        makeEnv(),
      );
      // Passes validation and reaches the token-lookup branch (404 because
      // `token: null` from the Ponder mock).
      expect(res.status).toBe(404);
    }
  });

  it("returns 400 for unsupported interval values", async () => {
    const app = createApp();

    const res = await app.request(
      `/chart/${VALID_ADDRESS}?interval=42`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Invalid interval");
  });

  it("returns 400 for non-numeric interval", async () => {
    const app = createApp();

    const res = await app.request(
      `/chart/${VALID_ADDRESS}?interval=abc`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Invalid interval");
  });

  it("returns 400 for partial-numeric interval values", async () => {
    const app = createApp();

    // parseInt() would happily accept "60abc" as 60 — strict validation
    // rejects it so we don't silently coerce user input.
    const res = await app.request(
      `/chart/${VALID_ADDRESS}?interval=60abc`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Invalid interval");
  });
});
