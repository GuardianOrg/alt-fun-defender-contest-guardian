import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockFetchReferrerStatsById = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchReferrerStatsById: mockFetchReferrerStatsById,
}));

vi.mock("../db/client.js", () => ({
  createDb: () => ({}),
}));

const { default: referralsV2 } = await import("../routes/bot/referrals-v2.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/bot/referrals-v2", referralsV2);
  return app;
}

function makeKV(map = new Map<string, string>()): KVNamespace {
  return {
    get: vi.fn(async (k: string) => map.get(k) ?? null),
    put: vi.fn(),
    delete: vi.fn(),
  } as unknown as KVNamespace;
}

function makeEnv(kv?: KVNamespace): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    WALLET_KV: kv ?? makeKV(),
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  } as AppBindings;
}

const VALID_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

describe("GET /bot/referrals-v2/:wallet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("400 for malformed wallet", async () => {
    const res = await createApp().request("/bot/referrals-v2/nope", {}, makeEnv());
    expect(res.status).toBe(400);
  });

  it("503 when WALLET_KV binding is missing", async () => {
    const env = makeEnv();
    (env as { WALLET_KV?: KVNamespace }).WALLET_KV = undefined;
    const res = await createApp().request(`/bot/referrals-v2/${VALID_WALLET}`, {}, env);
    expect(res.status).toBe(503);
  });

  it("returns zeroed stats with self-as-rewardsWallet when indexer signals unavailable", async () => {
    mockFetchReferrerStatsById.mockResolvedValue("unavailable");
    const res = await createApp().request(`/bot/referrals-v2/${VALID_WALLET}`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        rewardsWallet: string;
        referredCount: number;
        lifetimeEarnedUsdc: string;
        badPaymentCount: number;
        attributionLossCount: number;
      };
    };
    expect(body.data.rewardsWallet).toBe(VALID_WALLET.toLowerCase());
    expect(body.data.referredCount).toBe(0);
    expect(body.data.lifetimeEarnedUsdc).toBe("0");
  });

  it("returns helper stats when indexer row exists", async () => {
    mockFetchReferrerStatsById.mockResolvedValue({
      referredCount: 5,
      lifetimeEarnedUsdc: "12345",
      badPaymentCount: 1,
      attributionLossCount: 2,
    });
    const res = await createApp().request(`/bot/referrals-v2/${VALID_WALLET}`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { referredCount: number; lifetimeEarnedUsdc: string };
    };
    expect(body.data.referredCount).toBe(5);
    expect(body.data.lifetimeEarnedUsdc).toBe("12345");
  });

  it("honours the KV-stored rewardsWallet and lowercases it for the lookup + response", async () => {
    // Stored value is intentionally checksum-cased so we can assert the
    // route normalises it before both the DB lookup and the response —
    // matches `fetchReferrerStatsById`'s lowercase id expectation.
    const storedChecksumCased = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
    const lowercased = storedChecksumCased.toLowerCase();
    const kv = makeKV(
      new Map([
        [
          `rewards-wallet:${VALID_WALLET.toLowerCase()}`,
          JSON.stringify({ rewardsWallet: storedChecksumCased, setAt: 1 }),
        ],
      ]),
    );
    mockFetchReferrerStatsById.mockResolvedValue(null);
    const res = await createApp().request(
      `/bot/referrals-v2/${VALID_WALLET}`,
      {},
      makeEnv(kv),
    );
    expect(res.status).toBe(200);
    expect(mockFetchReferrerStatsById).toHaveBeenCalledWith(
      expect.anything(),
      lowercased,
    );
    const body = (await res.json()) as { data: { rewardsWallet: string } };
    expect(body.data.rewardsWallet).toBe(lowercased);
  });
});
