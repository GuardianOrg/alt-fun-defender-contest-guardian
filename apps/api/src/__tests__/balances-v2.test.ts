import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockFetchTokenBalancesByWallet = vi.fn();
const mockCheckIndexerHealth = vi.fn();
const mockDbWhere = vi.fn().mockResolvedValue([]);

vi.mock("../lib/indexer-reads.js", () => ({
  fetchTokenBalancesByWallet: mockFetchTokenBalancesByWallet,
  checkIndexerHealth: mockCheckIndexerHealth,
}));

vi.mock("../db/client.js", () => ({
  createDb: () => ({
    select: () => ({
      from: () => ({
        where: mockDbWhere,
      }),
    }),
  }),
}));

const { default: balancesV2 } = await import("../routes/balances-v2.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/balances-v2", balancesV2);
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

const VALID_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const TOKEN_ADDR = "0x4DFB6bebbdF9d5ea76123729E0b3a823f9c3ecC0";

describe("GET /balances-v2/:wallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckIndexerHealth.mockResolvedValue(true);
  });

  it("returns 400 for invalid address", async () => {
    const res = await createApp().request("/balances-v2/not-an-address", {}, makeEnv());
    expect(res.status).toBe(400);
  });

  it("returns 503 when checkIndexerHealth fails", async () => {
    mockCheckIndexerHealth.mockResolvedValue(false);
    const res = await createApp().request(`/balances-v2/${VALID_WALLET}`, {}, makeEnv());
    expect(res.status).toBe(503);
  });

  it("returns 503 when fetchTokenBalancesByWallet returns null", async () => {
    mockFetchTokenBalancesByWallet.mockResolvedValue(null);
    const res = await createApp().request(`/balances-v2/${VALID_WALLET}`, {}, makeEnv());
    expect(res.status).toBe(503);
  });

  it("returns empty array when wallet holds no tokens", async () => {
    mockFetchTokenBalancesByWallet.mockResolvedValue([]);
    const res = await createApp().request(`/balances-v2/${VALID_WALLET}`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it("surfaces hidden-token positions tagged isHidden:true (issue #712 parity with v1)", async () => {
    mockFetchTokenBalancesByWallet.mockResolvedValue([
      { tokenAddress: TOKEN_ADDR, balance: "5000000000000000000000000" },
    ]);
    mockDbWhere.mockResolvedValue([
      {
        address: TOKEN_ADDR,
        name: "BANNED",
        ticker: "BAN",
        imageUrl: "",
        ltPair: "0xabc",
        leverage: 2,
        underlying: "HYPE",
        ltDirection: "long",
        isHidden: true,
      },
    ]);

    const res = await createApp().request(`/balances-v2/${VALID_WALLET}`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      ticker: "BAN",
      isHidden: true,
      balance: "5000000000000000000000000",
    });
  });

  it("filters out balances whose token row is missing from the DB", async () => {
    mockFetchTokenBalancesByWallet.mockResolvedValue([
      { tokenAddress: TOKEN_ADDR, balance: "1000000000000000000" },
    ]);
    mockDbWhere.mockResolvedValue([]);
    const res = await createApp().request(`/balances-v2/${VALID_WALLET}`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});
