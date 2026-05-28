import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

/**
 * Unit tests for the `/admin/analytics/*` routes. Every analytics helper is
 * stubbed via `vi.mock` so the suite stays hermetic — no Neon, no Drizzle,
 * no fixture DB. Companion integration tests in `analytics.integration.test.ts`
 * exercise the real SQL against prod Neon when `DATABASE_URL` is set.
 */

const mockFetchPlatformAggregates = vi.fn();
const mockFetchWindowedVolume = vi.fn();
const mockFetchWindowedFees = vi.fn();
const mockFetchUniqueTraderCount = vi.fn();
const mockFetchGraduationFunnelStats = vi.fn();
const mockFetchVolumeBuckets = vi.fn();
const mockFetchRevenueBuckets = vi.fn();
const mockFetchNetInflowBuckets = vi.fn();
const mockFetchNetInflowBaseline = vi.fn();
const mockFetchActiveUserBuckets = vi.fn();
const mockFetchBreakdown = vi.fn();
const mockFetchGraduationBuckets = vi.fn();
const mockFetchTopTokens = vi.fn();

vi.mock("../lib/analytics-reads.js", () => ({
  fetchPlatformAggregates: (...args: unknown[]) =>
    mockFetchPlatformAggregates(...args),
  fetchWindowedVolume: (...args: unknown[]) =>
    mockFetchWindowedVolume(...args),
  fetchWindowedFees: (...args: unknown[]) => mockFetchWindowedFees(...args),
  fetchUniqueTraderCount: (...args: unknown[]) =>
    mockFetchUniqueTraderCount(...args),
  fetchGraduationFunnelStats: (...args: unknown[]) =>
    mockFetchGraduationFunnelStats(...args),
  fetchVolumeBuckets: (...args: unknown[]) => mockFetchVolumeBuckets(...args),
  fetchRevenueBuckets: (...args: unknown[]) =>
    mockFetchRevenueBuckets(...args),
  fetchNetInflowBuckets: (...args: unknown[]) =>
    mockFetchNetInflowBuckets(...args),
  fetchNetInflowBaseline: (...args: unknown[]) =>
    mockFetchNetInflowBaseline(...args),
  fetchActiveUserBuckets: (...args: unknown[]) =>
    mockFetchActiveUserBuckets(...args),
  fetchBreakdown: (...args: unknown[]) => mockFetchBreakdown(...args),
  fetchGraduationBuckets: (...args: unknown[]) =>
    mockFetchGraduationBuckets(...args),
  fetchTopTokens: (...args: unknown[]) => mockFetchTopTokens(...args),
  quantizeWindowCutoff: (nowSec: number, windowSec: number) => {
    const raw = nowSec - windowSec;
    return Math.floor(raw / 30) * 30;
  },
}));

vi.mock("../db/client.js", () => ({
  createDb: () => ({}),
}));

const { default: analyticsRoute } = await import("../routes/admin/analytics.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/admin/analytics", analyticsRoute);
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

function clearAllMocks() {
  vi.clearAllMocks();
}

// ---------------------------------------------------------------------------
// /admin/analytics/overview
// ---------------------------------------------------------------------------

describe("GET /admin/analytics/overview", () => {
  beforeEach(clearAllMocks);

  it("composes lifetime + windowed aggregates + graduation funnel", async () => {
    mockFetchPlatformAggregates.mockResolvedValue({
      lifetimeProtocolFeesUsdcRaw: "1000000",
      lifetimeCreatorFeesUsdcRaw: "500000",
      totalValueLockedUsdcRaw: "12345000000",
      lifetimeGrossVolumeUsdcRaw: "999000000",
      cumulativeNetInflowUsdcRaw: "11111000000",
      uniqueTradersAllTime: 421,
      uniqueCreatorsAllTime: 37,
    });
    mockFetchWindowedVolume.mockResolvedValue({
      grossVolumeUsdcRaw: "100000000",
      netInflowUsdcRaw: "60000000",
      tradeCount: 12,
    });
    mockFetchWindowedFees.mockResolvedValue({
      protocolFeesUsdcRaw: "500000",
      creatorFeesUsdcRaw: "250000",
      feeEvents: 12,
    });
    mockFetchUniqueTraderCount.mockResolvedValue({
      uniqueTraders: 9,
      qualifiedTraders: 3,
    });
    mockFetchGraduationFunnelStats.mockResolvedValue({
      totalLaunched: 100,
      totalGraduated: 12,
      totalPendingGraduation: 2,
      graduationRatePct: 12,
      medianTimeToGraduateSec: 86400,
      meanTimeToGraduateSec: 90000,
    });

    const app = createApp();
    const res = await app.request("/admin/analytics/overview", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dataSource: string;
      data: {
        lifetime: {
          totalValueLockedUsd: number;
          lifetimeProtocolFeesUsd: number;
          uniqueTradersAllTime: number;
        };
        graduation: { totalLaunched: number; graduationRatePct: number };
        windows: {
          last24h: { grossVolumeUsd: number; uniqueTraders: number };
          last7d: { grossVolumeUsd: number; uniqueTraders: number };
          last30d: { grossVolumeUsd: number; uniqueTraders: number };
        };
        qualifiedTraderThresholdUsd: number;
      };
    };
    expect(body.dataSource).toBe("live");
    expect(body.data.lifetime.totalValueLockedUsd).toBeCloseTo(12345, 4);
    expect(body.data.lifetime.lifetimeProtocolFeesUsd).toBeCloseTo(1, 4);
    expect(body.data.lifetime.uniqueTradersAllTime).toBe(421);
    expect(body.data.graduation.totalLaunched).toBe(100);
    expect(body.data.graduation.graduationRatePct).toBe(12);
    expect(body.data.windows.last24h.grossVolumeUsd).toBeCloseTo(100, 4);
    expect(body.data.windows.last7d.uniqueTraders).toBe(9);
    expect(body.data.qualifiedTraderThresholdUsd).toBe(500);
  });

  it("returns degraded when any sub-query fails", async () => {
    mockFetchPlatformAggregates.mockResolvedValue(null);
    mockFetchWindowedVolume.mockResolvedValue({
      grossVolumeUsdcRaw: "0",
      netInflowUsdcRaw: "0",
      tradeCount: 0,
    });
    mockFetchWindowedFees.mockResolvedValue({
      protocolFeesUsdcRaw: "0",
      creatorFeesUsdcRaw: "0",
      feeEvents: 0,
    });
    mockFetchUniqueTraderCount.mockResolvedValue({
      uniqueTraders: 0,
      qualifiedTraders: 0,
    });
    mockFetchGraduationFunnelStats.mockResolvedValue({
      totalLaunched: 0,
      totalGraduated: 0,
      totalPendingGraduation: 0,
      graduationRatePct: 0,
      medianTimeToGraduateSec: null,
      meanTimeToGraduateSec: null,
    });
    const app = createApp();
    const res = await app.request("/admin/analytics/overview", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dataSource: string };
    expect(body.dataSource).toBe("degraded");
  });
});

// ---------------------------------------------------------------------------
// /admin/analytics/volume
// ---------------------------------------------------------------------------

describe("GET /admin/analytics/volume", () => {
  beforeEach(clearAllMocks);

  it("rejects an unsupported interval", async () => {
    const app = createApp();
    const res = await app.request(
      "/admin/analytics/volume?interval=second",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("returns a dense series with zero-filled missing buckets", async () => {
    // Anchor 'now' so the test is deterministic against bucket math.
    const nowSec = 1_800_000_000;
    vi.spyOn(Date, "now").mockReturnValue(nowSec * 1000);
    const dayStart = Math.floor(nowSec / 86400) * 86400;

    mockFetchVolumeBuckets.mockResolvedValue([
      { bucket: dayStart, volumeUsdcRaw: "1000000" },
      { bucket: dayStart - 2 * 86400, volumeUsdcRaw: "3000000" },
    ]);
    mockFetchWindowedVolume.mockResolvedValue({
      grossVolumeUsdcRaw: "5000000",
      netInflowUsdcRaw: "2000000",
      tradeCount: 5,
    });

    const app = createApp();
    const res = await app.request(
      "/admin/analytics/volume?interval=day&lookback=3",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        interval: string;
        lookback: number;
        series: Array<{ t: number; volumeUsdcRaw: string; volumeUsd: number }>;
        windows: { last24h: { grossVolumeUsd: number } };
      };
    };
    expect(body.data.interval).toBe("day");
    expect(body.data.lookback).toBe(3);
    expect(body.data.series).toHaveLength(3);
    // Oldest → newest: dayStart-2d, dayStart-1d (filled), dayStart.
    expect(body.data.series[0]).toEqual({
      t: dayStart - 2 * 86400,
      volumeUsdcRaw: "3000000",
      volumeUsd: 3,
    });
    expect(body.data.series[1]).toEqual({
      t: dayStart - 86400,
      volumeUsdcRaw: "0",
      volumeUsd: 0,
    });
    expect(body.data.series[2]).toEqual({
      t: dayStart,
      volumeUsdcRaw: "1000000",
      volumeUsd: 1,
    });
    expect(body.data.windows.last24h.grossVolumeUsd).toBeCloseTo(5, 4);
  });

  it("caps lookback to MAX_LOOKBACK to bound the query", async () => {
    mockFetchVolumeBuckets.mockResolvedValue([]);
    mockFetchWindowedVolume.mockResolvedValue({
      grossVolumeUsdcRaw: "0",
      netInflowUsdcRaw: "0",
      tradeCount: 0,
    });
    const app = createApp();
    const res = await app.request(
      "/admin/analytics/volume?interval=day&lookback=10000",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { lookback: number } };
    expect(body.data.lookback).toBe(365);
  });

  it("503s when the bucket query fails", async () => {
    mockFetchVolumeBuckets.mockResolvedValue(null);
    mockFetchWindowedVolume.mockResolvedValue({
      grossVolumeUsdcRaw: "0",
      netInflowUsdcRaw: "0",
      tradeCount: 0,
    });
    const app = createApp();
    const res = await app.request("/admin/analytics/volume", {}, makeEnv());
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// /admin/analytics/revenue
// ---------------------------------------------------------------------------

describe("GET /admin/analytics/revenue", () => {
  beforeEach(clearAllMocks);

  it("emits protocol + creator fees per bucket and snapshot windows", async () => {
    const nowSec = 1_800_000_000;
    vi.spyOn(Date, "now").mockReturnValue(nowSec * 1000);
    const dayStart = Math.floor(nowSec / 86400) * 86400;

    mockFetchRevenueBuckets.mockResolvedValue([
      {
        bucket: dayStart,
        protocolFeesUsdcRaw: "750000",
        creatorFeesUsdcRaw: "250000",
        feeEvents: 4,
      },
    ]);
    mockFetchWindowedFees.mockResolvedValue({
      protocolFeesUsdcRaw: "1500000",
      creatorFeesUsdcRaw: "500000",
      feeEvents: 8,
    });

    const app = createApp();
    const res = await app.request(
      "/admin/analytics/revenue?interval=day&lookback=2",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        series: Array<{
          t: number;
          protocolFeesUsdcRaw: string;
          protocolFeesUsd: number;
          creatorFeesUsdcRaw: string;
          creatorFeesUsd: number;
        }>;
        windows: {
          last24h: { protocolFeesUsd: number };
          last7d: { protocolFeesUsd: number };
          last30d: { protocolFeesUsd: number };
          allTime: { protocolFeesUsd: number };
        };
      };
    };
    expect(body.data.series).toHaveLength(2);
    // Yesterday is the zero-filled bucket; today carries data.
    expect(body.data.series[0].protocolFeesUsd).toBe(0);
    expect(body.data.series[1].protocolFeesUsd).toBeCloseTo(0.75, 4);
    expect(body.data.series[1].creatorFeesUsd).toBeCloseTo(0.25, 4);
    expect(body.data.windows.last24h.protocolFeesUsd).toBeCloseTo(1.5, 4);
  });
});

// ---------------------------------------------------------------------------
// /admin/analytics/value-locked
// ---------------------------------------------------------------------------

describe("GET /admin/analytics/value-locked", () => {
  beforeEach(clearAllMocks);

  it("composes baseline + running cumulative across the window", async () => {
    const nowSec = 1_800_000_000;
    vi.spyOn(Date, "now").mockReturnValue(nowSec * 1000);
    const dayStart = Math.floor(nowSec / 86400) * 86400;

    mockFetchNetInflowBaseline.mockResolvedValue("10000000"); // $10
    mockFetchNetInflowBuckets.mockResolvedValue([
      {
        bucket: dayStart - 86400,
        netInflowUsdcRaw: "5000000",
        grossVolumeUsdcRaw: "8000000",
      },
      {
        bucket: dayStart,
        netInflowUsdcRaw: "-2000000",
        grossVolumeUsdcRaw: "7000000",
      },
    ]);
    mockFetchPlatformAggregates.mockResolvedValue({
      lifetimeProtocolFeesUsdcRaw: "0",
      lifetimeCreatorFeesUsdcRaw: "0",
      totalValueLockedUsdcRaw: "13000000",
      lifetimeGrossVolumeUsdcRaw: "0",
      cumulativeNetInflowUsdcRaw: "13000000",
      uniqueTradersAllTime: 0,
      uniqueCreatorsAllTime: 0,
    });

    const app = createApp();
    const res = await app.request(
      "/admin/analytics/value-locked?interval=day&lookback=2",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        baselineUsdcRaw: string;
        series: Array<{
          t: number;
          netInflowUsdcRaw: string;
          cumulativeNetInflowUsd: number;
        }>;
        snapshot: { totalValueLockedUsd: number };
      };
    };
    expect(body.data.baselineUsdcRaw).toBe("10000000");
    // Cumulative running:
    //   baseline ($10) + day-1 delta (+$5) = $15
    //   $15 + today delta (-$2) = $13
    expect(body.data.series[0].cumulativeNetInflowUsd).toBeCloseTo(15, 4);
    expect(body.data.series[1].cumulativeNetInflowUsd).toBeCloseTo(13, 4);
    expect(body.data.snapshot.totalValueLockedUsd).toBeCloseTo(13, 4);
  });

  it("503s when the baseline read fails", async () => {
    mockFetchNetInflowBuckets.mockResolvedValue([]);
    mockFetchNetInflowBaseline.mockResolvedValue(null);
    mockFetchPlatformAggregates.mockResolvedValue(null);
    const app = createApp();
    const res = await app.request(
      "/admin/analytics/value-locked",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// /admin/analytics/active-users
// ---------------------------------------------------------------------------

describe("GET /admin/analytics/active-users", () => {
  beforeEach(clearAllMocks);

  it("threads `$500` default threshold into the helper as 6dp USDC", async () => {
    mockFetchActiveUserBuckets.mockResolvedValue([]);
    mockFetchUniqueTraderCount.mockResolvedValue({
      uniqueTraders: 0,
      qualifiedTraders: 0,
    });
    const app = createApp();
    await app.request("/admin/analytics/active-users", {}, makeEnv());
    const call = mockFetchActiveUserBuckets.mock.calls[0] as [
      unknown,
      { thresholdUsdcRaw: string },
    ];
    expect(call[1].thresholdUsdcRaw).toBe("500000000");
  });

  it("accepts a custom `threshold` override", async () => {
    mockFetchActiveUserBuckets.mockResolvedValue([]);
    mockFetchUniqueTraderCount.mockResolvedValue({
      uniqueTraders: 0,
      qualifiedTraders: 0,
    });
    const app = createApp();
    await app.request(
      "/admin/analytics/active-users?threshold=100",
      {},
      makeEnv(),
    );
    const call = mockFetchActiveUserBuckets.mock.calls[0] as [
      unknown,
      { thresholdUsdcRaw: string },
    ];
    expect(call[1].thresholdUsdcRaw).toBe("100000000");
  });

  it("returns unique + qualified counts per bucket", async () => {
    const nowSec = 1_800_000_000;
    vi.spyOn(Date, "now").mockReturnValue(nowSec * 1000);
    const dayStart = Math.floor(nowSec / 86400) * 86400;

    mockFetchActiveUserBuckets.mockResolvedValue([
      {
        bucket: dayStart,
        uniqueTraders: 50,
        qualifiedTraders: 12,
        bucketVolumeUsdcRaw: "75000000",
      },
    ]);
    mockFetchUniqueTraderCount.mockResolvedValue({
      uniqueTraders: 50,
      qualifiedTraders: 12,
    });
    const app = createApp();
    const res = await app.request(
      "/admin/analytics/active-users?interval=day&lookback=1",
      {},
      makeEnv(),
    );
    const body = (await res.json()) as {
      data: {
        thresholdUsd: number;
        series: Array<{
          t: number;
          uniqueTraders: number;
          qualifiedTraders: number;
          bucketVolumeUsd: number;
        }>;
      };
    };
    expect(body.data.thresholdUsd).toBe(500);
    expect(body.data.series[0]).toMatchObject({
      uniqueTraders: 50,
      qualifiedTraders: 12,
      bucketVolumeUsd: 75,
    });
  });
});

// ---------------------------------------------------------------------------
// /admin/analytics/breakdown
// ---------------------------------------------------------------------------

describe("GET /admin/analytics/breakdown", () => {
  beforeEach(clearAllMocks);

  it("rejects unknown `by` values", async () => {
    const app = createApp();
    const res = await app.request(
      "/admin/analytics/breakdown?by=garbage",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("decorates rows with USD floats", async () => {
    mockFetchBreakdown.mockResolvedValue([
      {
        key: "2",
        tokenCount: 5,
        graduatedCount: 1,
        lifetimeVolumeUsdcRaw: "12000000",
        protocolFeesUsdcRaw: "90000",
        creatorFeesUsdcRaw: "30000",
        totalRaisedUsdcRaw: "8000000",
      },
    ]);
    const app = createApp();
    const res = await app.request(
      "/admin/analytics/breakdown?by=leverage",
      {},
      makeEnv(),
    );
    const body = (await res.json()) as {
      data: {
        dimension: string;
        rows: Array<{
          key: string;
          lifetimeVolumeUsd: number;
          protocolFeesUsd: number;
          totalRaisedUsd: number;
        }>;
      };
    };
    expect(body.data.dimension).toBe("leverage");
    expect(body.data.rows[0]).toMatchObject({
      key: "2",
      lifetimeVolumeUsd: 12,
      protocolFeesUsd: 0.09,
      totalRaisedUsd: 8,
    });
  });
});

// ---------------------------------------------------------------------------
// /admin/analytics/revenue-forecast
// ---------------------------------------------------------------------------

describe("GET /admin/analytics/revenue-forecast", () => {
  beforeEach(clearAllMocks);

  it("computes flat windows + EWMAs over the daily protocol-fee series", async () => {
    const nowSec = 1_800_000_000;
    vi.spyOn(Date, "now").mockReturnValue(nowSec * 1000);
    const todayBucketStart = Math.floor(nowSec / 86400) * 86400;
    // Construct a synthetic series: 90 days of $10/day fees, then a spike of $100 today.
    // - flat last1d: $100/day → annualised $36,500
    // - flat last3d: ($100+$10+$10)/3 = $40/day → annualised $14,600
    // - flat last7d: ($100 + 6×$10)/7 ≈ $22.86/day → annualised ~$8,343
    // - ewma should weight today's $100 spike heavily.
    const dailyBuckets: Array<{
      bucket: number;
      protocolFeesUsdcRaw: string;
      creatorFeesUsdcRaw: string;
      feeEvents: number;
    }> = [];
    const SPIKE_USDC_RAW = String(100 * 1_000_000);
    const FLAT_USDC_RAW = String(10 * 1_000_000);
    for (let i = 89; i >= 0; i--) {
      const t = todayBucketStart - i * 86400;
      dailyBuckets.push({
        bucket: t,
        protocolFeesUsdcRaw: i === 0 ? SPIKE_USDC_RAW : FLAT_USDC_RAW,
        creatorFeesUsdcRaw: "0",
        feeEvents: 1,
      });
    }
    mockFetchRevenueBuckets.mockResolvedValue(dailyBuckets);

    const app = createApp();
    const res = await app.request(
      "/admin/analytics/revenue-forecast",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        flat: Record<
          string,
          { dailyAverageUsd: number; annualisedUsd: number; windowDays: number }
        >;
        ewma: Record<
          string,
          { dailyAverageUsd: number; annualisedUsd: number; windowDays: number }
        >;
        lifetimeAverage: {
          dailyAverageUsd: number;
          annualisedUsd: number;
          windowDays: number;
        };
        series: Array<{ t: number; protocolFeesUsd: number }>;
      };
    };
    expect(body.data.flat.last1d.dailyAverageUsd).toBeCloseTo(100, 4);
    expect(body.data.flat.last1d.annualisedUsd).toBeCloseTo(36_500, 0);
    expect(body.data.flat.last3d.dailyAverageUsd).toBeCloseTo(40, 4);
    expect(body.data.flat.last7d.dailyAverageUsd).toBeCloseTo((100 + 60) / 7, 3);
    // EWMA should be between the flat last1d and the long-term average.
    expect(body.data.ewma.halfLife7d.dailyAverageUsd).toBeGreaterThan(10);
    expect(body.data.ewma.halfLife7d.dailyAverageUsd).toBeLessThan(100);
    // Series should have 120 entries (HISTORY_DAYS).
    expect(body.data.series).toHaveLength(120);
    // Lifetime average uses "days since first non-zero fee". The fixture
    // populates only the most recent 90 days; the older 30 buckets in
    // the series are zero-filled. So firstNonZeroIdx = 30, window = 90.
    // Total = 89 × $10 + $100 = $990. Daily avg = 990/90 = $11.
    expect(body.data.lifetimeAverage.windowDays).toBe(90);
    expect(body.data.lifetimeAverage.dailyAverageUsd).toBeCloseTo(990 / 90, 4);
  });

  it("counts only days since the first non-zero fee in lifetimeAverage", async () => {
    const nowSec = 1_800_000_000;
    vi.spyOn(Date, "now").mockReturnValue(nowSec * 1000);
    const todayBucketStart = Math.floor(nowSec / 86_400) * 86_400;
    // 30 days of activity at $10/day; the prior 90 days are silent
    // (pre-launch). `dailyMap` is sparse — the series builder
    // zero-fills the gaps. Expected window = 30 days, NOT 120.
    const buckets: Array<{
      bucket: number;
      protocolFeesUsdcRaw: string;
      creatorFeesUsdcRaw: string;
      feeEvents: number;
    }> = [];
    for (let i = 29; i >= 0; i--) {
      buckets.push({
        bucket: todayBucketStart - i * 86_400,
        protocolFeesUsdcRaw: String(10 * 1_000_000),
        creatorFeesUsdcRaw: "0",
        feeEvents: 1,
      });
    }
    mockFetchRevenueBuckets.mockResolvedValue(buckets);

    const app = createApp();
    const res = await app.request(
      "/admin/analytics/revenue-forecast",
      {},
      makeEnv(),
    );
    const body = (await res.json()) as {
      data: {
        lifetimeAverage: {
          dailyAverageUsd: number;
          windowDays: number;
        };
      };
    };
    expect(body.data.lifetimeAverage.windowDays).toBe(30);
    expect(body.data.lifetimeAverage.dailyAverageUsd).toBeCloseTo(10, 4);
  });

  it("zeroes the lifetime average when there's no fee data", async () => {
    mockFetchRevenueBuckets.mockResolvedValue([]);
    const app = createApp();
    const res = await app.request(
      "/admin/analytics/revenue-forecast",
      {},
      makeEnv(),
    );
    const body = (await res.json()) as {
      data: {
        flat: Record<string, { dailyAverageUsd: number }>;
        lifetimeAverage: { dailyAverageUsd: number };
      };
    };
    expect(body.data.flat.last1d.dailyAverageUsd).toBe(0);
    expect(body.data.lifetimeAverage.dailyAverageUsd).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// /admin/analytics/graduations
// ---------------------------------------------------------------------------

describe("GET /admin/analytics/graduations", () => {
  beforeEach(clearAllMocks);

  it("returns time series + funnel block", async () => {
    const nowSec = 1_800_000_000;
    vi.spyOn(Date, "now").mockReturnValue(nowSec * 1000);
    const dayStart = Math.floor(nowSec / 86400) * 86400;
    mockFetchGraduationBuckets.mockResolvedValue([
      { bucket: dayStart, graduations: 2 },
    ]);
    mockFetchGraduationFunnelStats.mockResolvedValue({
      totalLaunched: 50,
      totalGraduated: 8,
      totalPendingGraduation: 1,
      graduationRatePct: 16,
      medianTimeToGraduateSec: 3600,
      meanTimeToGraduateSec: 7200,
    });
    const app = createApp();
    const res = await app.request(
      "/admin/analytics/graduations?lookback=2",
      {},
      makeEnv(),
    );
    const body = (await res.json()) as {
      data: {
        series: Array<{ t: number; graduations: number }>;
        funnel: { totalLaunched: number; graduationRatePct: number };
      };
    };
    expect(body.data.series).toHaveLength(2);
    expect(body.data.series[1].graduations).toBe(2);
    expect(body.data.funnel.totalLaunched).toBe(50);
    expect(body.data.funnel.graduationRatePct).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// /admin/analytics/top-tokens
// ---------------------------------------------------------------------------

describe("GET /admin/analytics/top-tokens", () => {
  beforeEach(clearAllMocks);

  it("rejects an unknown sort key", async () => {
    const app = createApp();
    const res = await app.request(
      "/admin/analytics/top-tokens?sort=invalid",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("returns sorted token leaderboard with USD floats", async () => {
    mockFetchTopTokens.mockResolvedValue([
      {
        address: "0xabc",
        name: "Foo",
        symbol: "FOO",
        creator: "0xdef",
        graduated: false,
        lifetimeVolumeUsdcRaw: "2000000",
        protocolFeesUsdcRaw: "15000",
        creatorFeesUsdcRaw: "5000",
        organicUsdcRaisedUsdcRaw: "1000000",
      },
    ]);
    const app = createApp();
    const res = await app.request(
      "/admin/analytics/top-tokens?sort=volume_lifetime&limit=10",
      {},
      makeEnv(),
    );
    const body = (await res.json()) as {
      data: {
        sort: string;
        limit: number;
        rows: Array<{
          address: string;
          lifetimeVolumeUsd: number;
          protocolFeesUsd: number;
        }>;
      };
    };
    expect(body.data.sort).toBe("volume_lifetime");
    expect(body.data.limit).toBe(10);
    expect(body.data.rows[0]).toMatchObject({
      address: "0xabc",
      lifetimeVolumeUsd: 2,
      protocolFeesUsd: 0.015,
    });
  });

  it("caps `limit` to the documented maximum", async () => {
    mockFetchTopTokens.mockResolvedValue([]);
    const app = createApp();
    const res = await app.request(
      "/admin/analytics/top-tokens?limit=99999",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { limit: number } };
    expect(body.data.limit).toBe(100);
  });
});
