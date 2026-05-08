import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockPonderQuery = vi.fn();

vi.mock("../lib/ponder-client.js", () => ({
  createPonderQuery: () => mockPonderQuery,
}));

const { default: portfolioRoute } = await import("../routes/portfolio.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/portfolio", portfolioRoute);
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

const WALLET = "0xaaaa000000000000000000000000000000000001";
const TOKEN_A = "0xbbbb000000000000000000000000000000000002";
const TOKEN_B = "0xcccc000000000000000000000000000000000003";

describe("GET /portfolio/:wallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for an invalid wallet address", async () => {
    const app = createApp();
    const res = await app.request("/portfolio/not-an-address", {}, makeEnv());
    expect(res.status).toBe(400);
  });

  it("returns 503 when the indexer is unreachable", async () => {
    mockPonderQuery.mockResolvedValue(null);
    const app = createApp();
    const res = await app.request(`/portfolio/${WALLET}`, {}, makeEnv());
    expect(res.status).toBe(503);
  });

  it("joins tokenBalances with walletPositions for cost basis", async () => {
    mockPonderQuery.mockResolvedValue({
      tokenBalances: {
        items: [
          { tokenAddress: TOKEN_A, balance: "1000000000000000000000000" },
          { tokenAddress: TOKEN_B, balance: "5000000000000000000" },
        ],
      },
      walletPositions: {
        items: [
          // Cost basis only known for TOKEN_A — TOKEN_B was acquired via
          // direct transfer (no Zap activity).
          { tokenAddress: TOKEN_A, costBasisUsdc: "250000000" },
        ],
      },
    });

    const app = createApp();
    const res = await app.request(`/portfolio/${WALLET}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        positions: { tokenAddress: string; tokenAmount: string; costBasisUsdc: string }[];
        approximate: boolean;
      };
    };

    expect(body.data.positions).toHaveLength(2);
    expect(body.data.positions[0]).toEqual({
      tokenAddress: TOKEN_A,
      tokenAmount: "1000000000000000000000000",
      costBasisUsdc: "250000000",
    });
    // Transfer-only acquisition → balance present, cost basis defaults to "0".
    expect(body.data.positions[1]).toEqual({
      tokenAddress: TOKEN_B,
      tokenAmount: "5000000000000000000",
      costBasisUsdc: "0",
    });
    expect(body.data.approximate).toBe(false);
  });

  it("excludes positions with zero balance (defensive — the where filter already does this)", async () => {
    mockPonderQuery.mockResolvedValue({
      tokenBalances: {
        items: [
          { tokenAddress: TOKEN_A, balance: "0" },
          { tokenAddress: TOKEN_B, balance: "1" },
        ],
      },
      walletPositions: { items: [] },
    });

    const app = createApp();
    const res = await app.request(`/portfolio/${WALLET}`, {}, makeEnv());
    const body = (await res.json()) as {
      data: { positions: { tokenAddress: string }[] };
    };

    expect(body.data.positions).toHaveLength(1);
    expect(body.data.positions[0].tokenAddress).toBe(TOKEN_B);
  });

  it("makes a single GraphQL round-trip (no pagination)", async () => {
    mockPonderQuery.mockResolvedValue({
      tokenBalances: { items: [] },
      walletPositions: { items: [] },
    });

    const app = createApp();
    await app.request(`/portfolio/${WALLET}`, {}, makeEnv());
    expect(mockPonderQuery).toHaveBeenCalledTimes(1);
  });

  it("flags `approximate: true` when balance results hit the page-size cap", async () => {
    const balances = Array.from({ length: 1000 }, (_, i) => ({
      tokenAddress: `0x${(i + 1).toString(16).padStart(40, "0")}`,
      balance: "1",
    }));
    mockPonderQuery.mockResolvedValue({
      tokenBalances: { items: balances },
      walletPositions: { items: [] },
    });

    const app = createApp();
    const res = await app.request(`/portfolio/${WALLET}`, {}, makeEnv());
    const body = (await res.json()) as { data: { approximate: boolean } };
    expect(body.data.approximate).toBe(true);
  });

  it("sets a Cache-Control header for edge caching", async () => {
    mockPonderQuery.mockResolvedValue({
      tokenBalances: { items: [] },
      walletPositions: { items: [] },
    });

    const app = createApp();
    const res = await app.request(`/portfolio/${WALLET}`, {}, makeEnv());
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=15");
  });
});
