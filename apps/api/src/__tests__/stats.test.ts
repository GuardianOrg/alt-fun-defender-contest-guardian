import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockFetchPlatformStats = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchPlatformStats: (...args: unknown[]) => mockFetchPlatformStats(...args),
}));

// Drizzle's `createDb` calls into the Neon HTTP driver synchronously — stub it
// so the route can construct a "Database" handle for the `fetchPlatformStats`
// mock without touching the network.
vi.mock("../db/client.js", () => ({
  createDb: () => ({}),
}));

const { default: statsRoute } = await import("../routes/stats.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/stats", statsRoute);
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
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

describe("GET /stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns counters from the singleton and sums hourly buckets", async () => {
    mockFetchPlatformStats.mockResolvedValue({
      singleton: {
        totalTokens: 42,
        tokensLive: 30,
        tokensGraduated: 12,
        totalVolumeUsd: "9999999999",
      },
      volume24h: 400n,
    });

    const app = createApp();
    const res = await app.request("/stats", {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      dataSource: string;
      data: {
        tokensLive: number;
        tokensGraduated: number;
        totalTokens: number;
        volume24h: string;
      };
    };

    expect(body.status).toBe("success");
    expect(body.dataSource).toBe("live");
    expect(body.data).toEqual({
      tokensLive: 30,
      tokensGraduated: 12,
      totalTokens: 42,
      volume24h: "400",
    });
  });

  it("uses a single read-path round-trip (singleton + bucket scan combined)", async () => {
    mockFetchPlatformStats.mockResolvedValue({
      singleton: {
        totalTokens: 1,
        tokensLive: 1,
        tokensGraduated: 0,
        totalVolumeUsd: "0",
      },
      volume24h: 0n,
    });
    const app = createApp();
    await app.request("/stats", {}, makeEnv());
    expect(mockFetchPlatformStats).toHaveBeenCalledTimes(1);
  });

  it("anchors the 24h window at the current hour-start", async () => {
    mockFetchPlatformStats.mockResolvedValue({
      singleton: {
        totalTokens: 1,
        tokensLive: 1,
        tokensGraduated: 0,
        totalVolumeUsd: "0",
      },
      volume24h: 0n,
    });
    const fixedNow = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);

    const app = createApp();
    await app.request("/stats", {}, makeEnv());

    // current hour = floor(1700000000 / 3600) * 3600 = 1699999200
    // window start = 1699999200 - 24*3600 = 1699912800
    const [, windowStart] = mockFetchPlatformStats.mock.calls[0] as [
      unknown,
      number,
    ];
    expect(windowStart).toBe(1699912800);
  });

  it("handles a missing singleton (fresh deploy with no events yet)", async () => {
    mockFetchPlatformStats.mockResolvedValue({
      singleton: null,
      volume24h: 0n,
    });

    const app = createApp();
    const res = await app.request("/stats", {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        tokensLive: number;
        tokensGraduated: number;
        totalTokens: number;
        volume24h: string;
      };
    };
    expect(body.data).toEqual({
      tokensLive: 0,
      tokensGraduated: 0,
      totalTokens: 0,
      volume24h: "0",
    });
  });

  it("returns degraded zeros when the indexer read throws", async () => {
    mockFetchPlatformStats.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request("/stats", {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dataSource: string;
      data: { volume24h: string };
    };
    expect(body.dataSource).toBe("degraded");
    expect(body.data.volume24h).toBe("0");
  });

  it("sets a Cache-Control header for edge caching", async () => {
    mockFetchPlatformStats.mockResolvedValue({
      singleton: {
        totalTokens: 1,
        tokensLive: 1,
        tokensGraduated: 0,
        totalVolumeUsd: "0",
      },
      volume24h: 0n,
    });

    const app = createApp();
    const res = await app.request("/stats", {}, makeEnv());

    expect(res.headers.get("Cache-Control")).toContain("s-maxage=30");
  });

  it("sets the Cache-Control header even on the degraded-fallback path", async () => {
    mockFetchPlatformStats.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request("/stats", {}, makeEnv());

    expect(res.headers.get("Cache-Control")).toContain("s-maxage=30");
  });
});
