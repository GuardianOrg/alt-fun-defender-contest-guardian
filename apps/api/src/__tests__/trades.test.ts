import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockFetchRouterTrades = vi.fn();
const mockFetchTokenLabels = vi.fn();
const mockCheckIndexerHealth = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchRouterTrades: (...args: unknown[]) => mockFetchRouterTrades(...args),
  fetchTokenLabels: (...args: unknown[]) => mockFetchTokenLabels(...args),
  checkIndexerHealth: (...args: unknown[]) => mockCheckIndexerHealth(...args),
}));

vi.mock("../db/client.js", () => ({
  createDb: () => ({}),
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
  };
}

const VALID_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

function trade(overrides: Partial<{
  id: string;
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  usdcAmount: string;
  tokenAmount: string;
  blockNumber: string;
  timestamp: string;
}>) {
  return {
    id: "1",
    tokenAddress: VALID_ADDRESS.toLowerCase(),
    trader: "0x1",
    isBuy: true,
    usdcAmount: "1000000",
    tokenAmount: "1000000000000000000",
    blockNumber: "100",
    timestamp: "1000",
    ...overrides,
  };
}

describe("GET /trades/ohlcv/:address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckIndexerHealth.mockResolvedValue(true);
  });

  it("returns 400 for invalid address", async () => {
    const app = createApp();
    const res = await app.request("/trades/ohlcv/not-valid", {}, makeEnv());

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string | null };
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
    const body = (await res.json()) as { error: string | null };
    expect(body.error).toContain("Invalid interval");
  });

  it("returns empty array when no trades exist", async () => {
    mockFetchRouterTrades.mockResolvedValue([]);

    const app = createApp();
    const res = await app.request(
      `/trades/ohlcv/${VALID_ADDRESS}`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; data: unknown };
    expect(body.status).toBe("success");
    expect(body.data).toEqual([]);
  });

  it("returns 503 when the indexer health check fails", async () => {
    mockCheckIndexerHealth.mockResolvedValue(false);

    const app = createApp();
    const res = await app.request(
      `/trades/ohlcv/${VALID_ADDRESS}`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(503);
  });

  it("aggregates trades into OHLCV candles", async () => {
    mockFetchRouterTrades.mockResolvedValue([
      trade({ id: "1", usdcAmount: "1000000", timestamp: "1000" }),
      trade({ id: "2", usdcAmount: "2000000", timestamp: "1050" }),
      trade({ id: "3", usdcAmount: "500000", timestamp: "1100" }),
      // Next 5m bucket (300s apart from the first three).
      trade({ id: "4", usdcAmount: "3000000", timestamp: "1500" }),
    ]);

    const app = createApp();
    const res = await app.request(
      `/trades/ohlcv/${VALID_ADDRESS}?interval=5m`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: Record<string, unknown>[];
    };
    expect(body.status).toBe("success");

    expect(body.data).toHaveLength(2);

    const firstCandle = body.data[0] as Record<string, unknown>;
    expect(firstCandle.open).toBe(1);
    expect(firstCandle.high).toBe(2);
    expect(firstCandle.low).toBe(0.5);
    expect(firstCandle.close).toBe(0.5);
    expect(firstCandle.volume).toBeCloseTo(3.5);

    const secondCandle = body.data[1] as Record<string, unknown>;
    expect(secondCandle.open).toBe(3);
    expect(secondCandle.close).toBe(3);
  });

  it("skips trades with zero token amount", async () => {
    mockFetchRouterTrades.mockResolvedValue([
      trade({ tokenAmount: "0" }),
    ]);

    const app = createApp();
    const res = await app.request(
      `/trades/ohlcv/${VALID_ADDRESS}?interval=5m`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    expect(body.data).toEqual([]);
  });

  it("accepts all valid intervals", async () => {
    mockFetchRouterTrades.mockResolvedValue([]);

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

  it("returns trades enriched with token labels", async () => {
    mockFetchRouterTrades.mockResolvedValueOnce([
      trade({ id: "1", tokenAddress: VALID_ADDRESS.toLowerCase() }),
    ]);
    mockFetchTokenLabels.mockResolvedValueOnce(
      new Map([
        [
          VALID_ADDRESS.toLowerCase(),
          { address: VALID_ADDRESS, name: "Test Token", symbol: "TST" },
        ],
      ]),
    );

    const app = createApp();
    const res = await app.request(`/trades/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: { id: string; tokenSymbol?: string; tokenName?: string }[];
    };
    expect(body.status).toBe("success");
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: "1",
      tokenSymbol: "TST",
      tokenName: "Test Token",
    });
  });

  it("leaves labels undefined when the labels lookup returns blanks (placeholder row)", async () => {
    mockFetchRouterTrades.mockResolvedValueOnce([
      trade({ id: "1", tokenAddress: VALID_ADDRESS.toLowerCase() }),
    ]);
    mockFetchTokenLabels.mockResolvedValueOnce(
      new Map([
        [
          VALID_ADDRESS.toLowerCase(),
          { address: VALID_ADDRESS, name: "", symbol: "   " },
        ],
      ]),
    );

    const app = createApp();
    const res = await app.request(`/trades/${VALID_ADDRESS}`, {}, makeEnv());

    const body = (await res.json()) as {
      data: { tokenSymbol?: string; tokenName?: string }[];
    };
    expect(body.data[0].tokenSymbol).toBeUndefined();
    expect(body.data[0].tokenName).toBeUndefined();
  });

  it("returns 503 when the indexer read fails", async () => {
    mockFetchRouterTrades.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request(`/trades/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; data: unknown };
    expect(body.status).toBe("error");
    expect(body.data).toBeNull();
  });
});

describe("GET /trades", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns recent trades enriched with token labels", async () => {
    const TOKEN_A = "0xaaa0000000000000000000000000000000000001";
    const TOKEN_B = "0xbbb0000000000000000000000000000000000002";
    mockFetchRouterTrades.mockResolvedValueOnce([
      trade({ id: "1", tokenAddress: TOKEN_A }),
      trade({ id: "2", tokenAddress: TOKEN_A }),
      trade({ id: "3", tokenAddress: TOKEN_B }),
    ]);
    mockFetchTokenLabels.mockResolvedValueOnce(
      new Map([
        [TOKEN_A, { address: TOKEN_A, name: "Token A", symbol: "AAA" }],
        [TOKEN_B, { address: TOKEN_B, name: "Token B", symbol: "BBB" }],
      ]),
    );

    const app = createApp();
    const res = await app.request("/trades", {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; tokenSymbol?: string; tokenName?: string }[];
    };
    expect(body.data).toHaveLength(3);
    expect(body.data[0]).toMatchObject({
      id: "1",
      tokenSymbol: "AAA",
      tokenName: "Token A",
    });
    expect(body.data[1]).toMatchObject({
      id: "2",
      tokenSymbol: "AAA",
      tokenName: "Token A",
    });
    expect(body.data[2]).toMatchObject({
      id: "3",
      tokenSymbol: "BBB",
      tokenName: "Token B",
    });
    // Exactly one trades fetch + one labels fetch — labels are batched
    // across the response in a single round-trip, deduped by address.
    expect(mockFetchRouterTrades).toHaveBeenCalledTimes(1);
    expect(mockFetchTokenLabels).toHaveBeenCalledTimes(1);
    const [, uniqueAddrs] = mockFetchTokenLabels.mock.calls[0] as [
      unknown,
      string[],
    ];
    expect(uniqueAddrs.sort()).toEqual([TOKEN_A, TOKEN_B].sort());
  });

  it("falls through with undefined labels when the labels lookup misses", async () => {
    mockFetchRouterTrades.mockResolvedValueOnce([
      trade({ id: "1", tokenAddress: VALID_ADDRESS }),
    ]);
    mockFetchTokenLabels.mockResolvedValueOnce(new Map());

    const app = createApp();
    const res = await app.request("/trades", {}, makeEnv());

    const body = (await res.json()) as {
      data: { tokenSymbol?: string; tokenName?: string }[];
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].tokenSymbol).toBeUndefined();
    expect(body.data[0].tokenName).toBeUndefined();
  });

  it("returns 503 when the indexer read fails", async () => {
    mockFetchRouterTrades.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request("/trades", {}, makeEnv());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; data: unknown };
    expect(body.status).toBe("error");
    expect(body.data).toBeNull();
  });

  it("forwards limit + offset to the indexer read (issue #807)", async () => {
    mockFetchRouterTrades.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request("/trades?limit=20&offset=40", {}, makeEnv());

    expect(res.status).toBe(200);
    const [, opts] = mockFetchRouterTrades.mock.calls[0] as [
      unknown,
      { limit: number; offset: number },
    ];
    expect(opts.limit).toBe(20);
    expect(opts.offset).toBe(40);
  });

  it("rejects non-integer offset with 400", async () => {
    const app = createApp();
    const res = await app.request("/trades?offset=abc", {}, makeEnv());

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string | null };
    expect(body.error).toBe("Invalid pagination parameters");
    expect(mockFetchRouterTrades).not.toHaveBeenCalled();
  });

  it("defaults offset to 0 when omitted", async () => {
    mockFetchRouterTrades.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request("/trades?limit=10", {}, makeEnv());

    expect(res.status).toBe(200);
    const [, opts] = mockFetchRouterTrades.mock.calls[0] as [
      unknown,
      { offset: number },
    ];
    expect(opts.offset).toBe(0);
  });

  // Repro for the "buy popped up in the feed, then disappeared on refresh"
  // report. The indexer fires the WS broadcast inside the same tx that
  // inserts the `router_trade` row, then commits; the WS message reaches
  // the client *before* the trade is queryable. A cached `offset=0`
  // response from immediately before the trade landed would re-introduce
  // that race, so the route opts the live tail out at every cache layer.
  it("disables all caching for the live tail (offset=0)", async () => {
    mockFetchRouterTrades.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request("/trades?limit=50&offset=0", {}, makeEnv());

    expect(res.status).toBe(200);
    const cacheControl = res.headers.get("Cache-Control") ?? "";
    expect(cacheControl).toMatch(/s-maxage=0/);
    expect(cacheControl).toMatch(/max-age=0/);
    expect(cacheControl).toMatch(/no-store/);
  });

  it("keeps the historical pages (offset>0) cached at s-maxage=5", async () => {
    mockFetchRouterTrades.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request("/trades?limit=50&offset=50", {}, makeEnv());

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("s-maxage=5");
  });
});

describe("GET /trades/:address cache bypass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Same WS-vs-checkpoint race as the global feed.
  it("disables all caching for the live tail (offset=0)", async () => {
    mockFetchRouterTrades.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(
      `/trades/${VALID_ADDRESS}?limit=30&offset=0`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const cacheControl = res.headers.get("Cache-Control") ?? "";
    expect(cacheControl).toMatch(/s-maxage=0/);
    expect(cacheControl).toMatch(/max-age=0/);
    expect(cacheControl).toMatch(/no-store/);
  });

  it("keeps the historical pages (offset>0) cached at s-maxage=5", async () => {
    mockFetchRouterTrades.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(
      `/trades/${VALID_ADDRESS}?limit=30&offset=30`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("s-maxage=5");
  });
});
