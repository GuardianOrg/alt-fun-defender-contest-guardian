import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockPonderQuery = vi.fn();

vi.mock("../lib/ponder-client.js", () => ({
  createPonderQuery: () => mockPonderQuery,
}));

const { default: botReferrals } = await import("../routes/bot/referrals.js");

const VALID_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const VALID_REWARDS = "0x1234567890aBcDeF1234567890ABcdef12345678";

interface StubKV {
  store: Map<string, string>;
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string) => Promise<void>;
}

const makeKV = (): StubKV => {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
};

const makeEnv = (kv: StubKV | null): AppBindings =>
  ({
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "http://localhost:42069",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    WALLET_KV: kv ? (kv as unknown as KVNamespace) : undefined,
  }) as AppBindings;

const createApp = (): Hono<{ Bindings: AppBindings }> => {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/bot/referrals", botReferrals);
  return app;
};

describe("GET /bot/referrals/:wallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPonderQuery.mockResolvedValue({ referrerStats: null });
  });

  it("rejects invalid wallet address", async () => {
    const res = await createApp().request(
      "/bot/referrals/not-an-address",
      {},
      makeEnv(makeKV()),
    );
    expect(res.status).toBe(400);
  });

  it("returns 503 when WALLET_KV binding is missing", async () => {
    const res = await createApp().request(
      `/bot/referrals/${VALID_WALLET}`,
      {},
      makeEnv(null),
    );
    expect(res.status).toBe(503);
  });

  it("defaults rewardsWallet to queried wallet when KV unset", async () => {
    const kv = makeKV();
    const res = await createApp().request(
      `/bot/referrals/${VALID_WALLET}`,
      {},
      makeEnv(kv),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { rewardsWallet: string; referredCount: number };
    };
    expect(body.data.rewardsWallet).toBe(VALID_WALLET.toLowerCase());
    expect(body.data.referredCount).toBe(0);
  });

  it("returns the stored rewardsWallet override when set", async () => {
    const kv = makeKV();
    kv.store.set(
      `rewards-wallet:${VALID_WALLET.toLowerCase()}`,
      JSON.stringify({ rewardsWallet: VALID_REWARDS.toLowerCase(), setAt: 1 }),
    );
    const res = await createApp().request(
      `/bot/referrals/${VALID_WALLET}`,
      {},
      makeEnv(kv),
    );
    const body = (await res.json()) as { data: { rewardsWallet: string } };
    expect(body.data.rewardsWallet).toBe(VALID_REWARDS.toLowerCase());
  });

  it("returns zeroed stats when indexer has no row", async () => {
    mockPonderQuery.mockResolvedValue({ referrerStats: null });
    const res = await createApp().request(
      `/bot/referrals/${VALID_WALLET}`,
      {},
      makeEnv(makeKV()),
    );
    const body = (await res.json()) as {
      data: {
        referredCount: number;
        lifetimeEarnedUsdc: string;
        badPaymentCount: number;
        attributionLossCount: number;
      };
    };
    expect(body.data).toMatchObject({
      referredCount: 0,
      lifetimeEarnedUsdc: "0",
      badPaymentCount: 0,
      attributionLossCount: 0,
    });
  });

  it("returns indexer-sourced stats when row exists", async () => {
    mockPonderQuery.mockResolvedValue({
      referrerStats: {
        referredCount: 7,
        lifetimeEarnedUsdc: "1500000",
        badPaymentCount: 2,
        attributionLossCount: 3,
      },
    });
    const res = await createApp().request(
      `/bot/referrals/${VALID_WALLET}`,
      {},
      makeEnv(makeKV()),
    );
    const body = (await res.json()) as {
      data: {
        referredCount: number;
        lifetimeEarnedUsdc: string;
        badPaymentCount: number;
        attributionLossCount: number;
      };
    };
    expect(body.data).toMatchObject({
      referredCount: 7,
      lifetimeEarnedUsdc: "1500000",
      badPaymentCount: 2,
      attributionLossCount: 3,
    });
  });

  it("collapses indexer outages to zeroed stats rather than 5xx", async () => {
    mockPonderQuery.mockResolvedValue(null);
    const res = await createApp().request(
      `/bot/referrals/${VALID_WALLET}`,
      {},
      makeEnv(makeKV()),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { referredCount: number };
    };
    expect(body.data.referredCount).toBe(0);
  });
});

describe("POST /bot/referrals/:wallet/rewards-wallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid path wallet", async () => {
    const res = await createApp().request(
      `/bot/referrals/not-an-address/rewards-wallet`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardsWallet: VALID_REWARDS }),
      },
      makeEnv(makeKV()),
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid body rewardsWallet", async () => {
    const res = await createApp().request(
      `/bot/referrals/${VALID_WALLET}/rewards-wallet`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardsWallet: "not-an-address" }),
      },
      makeEnv(makeKV()),
    );
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON body", async () => {
    const res = await createApp().request(
      `/bot/referrals/${VALID_WALLET}/rewards-wallet`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ not json",
      },
      makeEnv(makeKV()),
    );
    expect(res.status).toBe(400);
  });

  it("persists rewardsWallet override to KV under lowercased keys", async () => {
    const kv = makeKV();
    const res = await createApp().request(
      `/bot/referrals/${VALID_WALLET}/rewards-wallet`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardsWallet: VALID_REWARDS }),
      },
      makeEnv(kv),
    );
    expect(res.status).toBe(200);
    const stored = kv.store.get(`rewards-wallet:${VALID_WALLET.toLowerCase()}`);
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored as string) as {
      rewardsWallet: string;
      setAt: number;
    };
    expect(parsed.rewardsWallet).toBe(VALID_REWARDS.toLowerCase());
    expect(parsed.setAt).toBeGreaterThan(0);
  });

  it("returns 503 when WALLET_KV binding is missing", async () => {
    const res = await createApp().request(
      `/bot/referrals/${VALID_WALLET}/rewards-wallet`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardsWallet: VALID_REWARDS }),
      },
      makeEnv(null),
    );
    expect(res.status).toBe(503);
  });
});
