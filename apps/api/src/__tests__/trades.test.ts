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

  it("returns trades for valid address enriched with token labels", async () => {
    // First call: routerTrades query. Second call: tokens(address_in)
    // lookup that powers the `tokenSymbol` / `tokenName` enrichment
    // (issue #703). Sequencing matters because the route fires both
    // through the same `createPonderQuery` returned mock.
    mockPonderQuery
      .mockResolvedValueOnce({
        routerTrades: {
          items: [{ id: "1", tokenAddress: VALID_ADDRESS.toLowerCase() }],
        },
      })
      .mockResolvedValueOnce({
        tokens: {
          items: [
            {
              address: VALID_ADDRESS.toLowerCase(),
              name: "Test Token",
              symbol: "TST",
            },
          ],
        },
      });

    const app = createApp();
    const res = await app.request(`/trades/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      error: string | null;
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

  it("leaves labels undefined when the tokens lookup returns blanks (placeholder row)", async () => {
    // Mirrors the indexer's `Factory:PairCreated` placeholder row,
    // which carries empty `name` / `symbol` until `TokenLaunched`
    // overwrites them. The API strips blank labels so the client
    // doesn't cache them as "resolved" (see `nonBlankOrUndefined`).
    mockPonderQuery
      .mockResolvedValueOnce({
        routerTrades: {
          items: [{ id: "1", tokenAddress: VALID_ADDRESS.toLowerCase() }],
        },
      })
      .mockResolvedValueOnce({
        tokens: {
          items: [
            {
              address: VALID_ADDRESS.toLowerCase(),
              name: "",
              symbol: "   ",
            },
          ],
        },
      });

    const app = createApp();
    const res = await app.request(`/trades/${VALID_ADDRESS}`, {}, makeEnv());

    const body = (await res.json()) as {
      data: { tokenSymbol?: string; tokenName?: string }[];
    };
    expect(body.data[0].tokenSymbol).toBeUndefined();
    expect(body.data[0].tokenName).toBeUndefined();
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

  it("returns recent trades enriched with token labels", async () => {
    const TOKEN_A = "0xaaa0000000000000000000000000000000000001";
    const TOKEN_B = "0xbbb0000000000000000000000000000000000002";
    // Same sequencing as the per-token endpoint above — `enrichTrades-
    // WithTokenLabels` always runs a single batched `tokens(address_in:)`
    // lookup after the `routerTrades` fetch, dedupe-keyed by lowercased
    // address. Issue #703.
    mockPonderQuery
      .mockResolvedValueOnce({
        routerTrades: {
          items: [
            { id: "1", tokenAddress: TOKEN_A },
            // Two trades for the same token in one batch — the helper
            // must de-dupe addresses before the tokens query so we
            // don't blow the batch cap on a busy token.
            { id: "2", tokenAddress: TOKEN_A },
            { id: "3", tokenAddress: TOKEN_B },
          ],
        },
      })
      .mockResolvedValueOnce({
        tokens: {
          items: [
            { address: TOKEN_A, name: "Token A", symbol: "AAA" },
            { address: TOKEN_B, name: "Token B", symbol: "BBB" },
          ],
        },
      });

    const app = createApp();
    const res = await app.request("/trades", {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; tokenSymbol?: string; tokenName?: string }[];
    };
    expect(body.data).toHaveLength(3);
    expect(body.data[0]).toMatchObject({ id: "1", tokenSymbol: "AAA", tokenName: "Token A" });
    expect(body.data[1]).toMatchObject({ id: "2", tokenSymbol: "AAA", tokenName: "Token A" });
    expect(body.data[2]).toMatchObject({ id: "3", tokenSymbol: "BBB", tokenName: "Token B" });
    // Exactly two queries: trades + tokens. The tokens query is a
    // single batched call regardless of duplicate addresses in the
    // trade list.
    expect(mockPonderQuery).toHaveBeenCalledTimes(2);
  });

  it("falls through with undefined labels when the tokens lookup misses", async () => {
    // The tokens query can return an empty `items` array if the
    // indexer hasn't seen any of the addresses yet (race with a
    // freshly-deployed token whose row hasn't checkpointed). The
    // trade list still goes out — the client falls back through the
    // existing `prefetchTokenName` healer, so a degraded label fetch
    // never blocks the feed.
    mockPonderQuery
      .mockResolvedValueOnce({
        routerTrades: { items: [{ id: "1", tokenAddress: VALID_ADDRESS }] },
      })
      .mockResolvedValueOnce({ tokens: { items: [] } });

    const app = createApp();
    const res = await app.request("/trades", {}, makeEnv());

    const body = (await res.json()) as {
      data: { tokenSymbol?: string; tokenName?: string }[];
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].tokenSymbol).toBeUndefined();
    expect(body.data[0].tokenName).toBeUndefined();
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

  it("forwards limit + offset to the Ponder query (issue #807)", async () => {
    // The home-page recent-trades list paginates by walking offsets
    // through this endpoint; the route must thread both knobs into the
    // GraphQL query so a `limit=20&offset=40` request lands on the
    // third page rather than refetching the first.
    mockPonderQuery
      .mockResolvedValueOnce({ routerTrades: { items: [] } })
      .mockResolvedValueOnce({ tokens: { items: [] } });

    const app = createApp();
    const res = await app.request("/trades?limit=20&offset=40", {}, makeEnv());

    expect(res.status).toBe(200);
    const firstCall = mockPonderQuery.mock.calls[0];
    const variables = firstCall[1] as { limit: number; offset: number };
    expect(variables.limit).toBe(20);
    expect(variables.offset).toBe(40);
  });

  it("rejects non-integer offset with 400", async () => {
    const app = createApp();
    const res = await app.request("/trades?offset=abc", {}, makeEnv());

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toBe("Invalid pagination parameters");
    // Defence-in-depth: the route must short-circuit before touching the
    // indexer when the input fails validation.
    expect(mockPonderQuery).not.toHaveBeenCalled();
  });

  it("defaults offset to 0 when omitted", async () => {
    mockPonderQuery
      .mockResolvedValueOnce({ routerTrades: { items: [] } })
      .mockResolvedValueOnce({ tokens: { items: [] } });

    const app = createApp();
    const res = await app.request("/trades?limit=10", {}, makeEnv());

    expect(res.status).toBe(200);
    const firstCall = mockPonderQuery.mock.calls[0];
    const variables = firstCall[1] as { limit: number; offset: number };
    expect(variables.offset).toBe(0);
  });
});
