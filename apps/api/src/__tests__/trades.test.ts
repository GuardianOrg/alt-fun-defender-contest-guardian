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

const { default: tradesRoute } = await import("../routes/trades.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/trades", tradesRoute);
  return app;
}

function makeEnv(): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "http://localhost:42069",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    AI: {} as Ai,
  };
}

const VALID_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

describe("GET /trades/ohlcv/:address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid address", async () => {
    const app = createApp();
    const res = await app.request("/trades/ohlcv/not-valid", {}, makeEnv());

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Invalid address");
  });

  it("returns 400 for invalid interval", async () => {
    const app = createApp();
    const res = await app.request(
      `/trades/ohlcv/${VALID_ADDRESS}?interval=2h`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toContain("Invalid interval");
  });

  it("returns empty array when no trades exist", async () => {
    mockPonderPaginatedQuery.mockResolvedValue({ items: [], truncated: false });

    const app = createApp();
    const res = await app.request(
      `/trades/ohlcv/${VALID_ADDRESS}`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.status).toBe("success");
    expect(body.data).toEqual([]);
  });

  it("aggregates trades into OHLCV candles", async () => {
    const baseTrade = {
      id: "1",
      tokenAddress: VALID_ADDRESS,
      trader: "0x1",
      isBuy: true,
      blockNumber: "100",
    };

    mockPonderPaginatedQuery.mockResolvedValue({
      items: [
        { ...baseTrade, usdcAmount: "1000000", tokenAmount: "1000000000000000000", timestamp: "1000" },
        { ...baseTrade, usdcAmount: "2000000", tokenAmount: "1000000000000000000", timestamp: "1050" },
        { ...baseTrade, usdcAmount: "500000", tokenAmount: "1000000000000000000", timestamp: "1100" },
        // This one goes into next 5m bucket (300s apart)
        { ...baseTrade, usdcAmount: "3000000", tokenAmount: "1000000000000000000", timestamp: "1500" },
      ],
      truncated: false,
    });

    const app = createApp();
    const res = await app.request(
      `/trades/ohlcv/${VALID_ADDRESS}?interval=5m`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; error: string | null; data: Record<string, unknown>[] };
    expect(body.status).toBe("success");

    // Should have 2 candles (bucket 900 and 1500)
    expect(body.data).toHaveLength(2);

    const firstCandle = body.data[0] as Record<string, unknown>;
    expect(firstCandle.open).toBe(1); // 1 USDC / 1 token
    expect(firstCandle.high).toBe(2); // 2 USDC / 1 token
    expect(firstCandle.low).toBe(0.5); // 0.5 USDC / 1 token
    expect(firstCandle.close).toBe(0.5); // last trade in bucket
    expect(firstCandle.volume).toBeCloseTo(3.5); // 1 + 2 + 0.5 USDC

    const secondCandle = body.data[1] as Record<string, unknown>;
    expect(secondCandle.open).toBe(3);
    expect(secondCandle.close).toBe(3);
  });

  it("skips trades with zero token amount", async () => {
    mockPonderPaginatedQuery.mockResolvedValue({
      items: [
        {
          id: "1",
          tokenAddress: VALID_ADDRESS,
          trader: "0x1",
          isBuy: true,
          usdcAmount: "1000000",
          tokenAmount: "0",
          blockNumber: "100",
          timestamp: "1000",
        },
      ],
      truncated: false,
    });

    const app = createApp();
    const res = await app.request(
      `/trades/ohlcv/${VALID_ADDRESS}?interval=5m`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.data).toEqual([]);
  });

  it("accepts all valid intervals", async () => {
    mockPonderPaginatedQuery.mockResolvedValue({ items: [], truncated: false });

    const intervals = ["1m", "5m", "15m", "1h", "4h"];
    const app = createApp();

    for (const interval of intervals) {
      const res = await app.request(
        `/trades/ohlcv/${VALID_ADDRESS}?interval=${interval}`,
        {},
        makeEnv(),
      );
      expect(res.status).toBe(200);
    }
  });
});

describe("GET /trades/:address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid address", async () => {
    const app = createApp();
    const res = await app.request("/trades/invalid", {}, makeEnv());

    expect(res.status).toBe(400);
  });

  it("returns trades for valid address", async () => {
    mockPonderQuery.mockResolvedValue({
      routerTrades: { items: [{ id: "1", tokenAddress: VALID_ADDRESS }] },
    });

    const app = createApp();
    const res = await app.request(`/trades/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.status).toBe("success");
    expect(body.data).toHaveLength(1);
  });

  it("returns 503 when Ponder returns null", async () => {
    mockPonderQuery.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request(`/trades/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.status).toBe("error");
    expect(body.data).toBeNull();
  });
});

describe("GET /trades", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns recent trades", async () => {
    mockPonderQuery.mockResolvedValue({
      routerTrades: { items: [{ id: "1" }, { id: "2" }] },
    });

    const app = createApp();
    const res = await app.request("/trades", {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.data).toHaveLength(2);
  });

  it("returns 503 when Ponder is unavailable", async () => {
    mockPonderQuery.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request("/trades", {}, makeEnv());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.status).toBe("error");
    expect(body.data).toBeNull();
  });
});
