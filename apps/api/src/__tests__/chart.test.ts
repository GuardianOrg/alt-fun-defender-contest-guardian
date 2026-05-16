import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

// --- Direct-Postgres indexer-reads mock ---
//
// Post-cut-over, the chart route reads chart context + snapshots straight
// from `ponder_views.*` via `lib/indexer-reads.ts`. The legacy GraphQL
// helpers (`ponder-client.js`) are stubbed to noop trackers below so the
// regression-pin test can assert the route never falls back to the
// retired Ponder HTTP hop on any code path. Mirrors the pattern in
// `health.test.ts`.
const mockCheckIndexerHealth = vi.fn();
const mockFetchTokenChartContext = vi.fn();
const mockFetchTokenChartSnapshots = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  checkIndexerHealth: (...args: unknown[]) => mockCheckIndexerHealth(...args),
  fetchTokenChartContext: (...args: unknown[]) =>
    mockFetchTokenChartContext(...args),
  fetchTokenChartSnapshots: (...args: unknown[]) =>
    mockFetchTokenChartSnapshots(...args),
}));

const mockPonderQuery = vi.fn();
const mockPonderPaginatedQuery = vi.fn();
const mockCheckPonderHealth = vi.fn();

vi.mock("../lib/ponder-client.js", () => ({
  createPonderQuery: () => mockPonderQuery,
  createPonderPaginatedQuery: () => mockPonderPaginatedQuery,
  checkPonderHealth: (...args: unknown[]) => mockCheckPonderHealth(...args),
}));

// --- API DB mock (the `tokens` table lookup for `ltPair` fallback) ---
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

// --- BounceTech Neon mock (LT exchange rate `generate_series`) ---
const mockNeonQuery = vi.fn();
vi.mock("@neondatabase/serverless", () => ({
  neon: () => mockNeonQuery,
}));

const { default: chartRoute, buildPriceTimeline } =
  await import("../routes/chart.js");

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
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

const VALID_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const LT_ADDRESS = "0xB5A5EcA6Ddc738943A6CaF716D4185B3680dE4b7";

describe("GET /chart/:address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckIndexerHealth.mockResolvedValue(true);
    mockFetchTokenChartContext.mockResolvedValue(null);
    mockFetchTokenChartSnapshots.mockResolvedValue([]);
    mockNeonQuery.mockResolvedValue([]);
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

  it("returns 503 when the indexer health probe fails", async () => {
    mockCheckIndexerHealth.mockResolvedValue(false);

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Indexer unavailable");
  });

  it("returns 503 when the chart context lookup errors out", async () => {
    // Distinct from "row missing" (which maps to 404 below). `"unavailable"`
    // is the indexer-reads contract for "caught error" — the indexer DB
    // hiccuped between the health probe and the context query, and the
    // client should retry rather than render against partial data.
    mockFetchTokenChartContext.mockResolvedValue("unavailable");

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Indexer unavailable");
  });

  it("returns 404 when neither tokens.ltPair nor indexer ltToken is available", async () => {
    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(404);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Token not found");
  });

  it("returns empty snapshot when no LT exchange-rate samples exist", async () => {
    mockFetchTokenChartContext.mockResolvedValue({
      k: "1000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: "1700000000",
    });

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

  it("returns 503 when the snapshot fetch errors out (indexer degraded mid-request)", async () => {
    // Distinguishes "caught error inside fetchTokenChartSnapshots" (null)
    // from "legitimately no snapshots in window" (empty array, handled
    // below). Mirrors the legacy route's anchor-failed branch that used to
    // 503 when a Ponder hiccup landed between the health probe and the
    // pagination call.
    mockFetchTokenChartContext.mockResolvedValue({
      k: "1000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: "1700000000",
    });
    mockNeonQuery.mockResolvedValue([
      { ts: "1700000060", exchange_rate: "1000000000000000000" },
    ]);
    mockFetchTokenChartSnapshots.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Indexer unavailable");
  });

  it("returns candles with correct shape on happy path", async () => {
    const nowSec = Math.floor(Date.now() / 1000);

    mockFetchTokenChartContext.mockResolvedValue({
      // k = TOTAL_SUPPLY × virtualLtAtLaunch, with TOTAL_SUPPLY = 1B × 1e18
      // and a virtualLtAtLaunch of 1e18 → k = 1e45.
      k: "1000000000000000000000000000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: String(nowSec - 3600),
    });

    mockNeonQuery.mockResolvedValue([
      { ts: String(nowSec - 600), exchange_rate: "2000000000000000000" },
      { ts: String(nowSec - 300), exchange_rate: "2100000000000000000" },
      { ts: String(nowSec - 100), exchange_rate: "1900000000000000000" },
    ]);

    mockFetchTokenChartSnapshots.mockResolvedValue([
      {
        curveSupply: "500000000000000000000000000",
        ltReserve: "2000000000000000000",
        timestamp: String(nowSec - 3500),
      },
    ]);

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

    mockFetchTokenChartContext.mockResolvedValue({
      // k = reserve0 × reserve1 with no fixed-point factor (Pair.sol).
      // 1B × 1e18 reserve0 with virtualLt = 1.0 (1e18 wei) → k = 1e45.
      k: "1000000000000000000000000000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: String(nowSec - 600),
    });

    // LT rate constant at 2.0 across the window.
    mockNeonQuery.mockResolvedValue([
      { ts: String(nowSec - 300), exchange_rate: "2000000000000000000" },
      { ts: String(nowSec - 100), exchange_rate: "2000000000000000000" },
    ]);

    // No indexed trades yet → ratio timeline = just the launch anchor.
    mockFetchTokenChartSnapshots.mockResolvedValue([]);

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

    mockFetchTokenChartContext.mockResolvedValue({
      // k = TOTAL_SUPPLY × virtualLtAtLaunch (matches the happy-path test).
      k: "1000000000000000000000000000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: String(nowSec - 600),
    });

    mockNeonQuery.mockResolvedValue([
      { ts: String(nowSec - 480), exchange_rate: "2000000000000000000" },
      { ts: String(nowSec - 360), exchange_rate: "2000000000000000000" },
      { ts: String(nowSec - 240), exchange_rate: "2000000000000000000" },
      { ts: String(nowSec - 120), exchange_rate: "2000000000000000000" },
    ]);

    mockFetchTokenChartSnapshots.mockResolvedValue([]);

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
    const app = createApp();

    for (const tf of ["1d", "5d", "1m"]) {
      // Defaults from beforeEach hand back chartContext=null, so we land in
      // the 404 branch — proves validation passed before the lookup.
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
      const res = await app.request(
        `/chart/${VALID_ADDRESS}?interval=${seconds}`,
        {},
        makeEnv(),
      );
      // Passes validation and reaches the token-lookup branch (404 because
      // `chartContext` is null and `tokens.ltPair` is empty in defaults).
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

  it("plumbs fromSec into fetchTokenChartSnapshots so the indexer scan is bounded", async () => {
    // Regression: the route bounds the snapshot read by `fromSec` so a
    // mature token's full lifetime of snapshots (potentially tens of
    // thousands of rows) doesn't get pulled on every request. Assert the
    // `fromSec` plumbed into the helper matches the `MAX_HISTORY_CANDLES ×
    // candleSec` window. Replaces the legacy `timestamp_gte: $fromSec`
    // GraphQL-shape assertion now that the read path is direct SQL.
    const nowSec = Math.floor(Date.now() / 1000);

    mockFetchTokenChartContext.mockResolvedValue({
      k: "1000000000000000000000000000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      // Launched well before any reasonable history window so `fromSec`
      // tracks the candle window cap, not the launch timestamp.
      timestamp: "1700000000",
    });

    mockNeonQuery.mockResolvedValue([
      { ts: String(nowSec - 60), exchange_rate: "2000000000000000000" },
    ]);

    mockFetchTokenChartSnapshots.mockResolvedValue([]);

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);

    // Default candle width is 60s, MAX_HISTORY_CANDLES is 1500 →
    // fromSec ≈ nowSec - 90000. Allow a ±100s tolerance for the wall
    // clock advancing during the request.
    expect(mockFetchTokenChartSnapshots).toHaveBeenCalledTimes(1);
    const args = mockFetchTokenChartSnapshots.mock.calls[0];
    expect(args[1]).toBe(VALID_ADDRESS.toLowerCase());
    const fromSec = args[2] as number;
    expect(fromSec).toBeGreaterThanOrEqual(nowSec - 90_100);
    expect(fromSec).toBeLessThanOrEqual(nowSec - 89_900);
  });

  it("tolerates legitimately empty snapshot window (token launched inside window, no trades)", async () => {
    // A token with no snapshots strictly before `fromSec` (e.g. launched
    // inside the visible window) must still build a chart from the launch
    // anchor + (empty) in-window snapshots. An empty array is the
    // "legitimately no snapshots" signal — distinct from `null` which
    // means the lookup itself failed.
    const nowSec = Math.floor(Date.now() / 1000);

    mockFetchTokenChartContext.mockResolvedValue({
      k: "1000000000000000000000000000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: String(nowSec - 600),
    });

    mockNeonQuery.mockResolvedValue([
      { ts: String(nowSec - 60), exchange_rate: "2000000000000000000" },
    ]);

    mockFetchTokenChartSnapshots.mockResolvedValue([]);

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: { candles: unknown[] };
    };
    expect(body.status).toBe("success");
  });

  it("never falls back to the legacy Ponder GraphQL hop", async () => {
    // Cut-over regression-pin: the chart route serves traffic from
    // `ponder_views.*` directly — no GraphQL on any code path. Same
    // pattern as `health.test.ts`. We assert the negative side after a
    // real successful request so a copy-paste refactor would not pass
    // by short-circuiting before any work happens.
    mockFetchTokenChartContext.mockResolvedValue({
      k: "1000000000000000000000000000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: String(Math.floor(Date.now() / 1000) - 600),
    });
    mockNeonQuery.mockResolvedValue([
      { ts: "1700000060", exchange_rate: "2000000000000000000" },
    ]);
    mockFetchTokenChartSnapshots.mockResolvedValue([]);

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    expect(mockPonderQuery).not.toHaveBeenCalled();
    expect(mockPonderPaginatedQuery).not.toHaveBeenCalled();
    expect(mockCheckPonderHealth).not.toHaveBeenCalled();
    expect(mockCheckIndexerHealth).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when BOUNCETECH_DATABASE_URL is missing", async () => {
    // The BounceTech LT-rate query needs its own Neon URL — missing
    // binding must surface as a clean 500 with a generic client-facing
    // message (the binding name only goes to server-side logs).
    mockFetchTokenChartContext.mockResolvedValue({
      k: "1000000000000000000000000000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: String(Math.floor(Date.now() / 1000) - 600),
    });

    const env = makeEnv();
    env.BOUNCETECH_DATABASE_URL = "";

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, env);

    expect(res.status).toBe(500);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toBe("Internal server error");
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
    const dateNowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue((baseSec + 90) * 1000);

    mockFetchTokenChartContext.mockResolvedValue({
      // k = 1B × 1e18 (TOTAL_SUPPLY) × virtualLtAtLaunch = 1e18 → k = 1e45.
      k: "1000000000000000000000000000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: String(launchTs),
    });

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
    mockFetchTokenChartSnapshots.mockResolvedValue([
      {
        // ratio = ltReserve / curveSupply = 4e18 / 500_000_000e18 = 8e-9
        // (vs. launch ratio of k/reserve0 / reserve0 = 1e-9).
        curveSupply: "500000000000000000000000000",
        ltReserve: "4000000000000000000",
        timestamp: String(tradeTs),
      },
    ]);

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
          candles: {
            time: number;
            open: number;
            high: number;
            low: number;
            close: number;
          }[];
        };
      };
      expect(body.status).toBe("success");

      // The trade lands in bucket [floor(tradeTs/60)*60, +60).
      const tradeBucketTs = Math.floor(tradeTs / 60) * 60;
      const tradeBucket = body.data.candles.find(
        (c) => c.time === tradeBucketTs,
      );
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

  it("renders trade as a candle body when trade lands before the first LT sample of its bucket (Option B regression)", async () => {
    // Pure-data-shape regression for the gap-after-refresh bug. The LT
    // sample grid is offset relative to bucket boundaries such that a
    // trade timestamp falls in a bucket BEFORE the first LT sample of
    // that bucket. Pre-fix, the bucket's `open` collapsed to the
    // post-trade price (the trade was the first in-bucket event) and
    // intra-bucket `low` lost the pre-trade carry-forward value, so the
    // chart rendered as two flat lines with a vertical gap. Post-fix,
    // a synthetic carry-forward tick at the bucket boundary anchors
    // `open` AND `low` at the pre-trade price → real body + correct
    // intra-bucket range.
    //
    // Crucially this asserts `low === open` at the pre-trade price.
    // Option A would have rewritten `open` only and left `low` at the
    // post-trade level, so this assertion is the litmus test that the
    // fix actually corrects the data shape and is not just papering
    // over the visual symptom.
    const baseSec = 1_700_000_000;
    const launchTs = baseSec - 100;
    // Trade lands in bucket B = [bucketStart, bucketStart + 60). LT
    // grid is offset 18s from bucketStart, so the first LT sample of
    // bucket B is at bucketStart + 18. Trade at bucketStart + 5 is
    // strictly before any LT sample of bucket B.
    const bucketStart = Math.floor(baseSec / 60) * 60 + 60;
    const tradeTs = bucketStart + 5;

    const dateNowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue((bucketStart + 120) * 1000);

    mockFetchTokenChartContext.mockResolvedValue({
      k: "1000000000000000000000000000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: String(launchTs),
    });

    // LT grid samples that all sit AFTER the trade in bucket B. The
    // bucket boundary at `bucketStart` has no LT sample, so pre-fix
    // the trade tick was the bucket's first event and stamped `open`
    // with the post-trade price.
    mockNeonQuery.mockResolvedValue([
      // Bucket A samples (pre-trade ratio).
      { ts: String(bucketStart - 42), exchange_rate: "1000000000000000000" },
      { ts: String(bucketStart - 22), exchange_rate: "1000000000000000000" },
      { ts: String(bucketStart - 2), exchange_rate: "1000000000000000000" },
      // Bucket B samples — all AFTER tradeTs = bucketStart + 5.
      { ts: String(bucketStart + 18), exchange_rate: "1000000000000000000" },
      { ts: String(bucketStart + 38), exchange_rate: "1000000000000000000" },
      { ts: String(bucketStart + 58), exchange_rate: "1000000000000000000" },
    ]);

    // 8x ratio jump simulates a big buy. Pre-fix the bucket would have
    // shown a flat doji at 8e-9; post-fix it shows a body from 1e-9 to
    // 8e-9.
    mockFetchTokenChartSnapshots.mockResolvedValue([
      {
        curveSupply: "500000000000000000000000000",
        ltReserve: "4000000000000000000",
        timestamp: String(tradeTs),
      },
    ]);

    try {
      const app = createApp();
      const res = await app.request(
        `/chart/${VALID_ADDRESS}?interval=60`,
        {},
        makeEnv(),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        data: {
          candles: {
            time: number;
            open: number;
            high: number;
            low: number;
            close: number;
          }[];
        };
      };
      expect(body.status).toBe("success");

      const tradeBucket = body.data.candles.find((c) => c.time === bucketStart);
      expect(tradeBucket).toBeDefined();

      // Body visible: post-trade close > pre-trade open.
      expect(tradeBucket!.close).toBeGreaterThan(tradeBucket!.open);

      // The decisive Option-B assertion: the bucket's `low` MUST equal
      // the pre-trade carry-forward price (= open), not the post-trade
      // price. Option A would leave `low` at the post-trade price.
      expect(tradeBucket!.low).toBeCloseTo(tradeBucket!.open, 18);

      // And `high` reflects the post-trade tick (= close).
      expect(tradeBucket!.high).toBeCloseTo(tradeBucket!.close, 18);

      // Sanity: the previous bucket's close matches the trade bucket's
      // open (no visual gap).
      const prevBucket = body.data.candles.find(
        (c) => c.time === bucketStart - 60,
      );
      if (prevBucket) {
        expect(prevBucket.close).toBeCloseTo(tradeBucket!.open, 18);
      }
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("renders trade as a candle body on 5s candles when trade lands exactly on a bucket boundary", async () => {
    // 5s-chart-specific regression for the secondary gap reported
    // post-#662. With `candleSec = 5` and `sampleSec = 2` the LT grid
    // can land such that no LT sample sits at a given bucket boundary;
    // a trade whose block timestamp happens to be `bucketStart` exactly
    // (~20% probability on integer-second blocks, vs ~1.7% on 60s
    // candles) made the trade tick the bucket's first event and
    // collapsed `open` to the post-trade price. The fix is to also
    // emit the synthetic carry-forward tick when the boundary event
    // is a ratio event — see `buildPriceTimeline` in
    // `apps/api/src/routes/chart.ts`.
    const baseSec = 1_700_000_000;
    const launchTs = baseSec - 100;
    // Pick `bucketStart` such that mod 5 == 0 AND no LT sample lands
    // there (LT grid offset is 2s steps starting from `fromSec`, and
    // we mock the LT rows to leave a gap at the boundary). Trade ts
    // equals bucketStart.
    const bucketStart = Math.floor(baseSec / 5) * 5 + 5;
    const tradeTs = bucketStart;

    const dateNowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue((bucketStart + 10) * 1000);

    mockFetchTokenChartContext.mockResolvedValue({
      k: "1000000000000000000000000000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: String(launchTs),
    });

    // LT samples bracket the boundary (at bucketStart - 3 and
    // bucketStart + 2) but no sample lands AT bucketStart itself.
    mockNeonQuery.mockResolvedValue([
      { ts: String(bucketStart - 3), exchange_rate: "1000000000000000000" },
      { ts: String(bucketStart - 1), exchange_rate: "1000000000000000000" },
      { ts: String(bucketStart + 2), exchange_rate: "1000000000000000000" },
      { ts: String(bucketStart + 4), exchange_rate: "1000000000000000000" },
    ]);

    // 8x ratio jump (1e-9 → 8e-9) simulates a big buy at the boundary.
    mockFetchTokenChartSnapshots.mockResolvedValue([
      {
        curveSupply: "500000000000000000000000000",
        ltReserve: "4000000000000000000",
        timestamp: String(tradeTs),
      },
    ]);

    try {
      const app = createApp();
      const res = await app.request(
        `/chart/${VALID_ADDRESS}?interval=5`,
        {},
        makeEnv(),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        data: {
          candles: {
            time: number;
            open: number;
            high: number;
            low: number;
            close: number;
          }[];
        };
      };
      expect(body.status).toBe("success");

      const tradeBucket = body.data.candles.find((c) => c.time === bucketStart);
      expect(tradeBucket).toBeDefined();

      // Body visible: close at post-trade is strictly greater than
      // open at pre-trade.
      expect(tradeBucket!.close).toBeGreaterThan(tradeBucket!.open);

      // The decisive assertion: `low === open` at the pre-trade carry-
      // forward price. Pre-fix `low` collapsed to the post-trade price
      // because every in-bucket tick used the post-trade ratio.
      expect(tradeBucket!.low).toBeCloseTo(tradeBucket!.open, 18);
      expect(tradeBucket!.high).toBeCloseTo(tradeBucket!.close, 18);

      // No vertical gap to the previous bucket.
      const prevBucket = body.data.candles.find(
        (c) => c.time === bucketStart - 5,
      );
      if (prevBucket) {
        expect(prevBucket.close).toBeCloseTo(tradeBucket!.open, 18);
      }
    } finally {
      dateNowSpy.mockRestore();
    }
  });
});

describe("GET /chart/:address — edge cache (issue #973)", () => {
  // Fresh in-memory `caches.default` per test, same pattern as the
  // wallet-aware cache block in `tokens.test.ts` and `edge-cache.test.ts`.
  // The store is keyed on `req.url` (matching Cloudflare's URL-keyed
  // Cache API contract closely enough for the route's `put` call).
  let cacheMatch: ReturnType<typeof vi.fn>;
  let cachePut: ReturnType<typeof vi.fn>;
  let cacheStore: Map<string, Response>;

  function installFakeCache() {
    cacheStore = new Map<string, Response>();
    cacheMatch = vi.fn(async (req: Request) => {
      const stored = cacheStore.get(req.url);
      return stored ? stored.clone() : undefined;
    });
    cachePut = vi.fn(async (req: Request, res: Response) => {
      cacheStore.set(req.url, res.clone());
    });
    (globalThis as { caches?: { default: unknown } }).caches = {
      default: { match: cacheMatch, put: cachePut },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckIndexerHealth.mockResolvedValue(true);
    mockFetchTokenChartContext.mockResolvedValue(null);
    mockFetchTokenChartSnapshots.mockResolvedValue([]);
    mockNeonQuery.mockResolvedValue([]);
    installFakeCache();
  });

  afterEach(() => {
    // The wider suite installs `caches = undefined` at module load — restore
    // that so subsequent describes don't accidentally see a cache. Mirrors
    // the teardown in `tokens.test.ts`'s wallet-aware cache block.
    delete (globalThis as { caches?: unknown }).caches;
  });

  it("stamps Cache-Control and writes caches.default on the happy 200 path", async () => {
    const nowSec = Math.floor(Date.now() / 1000);

    mockFetchTokenChartContext.mockResolvedValue({
      k: "1000000000000000000000000000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: String(nowSec - 600),
    });
    mockNeonQuery.mockResolvedValue([
      { ts: String(nowSec - 300), exchange_rate: "2000000000000000000" },
      { ts: String(nowSec - 100), exchange_rate: "2000000000000000000" },
    ]);
    mockFetchTokenChartSnapshots.mockResolvedValue([]);

    const app = createApp();
    const res = await app.request(
      `/chart/${VALID_ADDRESS}?interval=60`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    // The directive must exactly match what `edgeCacheableJsonHeader(3)`
    // produces — pin both the TTL value and the SWR companion so a
    // future refactor of either constant breaks loudly. Mirrors the
    // pinning style used in `trades.test.ts`.
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=3, stale-while-revalidate=6",
    );
    // Cache write happens under the same URL the pre-auth
    // `serveFromEdgeCache` middleware will read from on the next
    // request — so a warm-cache request short-circuits before any
    // origin work runs.
    expect(cachePut).toHaveBeenCalledTimes(1);
    const [putReq] = cachePut.mock.calls[0]!;
    expect((putReq as Request).method).toBe("GET");
    expect((putReq as Request).url).toContain(VALID_ADDRESS);
    expect((putReq as Request).url).toContain("interval=60");
  });

  it("caches the empty-LT-window 200 success branch", async () => {
    // `ltRows.length === 0` returns a 200 with empty candles — that's
    // still a valid response (no exchange-rate samples in window) and
    // should be cacheable. Pre-fix this branch silently leaked through
    // without a Cache-Control header.
    mockFetchTokenChartContext.mockResolvedValue({
      k: "1000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: "1700000000",
    });
    mockNeonQuery.mockResolvedValue([]);

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=3, stale-while-revalidate=6",
    );
    expect(cachePut).toHaveBeenCalledTimes(1);
  });

  it("caches the empty-ratio-timeline 200 success branch", async () => {
    // `ratioTimeline.length === 0` (no `k` and no in-window trade
    // snapshots) returns a 200 with the latest exchange rate but no
    // candles. Still a valid happy-path response — should carry the
    // cache directive AND populate `caches.default` like the full
    // success path.
    const nowSec = Math.floor(Date.now() / 1000);
    mockFetchTokenChartContext.mockResolvedValue({
      k: null,
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: String(nowSec - 600),
    });
    mockNeonQuery.mockResolvedValue([
      { ts: String(nowSec - 60), exchange_rate: "2000000000000000000" },
    ]);
    mockFetchTokenChartSnapshots.mockResolvedValue([]);

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=3, stale-while-revalidate=6",
    );
    expect(cachePut).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache 400 invalid-address responses", async () => {
    // Validation failures must not be pinned in the edge — a fix that
    // re-allows the address must reach origin on the next request.
    const app = createApp();
    const res = await app.request("/chart/not-an-address", {}, makeEnv());

    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(cachePut).not.toHaveBeenCalled();
  });

  it("does NOT cache 400 invalid-interval responses", async () => {
    const app = createApp();
    const res = await app.request(
      `/chart/${VALID_ADDRESS}?interval=42`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(cachePut).not.toHaveBeenCalled();
  });

  it("does NOT cache 404 token-not-found responses", async () => {
    // `chartContext === null` + no `tokens.ltPair` row maps to 404. A
    // newly-launched token would hit this branch in the indexing gap
    // between the on-chain launch and the indexer catching up — caching
    // a 404 here would mask the token for the TTL window across the
    // entire POP.
    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(cachePut).not.toHaveBeenCalled();
  });

  it("does NOT cache 503 indexer-unavailable responses (health probe)", async () => {
    // Transient indexer outages must not be cached — the next request
    // after recovery has to reach origin to serve real data.
    mockCheckIndexerHealth.mockResolvedValue(false);

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(cachePut).not.toHaveBeenCalled();
  });

  it("does NOT cache 503 indexer-unavailable responses (snapshot fetch failure)", async () => {
    // Distinct branch from the health probe: the snapshot fetch threw
    // mid-request (returns `null`). Same caching rule — must not pin a
    // transient failure.
    const nowSec = Math.floor(Date.now() / 1000);
    mockFetchTokenChartContext.mockResolvedValue({
      k: "1000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: String(nowSec - 600),
    });
    mockNeonQuery.mockResolvedValue([
      { ts: String(nowSec - 60), exchange_rate: "2000000000000000000" },
    ]);
    mockFetchTokenChartSnapshots.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(cachePut).not.toHaveBeenCalled();
  });

  it("does NOT cache 500 BOUNCETECH_DATABASE_URL-missing responses", async () => {
    // Misconfiguration — the next request must reach the (fixed) origin.
    mockFetchTokenChartContext.mockResolvedValue({
      k: "1000000000000000000000000000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: String(Math.floor(Date.now() / 1000) - 600),
    });
    const env = makeEnv();
    env.BOUNCETECH_DATABASE_URL = "";

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, env);

    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(cachePut).not.toHaveBeenCalled();
  });

  it("still returns 200 when caches.default.put rejects (best-effort write)", async () => {
    // A `cache.put` rejection (response body over the per-entry size
    // limit, transient Cache API failure, etc.) must NOT turn a clean
    // 200 success into a 5xx. The route swallows the rejection,
    // structured-logs for ops triage, and returns the response
    // unchanged with its `Cache-Control` header intact. CodeRabbit
    // feedback on PR #984.
    cachePut.mockRejectedValueOnce(new Error("cache write failed"));

    const nowSec = Math.floor(Date.now() / 1000);
    mockFetchTokenChartContext.mockResolvedValue({
      k: "1000000000000000000000000000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: String(nowSec - 600),
    });
    mockNeonQuery.mockResolvedValue([
      { ts: String(nowSec - 60), exchange_rate: "2000000000000000000" },
    ]);
    mockFetchTokenChartSnapshots.mockResolvedValue([]);

    // Silence the structured warn log this test deliberately triggers
    // — otherwise it noises up the test output. Restored in `finally`.
    const consoleLogSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    try {
      const app = createApp();
      const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(
        "public, max-age=0, s-maxage=3, stale-while-revalidate=6",
      );
      // The write was attempted (and rejected) — proves the route
      // didn't short-circuit around the cache.
      expect(cachePut).toHaveBeenCalledTimes(1);
      // And the rejection was observed: a structured warn log fired.
      // Sanity-check the level + event so a future log-format
      // refactor doesn't drop the diagnostic silently.
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(
        consoleLogSpy.mock.calls[0]![0] as string,
      ) as { level: string; event: string; error: string };
      expect(payload.level).toBe("warn");
      expect(payload.event).toBe("chart_cache_put_failed");
      expect(payload.error).toBe("cache write failed");
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it("no-ops cleanly when caches.default is unavailable", async () => {
    // Some test envs (and `wrangler dev` without cache emulation) don't
    // expose `globalThis.caches` — the route must still return the
    // 200 response with its Cache-Control header (the directive itself
    // is enough for Cloudflare's zone-level edge cache), just without
    // the local-isolate write.
    delete (globalThis as { caches?: unknown }).caches;

    const nowSec = Math.floor(Date.now() / 1000);
    mockFetchTokenChartContext.mockResolvedValue({
      k: "1000000000000000000000000000000000000000000000",
      ltToken: LT_ADDRESS,
      graduated: false,
      graduatedAt: null,
      timestamp: String(nowSec - 600),
    });
    mockNeonQuery.mockResolvedValue([
      { ts: String(nowSec - 60), exchange_rate: "2000000000000000000" },
    ]);
    mockFetchTokenChartSnapshots.mockResolvedValue([]);

    const app = createApp();
    const res = await app.request(`/chart/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=3, stale-while-revalidate=6",
    );
  });
});

describe("buildPriceTimeline", () => {
  it("returns empty when either input stream is empty", () => {
    expect(buildPriceTimeline([], [{ timestamp: 100, ratio: 1 }], 60)).toEqual(
      [],
    );
    expect(
      buildPriceTimeline(
        [{ ts: "100", exchange_rate: "1000000000000000000" }],
        [],
        60,
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
    const ratioTimeline = [{ timestamp: 110, ratio: 0.5 }];

    const out = buildPriceTimeline(ltRows, ratioTimeline, 60);
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

    const out = buildPriceTimeline(ltRows, ratioTimeline, 60);

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
    const ltRows = [{ ts: "100", exchange_rate: "2000000000000000000" }];
    const ratioTimeline = [
      { timestamp: 100, ratio: 1 },
      { timestamp: 100, ratio: 3 },
    ];

    const out = buildPriceTimeline(ltRows, ratioTimeline, 60);
    // 1 lt + 2 ratio ticks. The last one (ratio=3) is the close.
    expect(out).toHaveLength(3);
    expect(out[out.length - 1]).toEqual({ ts: 100, price: 6 });
  });

  it("skips ratio events before the first LT sample (no rate to multiply)", () => {
    // Launch anchor ratio sits at t=0, but the first LT-rate sample is
    // at t=50 (e.g. token launched before `fromSec` of the BounceTech
    // window). The launch anchor must not produce a price tick at t=0 —
    // there's no exchange rate to multiply against.
    const ltRows = [{ ts: "50", exchange_rate: "1000000000000000000" }];
    const ratioTimeline = [
      { timestamp: 0, ratio: 1 }, // launch anchor — pre-window
      { timestamp: 60, ratio: 2 }, // trade — post-first-sample, at bucket boundary
    ];

    const out = buildPriceTimeline(ltRows, ratioTimeline, 60);
    // - No tick at t=0 (rate was 0, so the launch anchor is skipped).
    // - LT@50 emits at price=1*1=1.
    // - Trade@60 lands exactly on the next bucket boundary; the
    //   bucket-boundary-aware logic emits a synthetic carry-forward
    //   tick at t=60 with the PRE-trade ratio (=1) so the new bucket
    //   has a valid `open` from the pre-trade carry-forward state,
    //   then the real trade tick at t=60 advances to ratio=2.
    expect(out).toEqual([
      { ts: 50, price: 1 },
      { ts: 60, price: 1 },
      { ts: 60, price: 2 },
    ]);
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

    const out = buildPriceTimeline(ltRows, ratioTimeline, 60);
    const timestamps = out.map((p) => p.ts);
    const sorted = [...timestamps].sort((a, b) => a - b);
    expect(timestamps).toEqual(sorted);
  });

  it("injects a synthetic carry-forward tick at the bucket boundary when a trade lands before the first LT sample of its bucket", () => {
    // The core "Option B" regression. The LT sample grid is offset 10s
    // from bucket boundaries (samples at 10, 30, 50, 70, 90, 110 with
    // 60s candles). A trade at t=65 lands in bucket [60, 120) BEFORE
    // the first LT sample of that bucket (at t=70). Pre-fix, every
    // event in the trade bucket carried post-trade ratio (the trade
    // tick at 65, then LT samples at 70/90/110 all using the new ratio)
    // → flat doji at post-trade price. The previous bucket [0, 60)
    // ended at pre-trade price. Result: two flat lines with a vertical
    // gap, no candle body. With the boundary tick, the bucket gets a
    // pre-trade carry-forward tick at t=60 that anchors `open` so the
    // body shows.
    const ltRows = [
      { ts: "10", exchange_rate: "1000000000000000000" },
      { ts: "30", exchange_rate: "1000000000000000000" },
      { ts: "50", exchange_rate: "1000000000000000000" },
      { ts: "70", exchange_rate: "1000000000000000000" },
      { ts: "90", exchange_rate: "1000000000000000000" },
      { ts: "110", exchange_rate: "1000000000000000000" },
    ];
    const ratioTimeline = [
      { timestamp: 0, ratio: 1 }, // launch anchor → pre-trade ratio
      { timestamp: 65, ratio: 2 }, // trade in bucket [60, 120), pre first LT
    ];

    const out = buildPriceTimeline(ltRows, ratioTimeline, 60);

    // The bucket boundary at t=60 must have a synthetic tick at the
    // pre-trade price (carry-forward of ratio=1 × rate=1).
    const boundaryTick = out.find((p) => p.ts === 60);
    expect(boundaryTick).toBeDefined();
    expect(boundaryTick!.price).toBe(1);

    // And the boundary tick must precede the trade tick at t=65.
    const boundaryIdx = out.findIndex((p) => p.ts === 60);
    const tradeIdx = out.findIndex((p) => p.ts === 65);
    expect(boundaryIdx).toBeGreaterThanOrEqual(0);
    expect(tradeIdx).toBeGreaterThan(boundaryIdx);

    // No synthetic tick is emitted for the very first bucket — its open
    // is set organically by the first real event.
    expect(out.find((p) => p.ts === 0)).toBeUndefined();
  });

  it("does NOT emit a synthetic boundary tick when an event lands exactly on the bucket boundary", () => {
    // If the new bucket's first real event is already at `bucket_start`,
    // a synthetic tick at the same timestamp would be redundant. The
    // boundary check `e.ts > bucketTs` suppresses it. Use a ratio
    // anchor strictly before the LT samples so the only events are
    // the two LT samples — one per bucket, both at bucket starts.
    const ltRows = [
      { ts: "0", exchange_rate: "1000000000000000000" },
      { ts: "60", exchange_rate: "1000000000000000000" },
    ];
    const ratioTimeline = [{ timestamp: -10, ratio: 1 }];

    const out = buildPriceTimeline(ltRows, ratioTimeline, 60);
    // Exactly two ticks (the two LT samples). No duplicate at t=60.
    expect(out).toEqual([
      { ts: 0, price: 1 },
      { ts: 60, price: 1 },
    ]);
  });

  it("emits a synthetic boundary tick when a trade lands EXACTLY on a bucket boundary (5s-chart regression)", () => {
    // The "trade-before-first-LT-sample" fix only fired when the event
    // was strictly INSIDE the bucket (`e.ts > bucketTs`). When the
    // trade timestamp happens to coincide with the bucket boundary
    // itself, the trade became the bucket's first event and `open`
    // collapsed to the post-trade price — same visible symptom as the
    // bug Option B was supposed to fix. This is rare on 60s candles
    // (~1.7% of integer-second trades) but hits ~20% of trades on 5s
    // candles, which is why the 5s chart still showed the gap after
    // the first fix.
    //
    // The fix is to also emit the synthetic when the event AT the
    // boundary is a ratio event (a trade). An LT event at the boundary
    // already serves the purpose itself, so it stays suppressed.
    const ltRows = [
      // No LT sample at the bucket boundary t=5 — that's the
      // condition that turns the trade tick into the bucket's first
      // event. Samples at 2 and 7 bracket the boundary.
      { ts: "2", exchange_rate: "1000000000000000000" },
      { ts: "7", exchange_rate: "1000000000000000000" },
    ];
    const ratioTimeline = [
      { timestamp: 0, ratio: 1 }, // launch anchor (pre-trade)
      { timestamp: 5, ratio: 2 }, // trade EXACTLY at 5s bucket boundary
    ];

    const out = buildPriceTimeline(ltRows, ratioTimeline, 5);

    // Expect a synthetic tick at t=5 with the pre-trade price (=1)
    // BEFORE the real trade tick at t=5 (price=2). The synthetic must
    // be first in the array so `buildCandles` picks it as the new
    // bucket's `open`.
    const ticksAtFive = out.filter((p) => p.ts === 5);
    expect(ticksAtFive).toHaveLength(2);
    expect(ticksAtFive[0].price).toBe(1); // synthetic, pre-trade
    expect(ticksAtFive[1].price).toBe(2); // real, post-trade

    // Sanity: the LT samples either side of the boundary use the
    // expected ratio at their time.
    expect(out.find((p) => p.ts === 2)!.price).toBe(1); // pre-trade
    expect(out.find((p) => p.ts === 7)!.price).toBe(2); // post-trade
  });

  it("does NOT duplicate when an LT sample lands exactly on the bucket boundary (no synthetic needed)", () => {
    // The LT event itself serves as the new bucket's first tick — it
    // carries the current ratio against an updated rate, which is the
    // correct "open". Emitting a synthetic at the same timestamp would
    // duplicate it. This regression-pins the suppression branch.
    const ltRows = [
      { ts: "0", exchange_rate: "1000000000000000000" },
      { ts: "5", exchange_rate: "2000000000000000000" },
    ];
    const ratioTimeline = [{ timestamp: -10, ratio: 1 }];

    const out = buildPriceTimeline(ltRows, ratioTimeline, 5);
    // Two ticks total, one per LT sample. No duplicate at t=5.
    expect(out).toEqual([
      { ts: 0, price: 1 },
      { ts: 5, price: 2 },
    ]);
  });

  it("emits boundary ticks for multi-bucket gaps using the most recent state", () => {
    // Two LT samples 3 buckets apart. The boundary check fires for the
    // immediate-next-bucket transition (the only bucket boundary the
    // second event crosses into); the intermediate empty buckets stay
    // empty and render as gaps, which is the existing behaviour for
    // sparse data and not what this fix targets.
    const ltRows = [
      { ts: "0", exchange_rate: "1000000000000000000" },
      { ts: "200", exchange_rate: "2000000000000000000" },
    ];
    const ratioTimeline = [{ timestamp: 0, ratio: 1 }];

    const out = buildPriceTimeline(ltRows, ratioTimeline, 60);

    // The bucket boundary immediately before the second event is at
    // t=180. A synthetic tick there carries forward the pre-update
    // state (ratio=1 × rate=1=1).
    const boundary = out.find((p) => p.ts === 180);
    expect(boundary).toBeDefined();
    expect(boundary!.price).toBe(1);

    // The real LT@200 tick uses the new rate.
    const lt200 = out.find((p) => p.ts === 200);
    expect(lt200!.price).toBe(2);
  });
});
