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

const { default: chartRoute, buildPriceTimeline } = await import(
  "../routes/chart.js"
);

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
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
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
      })
      .mockResolvedValueOnce({ tokenSnapshots: { items: [] } });
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
      })
      .mockResolvedValueOnce({ tokenSnapshots: { items: [] } });
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
      })
      .mockResolvedValueOnce({ tokenSnapshots: { items: [] } });

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
      })
      .mockResolvedValueOnce({ tokenSnapshots: { items: [] } });

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

  it("defaults to 1-minute candles when neither timeframe nor interval is set", async () => {
    // The route's no-query default is part of the public API contract — it
    // changed from `timeframe=1d` (5-minute candles) to `interval=60`
    // (1-minute candles) in the sub-minute-intervals rework to match the
    // frontend's new default `ChartMode`. Pin it so a regression here is
    // caught instead of leaking out as a quiet UX change for direct API
    // consumers.
    const nowSec = Math.floor(Date.now() / 1000);

    mockPonderQuery
      .mockResolvedValueOnce({ __typename: "Query" })
      .mockResolvedValueOnce({
        token: {
          // k = TOTAL_SUPPLY × virtualLtAtLaunch (matches the happy-path test).
          k: "1000000000000000000000000000000000000000000000",
          ltToken: "0xB5A5EcA6Ddc738943A6CaF716D4185B3680dE4b7",
          graduated: false,
          graduatedAt: null,
          timestamp: String(nowSec - 600),
        },
      })
      .mockResolvedValueOnce({ tokenSnapshots: { items: [] } });

    mockNeonQuery.mockResolvedValue([
      { ts: String(nowSec - 480), exchange_rate: "2000000000000000000" },
      { ts: String(nowSec - 360), exchange_rate: "2000000000000000000" },
      { ts: String(nowSec - 240), exchange_rate: "2000000000000000000" },
      { ts: String(nowSec - 120), exchange_rate: "2000000000000000000" },
    ]);

    mockPonderPaginatedQuery.mockResolvedValue({ items: [], truncated: false });

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: { candles: { time: number }[] };
    };
    expect(body.status).toBe("success");
    expect(body.data.candles.length).toBeGreaterThan(0);
    // Candle times are `floor(sampleTs / candleSec) * candleSec` server-side
    // (`buildCandles`), so on the 1m default every bucket time must be a
    // multiple of 60.
    for (const candle of body.data.candles) {
      expect(candle.time % 60).toBe(0);
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

  it("filters paginated tokenSnapshots by fromSec and uses anchor before window", async () => {
    // Regression: without `timestamp_gte` the paginated query pulled the
    // token's full lifetime of trade snapshots (up to 20K rows) even though
    // the chart only consumes the slice that overlaps `[fromSec, nowSec]`.
    // We still need a single snapshot strictly before `fromSec` so the
    // first in-window LT-rate sample has a price baseline (otherwise the
    // ratio timeline would start mid-window with no carry-forward).
    const nowSec = Math.floor(Date.now() / 1000);

    mockPonderQuery
      .mockResolvedValueOnce({ __typename: "Query" })
      .mockResolvedValueOnce({
        token: {
          k: "1000000000000000000000000000000000000000000000",
          ltToken: "0xB5A5EcA6Ddc738943A6CaF716D4185B3680dE4b7",
          graduated: false,
          graduatedAt: null,
          // Launched well before any reasonable history window so
          // `fromSec = nowSec - MAX_HISTORY_CANDLES × candleSec`, not
          // clamped to launch time.
          timestamp: "1700000000",
        },
      })
      .mockResolvedValueOnce({
        tokenSnapshots: {
          items: [
            {
              curveSupply: "750000000000000000000000000",
              ltReserve: "1500000000000000000",
              timestamp: "1700000060",
            },
          ],
        },
      });

    mockNeonQuery.mockResolvedValue([
      { ts: String(nowSec - 60), exchange_rate: "2000000000000000000" },
    ]);

    mockPonderPaginatedQuery.mockResolvedValue({
      items: [
        {
          curveSupply: "500000000000000000000000000",
          ltReserve: "2500000000000000000",
          timestamp: String(nowSec - 30),
        },
      ],
      truncated: false,
    });

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);

    // Paginated query was called with `fromSec` plumbed through as a
    // GraphQL variable. Default candle width is 60s and
    // MAX_HISTORY_CANDLES is 1500 → fromSec ≈ nowSec - 90000.
    expect(mockPonderPaginatedQuery).toHaveBeenCalledTimes(1);
    const paginatedCall = mockPonderPaginatedQuery.mock.calls[0];
    expect(paginatedCall[0]).toContain("timestamp_gte: $fromSec");
    expect(paginatedCall[1]).toBe("tokenSnapshots");
    const paginatedVars = paginatedCall[2] as { fromSec: string };
    expect(paginatedVars.fromSec).toBeDefined();
    const fromSec = Number(paginatedVars.fromSec);
    expect(fromSec).toBeGreaterThanOrEqual(nowSec - 90_000);
    expect(fromSec).toBeLessThanOrEqual(nowSec - 89_900);

    // Anchor query was the third `queryPonder` call (after health + token).
    // It's the strictly-before-window query that gives us a ratio baseline.
    expect(mockPonderQuery).toHaveBeenCalledTimes(3);
    const anchorCall = mockPonderQuery.mock.calls[2];
    expect(anchorCall[0]).toContain("timestamp_lt: $fromSec");
    expect(anchorCall[0]).toContain('orderDirection: "desc"');
    expect(anchorCall[0]).toContain("limit: 1");
    const anchorVars = anchorCall[1] as { fromSec: string };
    expect(anchorVars.fromSec).toBe(paginatedVars.fromSec);
  });

  it("tolerates legitimately empty anchor (token launched inside window)", async () => {
    // A token with no snapshot strictly before `fromSec` (e.g. launched
    // inside the visible window) must still build a chart from the launch
    // anchor + in-window snapshots. An empty `items` array is the
    // "legitimately no prior snapshot" signal — distinct from `null` which
    // means the anchor lookup itself failed.
    const nowSec = Math.floor(Date.now() / 1000);

    mockPonderQuery
      .mockResolvedValueOnce({ __typename: "Query" })
      .mockResolvedValueOnce({
        token: {
          k: "1000000000000000000000000000000000000000000000",
          ltToken: "0xB5A5EcA6Ddc738943A6CaF716D4185B3680dE4b7",
          graduated: false,
          graduatedAt: null,
          timestamp: String(nowSec - 600),
        },
      })
      .mockResolvedValueOnce({ tokenSnapshots: { items: [] } });

    mockNeonQuery.mockResolvedValue([
      { ts: String(nowSec - 60), exchange_rate: "2000000000000000000" },
    ]);

    mockPonderPaginatedQuery.mockResolvedValue({
      items: [],
      truncated: false,
    });

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: { candles: unknown[] };
    };
    expect(body.status).toBe("success");
  });

  it("returns 503 when anchor query fails (Ponder degraded mid-request)", async () => {
    // Regression: a `null` return from `queryPonder` for the anchor query
    // means Ponder degraded *after* the up-front health check passed.
    // Silently falling back to "no prior snapshot" would recreate the
    // phantom-opening-candle bug this query exists to prevent — a token
    // with real trades between launch and `fromSec` would price the early
    // window against the launch anchor instead of its most recent
    // pre-window snapshot. Surface as 503 so the client retries instead.
    const nowSec = Math.floor(Date.now() / 1000);

    mockPonderQuery
      .mockResolvedValueOnce({ __typename: "Query" })
      .mockResolvedValueOnce({
        token: {
          k: "1000000000000000000000000000000000000000000000",
          ltToken: "0xB5A5EcA6Ddc738943A6CaF716D4185B3680dE4b7",
          graduated: false,
          graduatedAt: null,
          timestamp: "1700000000",
        },
      })
      .mockResolvedValueOnce(null);

    mockNeonQuery.mockResolvedValue([
      { ts: String(nowSec - 60), exchange_rate: "2000000000000000000" },
    ]);

    mockPonderPaginatedQuery.mockResolvedValue({
      items: [],
      truncated: false,
    });

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Trade history too large");
  });

  it("bridges the buy candle when a trade lands between LT samples (issue #599)", async () => {
    // Regression: when a trade snapshot's timestamp falls strictly between
    // two LT-rate samples, the bucket containing the trade used to render
    // as a flat doji (all its samples preceded the trade) and the next
    // bucket opened at the post-buy price — the chart showed a tiny
    // horizontal line followed by a discontinuous jump with no candle
    // bridging them. Fixed by injecting every ratio-change timestamp into
    // the price timeline as its own tick.
    //
    // Setup: 60s candles → sampleSec=20. LT samples land at fromSec, +20,
    // +40, +60, ... A trade lands in the middle of the first 60s bucket
    // (no LT sample lands between the trade and the bucket boundary), so
    // pre-fix the bucket showed only pre-buy prices.
    const baseSec = 1_700_000_000;
    const launchTs = baseSec - 100;
    const tradeTs = baseSec + 35; // strictly between samples at +20 and +40

    // Mock Date.now to a fixed point so `fromSec` is deterministic.
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue((baseSec + 90) * 1000);

    mockPonderQuery
      .mockResolvedValueOnce({ __typename: "Query" })
      .mockResolvedValueOnce({
        token: {
          // k = 1B × 1e18 (TOTAL_SUPPLY) × virtualLtAtLaunch = 1e18 → k = 1e45.
          k: "1000000000000000000000000000000000000000000000",
          ltToken: "0xB5A5EcA6Ddc738943A6CaF716D4185B3680dE4b7",
          graduated: false,
          graduatedAt: null,
          timestamp: String(launchTs),
        },
      })
      .mockResolvedValueOnce({ tokenSnapshots: { items: [] } });

    // Constant LT exchange rate of 1.0 across the window so the fix is
    // observable purely via the ratio change (rules out exchange-rate
    // drift muddying the assertions).
    mockNeonQuery.mockResolvedValue([
      { ts: String(baseSec), exchange_rate: "1000000000000000000" },
      { ts: String(baseSec + 20), exchange_rate: "1000000000000000000" },
      { ts: String(baseSec + 40), exchange_rate: "1000000000000000000" },
      { ts: String(baseSec + 60), exchange_rate: "1000000000000000000" },
      { ts: String(baseSec + 80), exchange_rate: "1000000000000000000" },
    ]);

    // Single trade at tradeTs that doubles the curve ratio (simulates a
    // big buy that drains LT into the curve and removes tokens).
    mockPonderPaginatedQuery.mockResolvedValue({
      items: [
        {
          // ratio = ltReserve / curveSupply = 4e18 / 500_000_000e18 = 8e-9
          // (vs. launch ratio of k/reserve0 / reserve0 = 1e-9).
          curveSupply: "500000000000000000000000000",
          ltReserve: "4000000000000000000",
          timestamp: String(tradeTs),
        },
      ],
      truncated: false,
    });

    try {
      const app = createApp();
      // Force interval=60 so the bucket alignment matches the test
      // narrative regardless of `Date.now()` defaults.
      const res = await app.request(
        `/chart/${VALID_ADDRESS}?interval=60`,
        {},
        makeEnv(),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        data: {
          candles: { time: number; open: number; high: number; low: number; close: number }[];
        };
      };
      expect(body.status).toBe("success");

      // The trade lands in bucket [floor(tradeTs/60)*60, +60).
      const tradeBucketTs = Math.floor(tradeTs / 60) * 60;
      const tradeBucket = body.data.candles.find((c) => c.time === tradeBucketTs);
      expect(tradeBucket).toBeDefined();
      // The bucket's close must reflect the post-trade price (8x the
      // pre-trade price — see ratios above). Pre-fix this was equal to
      // the open and the next bucket jumped to the new price unbridged.
      expect(tradeBucket!.close).toBeGreaterThan(tradeBucket!.open);
      expect(tradeBucket!.high).toBeGreaterThanOrEqual(tradeBucket!.close);

      // The next bucket's open must be at-or-near the trade bucket's
      // close (zero-gap bridge). Pre-fix the open jumped to the post-buy
      // price while the previous close was still the pre-buy price.
      const nextBucketTs = tradeBucketTs + 60;
      const nextBucket = body.data.candles.find((c) => c.time === nextBucketTs);
      if (nextBucket) {
        expect(nextBucket.open).toBeCloseTo(tradeBucket!.close, 12);
      }
    } finally {
      dateNowSpy.mockRestore();
    }
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

describe("buildPriceTimeline", () => {
  it("returns empty when either input stream is empty", () => {
    expect(
      buildPriceTimeline([], [{ timestamp: 100, ratio: 1 }]),
    ).toEqual([]);
    expect(
      buildPriceTimeline(
        [{ ts: "100", exchange_rate: "1000000000000000000" }],
        [],
      ),
    ).toEqual([]);
  });

  it("emits a price tick at every LT sample using the latest ratio", () => {
    const ltRows = [
      { ts: "100", exchange_rate: "2000000000000000000" }, // rate 2
      { ts: "120", exchange_rate: "2000000000000000000" },
    ];
    // Ratio anchor at t=110 (between the two LT samples) so we don't
    // double-tick at LT-sample timestamps — that coincident-timestamp
    // case has its own dedicated test below.
    const ratioTimeline = [
      { timestamp: 110, ratio: 0.5 },
    ];

    const out = buildPriceTimeline(ltRows, ratioTimeline);
    // LT@100 has no preceding ratio (anchor is at t=110) → skipped.
    // ratio@110 picks up the freshest LT rate (=2) → price 1.
    // LT@120 carries the ratio forward → price 1.
    expect(out).toEqual([
      { ts: 110, price: 1 },
      { ts: 120, price: 1 },
    ]);
  });

  it("injects a price tick at each ratio change so trades between LT samples land in the right bucket (issue #599)", () => {
    // LT samples at fixed 20s cadence; trade at t=35 (between 20 and 40)
    // doubles the ratio. Pre-fix, the bucket containing the trade had no
    // post-trade sample — the close stayed at the pre-trade price and the
    // next bucket jumped without bridging.
    const ltRows = [
      { ts: "0", exchange_rate: "1000000000000000000" },
      { ts: "20", exchange_rate: "1000000000000000000" },
      { ts: "40", exchange_rate: "1000000000000000000" },
      { ts: "60", exchange_rate: "1000000000000000000" },
    ];
    const ratioTimeline = [
      { timestamp: 0, ratio: 1 },
      { timestamp: 35, ratio: 2 },
    ];

    const out = buildPriceTimeline(ltRows, ratioTimeline);

    // The trade timestamp must be present as its own price tick.
    const tradeTick = out.find((p) => p.ts === 35);
    expect(tradeTick).toBeDefined();
    expect(tradeTick!.price).toBe(2); // post-trade ratio × current LT rate

    // And subsequent LT samples must use the new ratio.
    const post = out.find((p) => p.ts === 40);
    expect(post!.price).toBe(2);
  });

  it("at coincident timestamps, ratio price wins as bucket close (LT processed first)", () => {
    // When a ratio change shares a timestamp with an LT sample, we want
    // the LT update to happen first (so the ratio's price uses the
    // freshest rate) and the ratio tick to come last (so it determines
    // the bucket close). This matches the trade-then-settle ordering of
    // an on-chain block.
    const ltRows = [
      { ts: "100", exchange_rate: "2000000000000000000" },
    ];
    const ratioTimeline = [
      { timestamp: 100, ratio: 1 },
      { timestamp: 100, ratio: 3 },
    ];

    const out = buildPriceTimeline(ltRows, ratioTimeline);
    // 1 lt + 2 ratio ticks. The last one (ratio=3) is the close.
    expect(out).toHaveLength(3);
    expect(out[out.length - 1]).toEqual({ ts: 100, price: 6 });
  });

  it("skips ratio events before the first LT sample (no rate to multiply)", () => {
    // Launch anchor ratio sits at t=0, but the first LT-rate sample is
    // at t=50 (e.g. token launched before `fromSec` of the BounceTech
    // window). The launch anchor must not produce a price tick — there's
    // no exchange rate to multiply against.
    const ltRows = [
      { ts: "50", exchange_rate: "1000000000000000000" },
    ];
    const ratioTimeline = [
      { timestamp: 0, ratio: 1 }, // launch anchor — pre-window
      { timestamp: 60, ratio: 2 }, // trade — post-first-sample
    ];

    const out = buildPriceTimeline(ltRows, ratioTimeline);
    // Only the LT@50 (price=1) and the trade@60 (price=2) survive.
    expect(out.map((p) => p.ts)).toEqual([50, 60]);
  });

  it("preserves chronological order across mixed events", () => {
    const ltRows = [
      { ts: "0", exchange_rate: "1000000000000000000" },
      { ts: "30", exchange_rate: "1000000000000000000" },
      { ts: "60", exchange_rate: "1000000000000000000" },
    ];
    const ratioTimeline = [
      { timestamp: 0, ratio: 1 },
      { timestamp: 15, ratio: 2 },
      { timestamp: 45, ratio: 3 },
    ];

    const out = buildPriceTimeline(ltRows, ratioTimeline);
    const timestamps = out.map((p) => p.ts);
    const sorted = [...timestamps].sort((a, b) => a - b);
    expect(timestamps).toEqual(sorted);
  });
});
