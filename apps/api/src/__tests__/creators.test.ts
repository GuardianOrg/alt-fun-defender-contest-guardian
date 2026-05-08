import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockPonderQuery = vi.fn();
let mockTokens: { address: string; creator: string }[] = [];
let mockProfile: { address: string; displayName?: string } | undefined;

vi.mock("../lib/ponder-client.js", () => ({
  createPonderQuery: () => mockPonderQuery,
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
    LT_TICKER_DO: {} as DurableObjectNamespace,
    AI: {} as Ai,
  };
}

const CREATOR = "0xaaaa000000000000000000000000000000000001";
const TOKEN_A = "0xbbbb000000000000000000000000000000000002";
const TOKEN_B = "0xcccc000000000000000000000000000000000003";

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

  it("returns empty stats and skips Ponder when the creator has no tokens", async () => {
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
    expect(mockPonderQuery).not.toHaveBeenCalled();
  });

  it("sums per-token `volumeUsd` from a single GraphQL query", async () => {
    mockTokens = [
      { address: TOKEN_A, creator: CREATOR },
      { address: TOKEN_B, creator: CREATOR },
    ];
    mockPonderQuery.mockResolvedValue({
      tokens: {
        items: [
          { address: TOKEN_A, volumeUsd: "1000" },
          { address: TOKEN_B, volumeUsd: "500" },
        ],
      },
    });

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

    expect(mockPonderQuery).toHaveBeenCalledTimes(1);
    const [query, vars] = mockPonderQuery.mock.calls[0] as [
      string,
      { addresses: string[]; limit: number },
    ];
    expect(query).toContain("address_in: $addresses");
    expect(vars.addresses).toEqual([TOKEN_A.toLowerCase(), TOKEN_B.toLowerCase()]);
  });

  it("treats a missing token row as zero contribution to total volume", async () => {
    mockTokens = [
      { address: TOKEN_A, creator: CREATOR },
      { address: TOKEN_B, creator: CREATOR },
    ];
    mockPonderQuery.mockResolvedValue({
      tokens: { items: [{ address: TOKEN_A, volumeUsd: "999" }] },
    });

    const app = createApp();
    const res = await app.request(`/creators/${CREATOR}`, {}, makeEnv());
    const body = (await res.json()) as { data: { stats: { totalVolume: string } } };
    expect(body.data.stats.totalVolume).toBe("999");
  });

  it("returns totalVolume = 0 when the indexer is unreachable", async () => {
    mockTokens = [{ address: TOKEN_A, creator: CREATOR }];
    mockPonderQuery.mockResolvedValue(null);

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
