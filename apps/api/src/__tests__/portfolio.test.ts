import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockFetchPortfolioPositions = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchPortfolioPositions: (...args: unknown[]) =>
    mockFetchPortfolioPositions(...args),
}));

vi.mock("../db/client.js", () => ({
  createDb: () => ({}),
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
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
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
    mockFetchPortfolioPositions.mockResolvedValue(null);
    const app = createApp();
    const res = await app.request(`/portfolio/${WALLET}`, {}, makeEnv());
    expect(res.status).toBe(503);
  });

  it("joins token_balance with wallet_position for cost basis", async () => {
    mockFetchPortfolioPositions.mockResolvedValue({
      positions: [
        {
          tokenAddress: TOKEN_A,
          tokenAmount: "1000000000000000000000000",
          costBasisUsdc: "250000000",
        },
        // Direct-transfer recipient: balance present, cost basis from
        // `COALESCE(p.cost_basis_usdc, 0)` → "0".
        {
          tokenAddress: TOKEN_B,
          tokenAmount: "5000000000000000000",
          costBasisUsdc: "0",
        },
      ],
      truncated: false,
    });

    const app = createApp();
    const res = await app.request(`/portfolio/${WALLET}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        positions: {
          tokenAddress: string;
          tokenAmount: string;
          costBasisUsdc: string;
        }[];
        approximate: boolean;
      };
    };

    expect(body.data.positions).toHaveLength(2);
    expect(body.data.positions[0]).toEqual({
      tokenAddress: TOKEN_A,
      tokenAmount: "1000000000000000000000000",
      costBasisUsdc: "250000000",
    });
    expect(body.data.positions[1]).toEqual({
      tokenAddress: TOKEN_B,
      tokenAmount: "5000000000000000000",
      costBasisUsdc: "0",
    });
    expect(body.data.approximate).toBe(false);
  });

  it("makes a single read-path round-trip (one JOIN, no pagination)", async () => {
    mockFetchPortfolioPositions.mockResolvedValue({
      positions: [],
      truncated: false,
    });

    const app = createApp();
    await app.request(`/portfolio/${WALLET}`, {}, makeEnv());
    expect(mockFetchPortfolioPositions).toHaveBeenCalledTimes(1);
  });

  it("propagates `truncated` to `approximate` on a saturated page", async () => {
    mockFetchPortfolioPositions.mockResolvedValue({
      positions: Array.from({ length: 1000 }, (_, i) => ({
        tokenAddress: `0x${(i + 1).toString(16).padStart(40, "0")}`,
        tokenAmount: "1",
        costBasisUsdc: "0",
      })),
      truncated: true,
    });

    const app = createApp();
    const res = await app.request(`/portfolio/${WALLET}`, {}, makeEnv());
    const body = (await res.json()) as { data: { approximate: boolean } };
    expect(body.data.approximate).toBe(true);
  });

  it("sets a Cache-Control header for edge caching", async () => {
    mockFetchPortfolioPositions.mockResolvedValue({
      positions: [],
      truncated: false,
    });

    const app = createApp();
    const res = await app.request(`/portfolio/${WALLET}`, {}, makeEnv());
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=15");
  });
});
