import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

// `buildDaySeries` calls `new Date()` to build the day index, so the
// route's day window is rooted on `Date.now()`. Freeze the clock so the
// hardcoded May-2026 timestamps in the per-test fixtures keep landing
// inside the `days=…` window indefinitely — without this the suite
// starts silently producing empty series once the fixtures fall out of
// scope. CodeRabbit feedback on PR #991.
const FROZEN_NOW = new Date("2026-05-16T12:00:00Z");

const mockFetchFeeAccrualsSince = vi.fn();
const mockFetchRouterTradesForAnalytics = vi.fn();
const mockFetchGraduationsSince = vi.fn();
const mockFetchTokensLaunchedSince = vi.fn();
const mockFetchHistoricalCurveSnapshots = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchFeeAccrualsSince: mockFetchFeeAccrualsSince,
  fetchRouterTradesForAnalytics: mockFetchRouterTradesForAnalytics,
  fetchGraduationsSince: mockFetchGraduationsSince,
  fetchTokensLaunchedSince: mockFetchTokensLaunchedSince,
  // Re-exported by some sibling routes via this module; tests only touch
  // the analytics v2 surface so the rest are stubbed to no-op.
  fetchHistoricalCurveSnapshots: mockFetchHistoricalCurveSnapshots,
}));

vi.mock("../db/client.js", () => ({
  createDb: () => ({}),
}));

const { default: analytics } = await import("../routes/admin/analytics.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/admin/analytics", analytics);
  return app;
}

function makeEnv(): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

describe("GET /admin/analytics/revenue-v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("returns 503 when the helper signals indexer unavailability", async () => {
    mockFetchFeeAccrualsSince.mockResolvedValue(null);
    const res = await createApp().request("/admin/analytics/revenue-v2", {}, makeEnv());
    expect(res.status).toBe(503);
  });

  it("buckets accruals by UTC day and returns truncated:false (direct DB has no paginator cap)", async () => {
    // Two same-day accruals (different timestamps within the same UTC
    // calendar day) plus one prior-day to verify the bucketing math.
    const utcDay = (iso: string): number =>
      Math.floor(new Date(iso).getTime() / 1000);
    mockFetchFeeAccrualsSince.mockResolvedValue([
      { creatorAmount: "1000000", protocolAmount: "2000000", timestamp: String(utcDay("2026-05-15T10:00:00Z")) },
      { creatorAmount: "500000", protocolAmount: "0", timestamp: String(utcDay("2026-05-15T11:00:00Z")) },
      { creatorAmount: "0", protocolAmount: "3000000", timestamp: String(utcDay("2026-05-14T10:00:00Z")) },
    ]);

    const res = await createApp().request(
      "/admin/analytics/revenue-v2?days=7",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { protocol: { date: string; value: number }[]; creator: { date: string; value: number }[]; truncated: boolean };
    };
    expect(body.data.truncated).toBe(false);
    expect(body.data.protocol).toHaveLength(7);
    expect(body.data.creator).toHaveLength(7);

    // Sum the protocol values across the series, then compare against
    // the raw input sum. `usdcRawToUsd` collapses 6dp raw → dollars.
    const protocolSum = body.data.protocol.reduce((acc, p) => acc + p.value, 0);
    expect(protocolSum).toBeCloseTo((2 + 3) /* 2 + 0 + 3 USDC */, 6);
    const creatorSum = body.data.creator.reduce((acc, p) => acc + p.value, 0);
    expect(creatorSum).toBeCloseTo((1 + 0.5), 6);
  });
});

describe("GET /admin/analytics/dau-v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("returns 503 when the helper returns null", async () => {
    mockFetchRouterTradesForAnalytics.mockResolvedValue(null);
    const res = await createApp().request("/admin/analytics/dau-v2", {}, makeEnv());
    expect(res.status).toBe(503);
  });

  it("counts distinct traders per UTC day", async () => {
    const utcDay = (iso: string): number =>
      Math.floor(new Date(iso).getTime() / 1000);
    mockFetchRouterTradesForAnalytics.mockResolvedValue([
      { trader: "0xAAA", usdcAmount: "1", timestamp: String(utcDay("2026-05-15T01:00:00Z")) },
      { trader: "0xAAA", usdcAmount: "1", timestamp: String(utcDay("2026-05-15T05:00:00Z")) },
      { trader: "0xBBB", usdcAmount: "1", timestamp: String(utcDay("2026-05-15T07:00:00Z")) },
      { trader: "0xAAA", usdcAmount: "1", timestamp: String(utcDay("2026-05-14T07:00:00Z")) },
    ]);

    const res = await createApp().request(
      "/admin/analytics/dau-v2?days=3",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { series: { date: string; value: number }[]; truncated: boolean };
    };
    expect(body.data.truncated).toBe(false);
    // Two days of data plus one zeroed pad day → 3-entry series.
    expect(body.data.series).toHaveLength(3);
    const dayValues = new Map(body.data.series.map((p) => [p.date, p.value]));
    expect(dayValues.get("2026-05-15")).toBe(2);
    expect(dayValues.get("2026-05-14")).toBe(1);
  });
});

describe("GET /admin/analytics/volume-v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("returns 503 when the helper returns null", async () => {
    mockFetchRouterTradesForAnalytics.mockResolvedValue(null);
    const res = await createApp().request("/admin/analytics/volume-v2", {}, makeEnv());
    expect(res.status).toBe(503);
  });

  it("sums USDC per day", async () => {
    const utcDay = (iso: string): number =>
      Math.floor(new Date(iso).getTime() / 1000);
    mockFetchRouterTradesForAnalytics.mockResolvedValue([
      { trader: "0xa", usdcAmount: "1500000", timestamp: String(utcDay("2026-05-15T01:00:00Z")) },
      { trader: "0xa", usdcAmount: "2500000", timestamp: String(utcDay("2026-05-15T02:00:00Z")) },
    ]);

    const res = await createApp().request(
      "/admin/analytics/volume-v2?days=2",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { series: { date: string; value: number }[] };
    };
    const value = body.data.series.find((p) => p.date === "2026-05-15")?.value;
    expect(value).toBe(4); // 1.5 + 2.5 USDC
  });
});

describe("GET /admin/analytics/graduations-v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("503 when either parallel helper signals indexer unavailability", async () => {
    mockFetchGraduationsSince.mockResolvedValue([]);
    mockFetchTokensLaunchedSince.mockResolvedValue(null);
    const res = await createApp().request("/admin/analytics/graduations-v2", {}, makeEnv());
    expect(res.status).toBe(503);
  });

  it("computes time-to-graduation as the gap between matching launch and graduation timestamps", async () => {
    const utcDay = (iso: string): number =>
      Math.floor(new Date(iso).getTime() / 1000);
    const launchTs = utcDay("2026-05-14T10:00:00Z");
    const gradTs = launchTs + 3600 * 4; // graduated 4h after launch
    mockFetchGraduationsSince.mockResolvedValue([
      { tokenAddress: "0xabc", timestamp: String(gradTs) },
    ]);
    mockFetchTokensLaunchedSince.mockResolvedValue([
      { address: "0xabc", timestamp: String(launchTs) },
      { address: "0xdef", timestamp: String(launchTs) }, // launched, not graduated
    ]);

    const res = await createApp().request(
      "/admin/analytics/graduations-v2?days=7",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        totalLaunches: number;
        totalGraduations: number;
        graduationRate: number;
        avgTimeToGraduationSeconds: number | null;
        truncated: boolean;
      };
    };
    expect(body.data.totalLaunches).toBe(2);
    expect(body.data.totalGraduations).toBe(1);
    expect(body.data.graduationRate).toBeCloseTo(0.5, 6);
    expect(body.data.avgTimeToGraduationSeconds).toBe(3600 * 4);
    expect(body.data.truncated).toBe(false);
  });
});

// Issue #942: the v1 GraphQL-backed handlers were retired. The canonical
// `/dau`, `/volume`, `/graduations`, `/revenue` paths now resolve to the
// DB-backed handler so external callers on the legacy path see the same
// response shape (with `truncated: false` since the direct DB read has
// no paginator cap). Pin every canonical path so a refactor that drops
// the alias lights up here.
describe("Canonical analytics paths (DB-backed, served at the legacy URLs)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("dau: counts distinct traders per day on /dau", async () => {
    const utcDay = (iso: string): number =>
      Math.floor(new Date(iso).getTime() / 1000);
    mockFetchRouterTradesForAnalytics.mockResolvedValue([
      { trader: "0xAAA", usdcAmount: "1", timestamp: String(utcDay("2026-05-15T01:00:00Z")) },
      { trader: "0xBBB", usdcAmount: "1", timestamp: String(utcDay("2026-05-15T07:00:00Z")) },
    ]);
    const res = await createApp().request("/admin/analytics/dau?days=2", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { series: { date: string; value: number }[]; truncated: boolean } };
    expect(body.data.truncated).toBe(false);
    expect(body.data.series.find((p) => p.date === "2026-05-15")?.value).toBe(2);
  });

  it("volume: sums USDC per day on /volume", async () => {
    const utcDay = (iso: string): number =>
      Math.floor(new Date(iso).getTime() / 1000);
    mockFetchRouterTradesForAnalytics.mockResolvedValue([
      { trader: "0xa", usdcAmount: "1500000", timestamp: String(utcDay("2026-05-15T01:00:00Z")) },
      { trader: "0xa", usdcAmount: "2500000", timestamp: String(utcDay("2026-05-15T02:00:00Z")) },
    ]);
    const res = await createApp().request("/admin/analytics/volume?days=2", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { series: { date: string; value: number }[] } };
    expect(body.data.series.find((p) => p.date === "2026-05-15")?.value).toBe(4);
  });

  it("graduations: returns gap-based time-to-graduation on /graduations", async () => {
    const utcDay = (iso: string): number =>
      Math.floor(new Date(iso).getTime() / 1000);
    const launchTs = utcDay("2026-05-14T10:00:00Z");
    const gradTs = launchTs + 3600 * 4;
    mockFetchGraduationsSince.mockResolvedValue([
      { tokenAddress: "0xabc", timestamp: String(gradTs) },
    ]);
    mockFetchTokensLaunchedSince.mockResolvedValue([
      { address: "0xabc", timestamp: String(launchTs) },
    ]);
    const res = await createApp().request("/admin/analytics/graduations?days=7", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { totalGraduations: number; avgTimeToGraduationSeconds: number | null; truncated: boolean };
    };
    expect(body.data.totalGraduations).toBe(1);
    expect(body.data.avgTimeToGraduationSeconds).toBe(3600 * 4);
    expect(body.data.truncated).toBe(false);
  });

  it("revenue: returns daily accrual buckets on /revenue", async () => {
    const utcDay = (iso: string): number =>
      Math.floor(new Date(iso).getTime() / 1000);
    mockFetchFeeAccrualsSince.mockResolvedValue([
      { creatorAmount: "1000000", protocolAmount: "2000000", timestamp: String(utcDay("2026-05-15T10:00:00Z")) },
    ]);
    const res = await createApp().request("/admin/analytics/revenue?days=2", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        protocol: { date: string; value: number }[];
        creator: { date: string; value: number }[];
        truncated: boolean;
      };
    };
    expect(body.data.truncated).toBe(false);
    expect(body.data.protocol.find((p) => p.date === "2026-05-15")?.value).toBeCloseTo(2, 6);
    expect(body.data.creator.find((p) => p.date === "2026-05-15")?.value).toBeCloseTo(1, 6);
  });
});
