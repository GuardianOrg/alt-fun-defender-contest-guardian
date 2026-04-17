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
          k: "750000000000000000000000000000000000000000000",
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
});
