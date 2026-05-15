import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

// --- Direct-Postgres indexer-reads mock ---
//
// Mocks the three new chart-v2 entry points in `lib/indexer-reads.ts`. This
// is the *whole point* of the v2 route — it must NEVER call into
// `ponder-client.js`. We also stub the legacy GraphQL helpers to a noop
// tracker so the regression-pin test at the bottom can assert the v2 path
// never reaches for the Ponder HTTP hop, mirroring the pattern in
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

const { default: chartV2Route } = await import("../routes/chart-v2.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/chart-v2", chartV2Route);
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

describe("GET /chart-v2/:address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckIndexerHealth.mockResolvedValue(true);
    mockFetchTokenChartContext.mockResolvedValue(null);
    mockFetchTokenChartSnapshots.mockResolvedValue([]);
    mockNeonQuery.mockResolvedValue([]);
  });

  it("returns 400 for invalid address", async () => {
    const app = createApp();
    const res = await app.request("/chart-v2/not-valid", {}, makeEnv());

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toBe("Invalid address");
  });

  it("returns 400 for invalid timeframe", async () => {
    const app = createApp();
    const res = await app.request(
      `/chart-v2/${VALID_ADDRESS}?timeframe=2w`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Invalid timeframe");
  });

  it("returns 400 for unsupported interval values", async () => {
    const app = createApp();
    const res = await app.request(
      `/chart-v2/${VALID_ADDRESS}?interval=42`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Invalid interval");
  });

  it("returns 400 for partial-numeric interval values", async () => {
    const app = createApp();
    const res = await app.request(
      `/chart-v2/${VALID_ADDRESS}?interval=60abc`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Invalid interval");
  });

  it("returns 503 when the indexer health probe fails", async () => {
    mockCheckIndexerHealth.mockResolvedValue(false);

    const app = createApp();
    const res = await app.request(`/chart-v2/${VALID_ADDRESS}`, {}, makeEnv());

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
    const res = await app.request(`/chart-v2/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Indexer unavailable");
  });

  it("returns 404 when neither tokens.ltPair nor indexer ltToken is available", async () => {
    // `tokens.ltPair` lookup returns `[]` (default mock); chart context
    // returns `null` (default in beforeEach). Both sources empty → 404.
    const app = createApp();
    const res = await app.request(`/chart-v2/${VALID_ADDRESS}`, {}, makeEnv());

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
    mockNeonQuery.mockResolvedValue([]);
    mockFetchTokenChartSnapshots.mockResolvedValue([]);

    const app = createApp();
    const res = await app.request(`/chart-v2/${VALID_ADDRESS}`, {}, makeEnv());

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
    // separately below). Mirrors the legacy chart route's anchor-failed
    // branch where a Ponder hiccup between the health probe and the
    // pagination call would 503 rather than silently fall back to no
    // baseline — see the `Trade history too large` test in `chart.test.ts`.
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
    const res = await app.request(`/chart-v2/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Indexer unavailable");
  });

  it("returns candles with correct shape on the happy path", async () => {
    const nowSec = Math.floor(Date.now() / 1000);

    mockFetchTokenChartContext.mockResolvedValue({
      // k = TOTAL_SUPPLY × virtualLtAtLaunch, with TOTAL_SUPPLY = 1B × 1e18
      // and a virtualLtAtLaunch of 1e18 → k = 1e45. Same shape used in the
      // legacy chart.test.ts so the response is directly diffable.
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
    const res = await app.request(`/chart-v2/${VALID_ADDRESS}`, {}, makeEnv());

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

  it("plumbs fromSec into fetchTokenChartSnapshots so the indexer scan is bounded", async () => {
    // Regression: the legacy route paginated `tokenSnapshots(timestamp_gte: $fromSec)`;
    // any switch to the v2 helper must also bound the scan via `fromSec`,
    // otherwise a mature token's full lifetime of snapshots (potentially
    // tens of thousands of rows) gets read on every request. The
    // direct-SQL helper takes `fromSec` as its third positional argument —
    // assert it's threaded through with the same `MAX_HISTORY_CANDLES ×
    // candleSec` window the legacy code used.
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
    const res = await app.request(`/chart-v2/${VALID_ADDRESS}`, {}, makeEnv());

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

  it("never falls back to the legacy Ponder GraphQL hop", async () => {
    // The whole point of the v2 route is that it serves chart traffic
    // from `ponder_views.*` directly — no GraphQL. Pin that contract
    // so a future refactor can't silently reintroduce the legacy hop
    // (same regression-pin pattern as `health.test.ts`). We assert the
    // negative side after a real successful request so a copy-paste
    // refactor wouldn't accidentally pass by short-circuiting before
    // any work happens.
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
    const res = await app.request(`/chart-v2/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    expect(mockPonderQuery).not.toHaveBeenCalled();
    expect(mockPonderPaginatedQuery).not.toHaveBeenCalled();
    expect(mockCheckPonderHealth).not.toHaveBeenCalled();
    expect(mockCheckIndexerHealth).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when BOUNCETECH_DATABASE_URL is missing", async () => {
    // Mirror the legacy route's misconfigured-binding branch — without
    // this the route would tear down the worker on a NeonHttpFailure
    // instead of surfacing a clean 500. Same generic client-facing
    // message as the legacy route (the binding name only goes to the
    // server-side log, not the response).
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
    const res = await app.request(`/chart-v2/${VALID_ADDRESS}`, {}, env);

    expect(res.status).toBe(500);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toBe("Internal server error");
  });
});
