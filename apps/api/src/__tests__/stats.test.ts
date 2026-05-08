import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockPonderQuery = vi.fn();

vi.mock("../lib/ponder-client.js", () => ({
  createPonderQuery: () => mockPonderQuery,
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
    AI: {} as Ai,
  };
}

describe("GET /stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns counters from the singleton and sums hourly buckets", async () => {
    mockPonderQuery.mockResolvedValue({
      globalStats: {
        totalTokens: "42",
        tokensLive: "30",
        tokensGraduated: "12",
        totalVolumeUsd: "9999999999",
      },
      hourlyVolumes: {
        items: [
          { hourStart: "1000000000", volumeUsd: "100" },
          { hourStart: "1000003600", volumeUsd: "250" },
          { hourStart: "1000007200", volumeUsd: "50" },
        ],
      },
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

  it("uses a single GraphQL round-trip (singleton + bucket scan)", async () => {
    mockPonderQuery.mockResolvedValue({
      globalStats: { totalTokens: "1", tokensLive: "1", tokensGraduated: "0", totalVolumeUsd: "0" },
      hourlyVolumes: { items: [] },
    });
    const app = createApp();
    await app.request("/stats", {}, makeEnv());
    expect(mockPonderQuery).toHaveBeenCalledTimes(1);
  });

  it("scans the last 25 hour-buckets via `hourStart_gte`", async () => {
    mockPonderQuery.mockResolvedValue({
      globalStats: { totalTokens: "1", tokensLive: "1", tokensGraduated: "0", totalVolumeUsd: "0" },
      hourlyVolumes: { items: [] },
    });
    const fixedNow = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);

    const app = createApp();
    await app.request("/stats", {}, makeEnv());

    const [query, vars] = mockPonderQuery.mock.calls[0] as [string, { since: string }];
    expect(query).toContain("hourlyVolumes(where: { hourStart_gte: $since }, limit: 25)");
    // current hour = floor(1700000000 / 3600) * 3600 = 1699999200
    // window start = 1699999200 - 24*3600 = 1699912800
    expect(vars.since).toBe("1699912800");
  });

  it("handles a missing singleton (fresh deploy with no events yet)", async () => {
    mockPonderQuery.mockResolvedValue({
      globalStats: null,
      hourlyVolumes: { items: [] },
    });

    const app = createApp();
    const res = await app.request("/stats", {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { tokensLive: number; tokensGraduated: number; totalTokens: number; volume24h: string };
    };
    expect(body.data).toEqual({
      tokensLive: 0,
      tokensGraduated: 0,
      totalTokens: 0,
      volume24h: "0",
    });
  });

  it("returns degraded zeros when the indexer is unreachable", async () => {
    mockPonderQuery.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request("/stats", {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { dataSource: string; data: { volume24h: string } };
    expect(body.dataSource).toBe("degraded");
    expect(body.data.volume24h).toBe("0");
  });

  it("sets a Cache-Control header for edge caching", async () => {
    mockPonderQuery.mockResolvedValue({
      globalStats: { totalTokens: "1", tokensLive: "1", tokensGraduated: "0", totalVolumeUsd: "0" },
      hourlyVolumes: { items: [] },
    });

    const app = createApp();
    const res = await app.request("/stats", {}, makeEnv());

    expect(res.headers.get("Cache-Control")).toContain("s-maxage=30");
  });

  it("sets the Cache-Control header even on the degraded-fallback path", async () => {
    mockPonderQuery.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request("/stats", {}, makeEnv());

    expect(res.headers.get("Cache-Control")).toContain("s-maxage=30");
  });
});
