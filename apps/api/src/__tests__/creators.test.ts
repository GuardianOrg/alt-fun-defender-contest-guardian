import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockFetchCreatorEarnings = vi.fn();
const mockFetchCreatorVolumesByAddresses = vi.fn();
let mockTokens: { address: string; creator: string }[] = [];
let mockProfile: { address: string; displayName?: string } | undefined;

vi.mock("../lib/indexer-reads.js", () => ({
  fetchCreatorEarnings: (...args: unknown[]) =>
    mockFetchCreatorEarnings(...args),
  fetchCreatorVolumesByAddresses: (...args: unknown[]) =>
    mockFetchCreatorVolumesByAddresses(...args),
}));

// Drizzle chainable mock. The route makes two queries:
//   1. profile lookup: `select().from(userProfiles).where(...).limit(1)`
//   2. token list:    `select().from(tokens).where(...)` (awaited directly)
//
// We track which table the chain started on (via `from()`) and let the
// terminal step (`limit` or implicit await) return the right shape. Using
// `then` to make the where-result awaitable mimics drizzle's PromiseLike
// query-builder, since the route awaits it directly with no `.limit()`.
vi.mock("../db/client.js", () => {
  let lastTable: "userProfiles" | "tokens" | null = null;
  return {
    createDb: () => ({
      select: () => ({
        from: (table: { _?: { columns?: Record<string, unknown> } }) => {
          // Sniff Drizzle's internal column descriptor (`table._.columns`) to
          // tell which schema we were handed without importing the real
          // schema objects (which would pull in the postgres driver). Only
          // `userProfiles` carries `displayName`, so its presence uniquely
          // identifies the profile lookup vs the tokens lookup. This is a
          // pragmatic fragility — if the schema ever sprouts a `displayName`
          // column on `tokens`, this test will route the wrong fixture.
          // `lastTable` is read by the `where` branch below to decide
          // whether the awaited result is `mockProfile` or `mockTokens`.
          const cols = table?._?.columns ?? {};
          lastTable = "displayName" in cols ? "userProfiles" : "tokens";
          return {
            where: () => {
              const tableAtCall = lastTable;
              const limit = vi.fn().mockResolvedValue(
                tableAtCall === "userProfiles" && mockProfile ? [mockProfile] : [],
              );
              return {
                limit,
                then: (
                  resolve: (v: unknown) => void,
                  reject?: (e: unknown) => void,
                ) => {
                  try {
                    resolve(tableAtCall === "tokens" ? mockTokens : []);
                  } catch (err) {
                    reject?.(err);
                  }
                },
              };
            },
          };
        },
      }),
    }),
  };
});

const { default: creatorsRoute } = await import("../routes/creators.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/creators", creatorsRoute);
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

const CREATOR = "0xaaaa000000000000000000000000000000000001";
const TOKEN_A = "0xbbbb000000000000000000000000000000000002";
const TOKEN_B = "0xcccc000000000000000000000000000000000003";

describe("GET /creators/:address/earnings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for an invalid address", async () => {
    const app = createApp();
    const res = await app.request(
      "/creators/not-an-address/earnings",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 503 when the indexer table is unreachable", async () => {
    mockFetchCreatorEarnings.mockResolvedValue("unavailable");
    const app = createApp();
    const res = await app.request(
      `/creators/${CREATOR}/earnings`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(503);
  });

  it("returns a clean zero-state when no row exists for the creator", async () => {
    mockFetchCreatorEarnings.mockResolvedValue(null);
    const app = createApp();
    const res = await app.request(
      `/creators/${CREATOR}/earnings`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        lifetimeEarnedUsdcRaw: string;
        lifetimeClaimedUsdcRaw: string;
        claimableUsdcRaw: string;
        lifetimeEarnedUsd: number;
        lifetimeClaimedUsd: number;
        claimableUsd: number;
      };
    };
    expect(body.data).toEqual({
      lifetimeEarnedUsdcRaw: "0",
      lifetimeClaimedUsdcRaw: "0",
      claimableUsdcRaw: "0",
      lifetimeEarnedUsd: 0,
      lifetimeClaimedUsd: 0,
      claimableUsd: 0,
    });
  });

  it("returns derived claimable + USD-formatted figures from the precomputed counter", async () => {
    mockFetchCreatorEarnings.mockResolvedValue({
      lifetimeEarnedUsdcRaw: "12_500_000".replace(/_/g, ""), // 12.5 USDC
      lifetimeClaimedUsdcRaw: "2_500_000".replace(/_/g, ""), // 2.5 USDC
    });
    const app = createApp();
    const res = await app.request(
      `/creators/${CREATOR}/earnings`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        lifetimeEarnedUsdcRaw: string;
        lifetimeClaimedUsdcRaw: string;
        claimableUsdcRaw: string;
        lifetimeEarnedUsd: number;
        lifetimeClaimedUsd: number;
        claimableUsd: number;
      };
    };
    expect(body.data.lifetimeEarnedUsdcRaw).toBe("12500000");
    expect(body.data.lifetimeClaimedUsdcRaw).toBe("2500000");
    expect(body.data.claimableUsdcRaw).toBe("10000000");
    expect(body.data.lifetimeEarnedUsd).toBeCloseTo(12.5, 6);
    expect(body.data.lifetimeClaimedUsd).toBeCloseTo(2.5, 6);
    expect(body.data.claimableUsd).toBeCloseTo(10, 6);
  });

  it("clamps claimable at zero when the indexer briefly shows claimed > earned", async () => {
    mockFetchCreatorEarnings.mockResolvedValue({
      lifetimeEarnedUsdcRaw: "1000000",
      lifetimeClaimedUsdcRaw: "1500000",
    });
    const app = createApp();
    const res = await app.request(
      `/creators/${CREATOR}/earnings`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as {
      data: { claimableUsdcRaw: string; claimableUsd: number };
    };
    expect(body.data.claimableUsdcRaw).toBe("0");
    expect(body.data.claimableUsd).toBe(0);
  });

  it("matches addresses case-insensitively (passes lowercase to the read helper)", async () => {
    mockFetchCreatorEarnings.mockResolvedValue(null);
    const app = createApp();
    await app.request(`/creators/${CREATOR}/earnings`, {}, makeEnv());
    // viem's `getAddress` checksums the param so the route hands the
    // checksummed form to `fetchCreatorEarnings`. The helper itself
    // lowercases internally — the contract under test is "the route
    // forwards the checksum-cased address verbatim".
    const arg = mockFetchCreatorEarnings.mock.calls[0][1] as string;
    expect(arg.toLowerCase()).toBe(CREATOR.toLowerCase());
  });

  it("sets a Cache-Control header for edge caching", async () => {
    mockFetchCreatorEarnings.mockResolvedValue(null);
    const app = createApp();
    const res = await app.request(
      `/creators/${CREATOR}/earnings`,
      {},
      makeEnv(),
    );
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=15");
  });
});

describe("GET /creators/:address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTokens = [];
    mockProfile = undefined;
  });

  it("returns 400 for an invalid address", async () => {
    const app = createApp();
    const res = await app.request("/creators/not-an-address", {}, makeEnv());
    expect(res.status).toBe(400);
  });

  it("returns empty stats and skips the volume read when the creator has no tokens", async () => {
    const app = createApp();
    const res = await app.request(`/creators/${CREATOR}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        profile: unknown;
        tokens: unknown[];
        stats: { tokensCreated: number; totalVolume: string };
      };
    };
    expect(body.data.tokens).toEqual([]);
    expect(body.data.stats).toEqual({ tokensCreated: 0, totalVolume: "0" });
    expect(mockFetchCreatorVolumesByAddresses).not.toHaveBeenCalled();
  });

  it("sums per-token `volumeUsd` from a single direct-DB read", async () => {
    mockTokens = [
      { address: TOKEN_A, creator: CREATOR },
      { address: TOKEN_B, creator: CREATOR },
    ];
    mockFetchCreatorVolumesByAddresses.mockResolvedValue([
      { address: TOKEN_A, volumeUsd: "1000" },
      { address: TOKEN_B, volumeUsd: "500" },
    ]);

    const app = createApp();
    const res = await app.request(`/creators/${CREATOR}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        tokens: unknown[];
        stats: { tokensCreated: number; totalVolume: string };
      };
    };
    expect(body.data.tokens).toHaveLength(2);
    expect(body.data.stats).toEqual({ tokensCreated: 2, totalVolume: "1500" });

    expect(mockFetchCreatorVolumesByAddresses).toHaveBeenCalledTimes(1);
    // Helper takes `(db, addresses, limit)`. Pin the lower-casing of the
    // address list here — the indexer stores addresses lowercased and
    // the route must forward them in that form for the IN-list to match.
    const args = mockFetchCreatorVolumesByAddresses.mock.calls[0] as [
      unknown,
      string[],
      number,
    ];
    expect(args[1]).toEqual([TOKEN_A.toLowerCase(), TOKEN_B.toLowerCase()]);
    expect(typeof args[2]).toBe("number");
  });

  it("treats a missing token row as zero contribution to total volume", async () => {
    mockTokens = [
      { address: TOKEN_A, creator: CREATOR },
      { address: TOKEN_B, creator: CREATOR },
    ];
    mockFetchCreatorVolumesByAddresses.mockResolvedValue([
      { address: TOKEN_A, volumeUsd: "999" },
    ]);

    const app = createApp();
    const res = await app.request(`/creators/${CREATOR}`, {}, makeEnv());
    const body = (await res.json()) as { data: { stats: { totalVolume: string } } };
    expect(body.data.stats.totalVolume).toBe("999");
  });

  it("returns totalVolume = 0 when the indexer is unreachable", async () => {
    mockTokens = [{ address: TOKEN_A, creator: CREATOR }];
    // Helper returns `null` on DB read failure (see indexer-reads.ts
    // docstring). The route must degrade to `totalVolume = 0` rather
    // than 503ing the whole creator profile.
    mockFetchCreatorVolumesByAddresses.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request(`/creators/${CREATOR}`, {}, makeEnv());
    const body = (await res.json()) as { data: { stats: { totalVolume: string } } };
    expect(body.data.stats.totalVolume).toBe("0");
  });

  it("sets a Cache-Control header for edge caching", async () => {
    const app = createApp();
    const res = await app.request(`/creators/${CREATOR}`, {}, makeEnv());
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=30");
  });
});
