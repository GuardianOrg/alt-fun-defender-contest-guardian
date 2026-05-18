import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockFetchReferralsByReferrer = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchReferralsByReferrer: mockFetchReferralsByReferrer,
}));

vi.mock("../db/client.js", () => ({
  createDb: () => ({}),
}));

const { default: referralsV2 } = await import("../routes/referrals-v2.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/referrals-v2", referralsV2);
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

const VALID_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

describe("GET /referrals-v2/:wallet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 for invalid wallet", async () => {
    const res = await createApp().request("/referrals-v2/not-an-address", {}, makeEnv());
    expect(res.status).toBe(400);
  });

  it("returns 503 when the helper returns null", async () => {
    mockFetchReferralsByReferrer.mockResolvedValue(null);
    const res = await createApp().request(`/referrals-v2/${VALID_WALLET}`, {}, makeEnv());
    expect(res.status).toBe(503);
  });

  it("returns empty aggregate when wallet has no referrals", async () => {
    mockFetchReferralsByReferrer.mockResolvedValue([]);
    const res = await createApp().request(`/referrals-v2/${VALID_WALLET}`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { referredWallets: number; referredVolume: string; referrals: unknown[] };
    };
    expect(body.data.referredWallets).toBe(0);
    expect(body.data.referredVolume).toBe("0");
    expect(body.data.referrals).toEqual([]);
  });

  it("aggregates unique traders and total USDC volume", async () => {
    mockFetchReferralsByReferrer.mockResolvedValue([
      { tokenAddress: "0xtoken", trader: "0xAAA", usdcAmount: "1000000", timestamp: "100" },
      { tokenAddress: "0xtoken", trader: "0xAAA", usdcAmount: "500000", timestamp: "101" },
      { tokenAddress: "0xtoken", trader: "0xBBB", usdcAmount: "2000000", timestamp: "102" },
    ]);
    const res = await createApp().request(`/referrals-v2/${VALID_WALLET}`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { referredWallets: number; referredVolume: string; referrals: unknown[] };
    };
    expect(body.data.referredWallets).toBe(2);
    expect(body.data.referredVolume).toBe("3500000");
    expect(body.data.referrals).toHaveLength(3);
  });
});
