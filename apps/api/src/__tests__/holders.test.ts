import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockPonderQuery = vi.fn();
const mockPonderPaginatedQuery = vi.fn();

vi.mock("../lib/ponder-client.js", () => ({
  createPonderQuery: () => mockPonderQuery,
  createPonderPaginatedQuery: () => mockPonderPaginatedQuery,
}));

const { default: holdersRoute } = await import("../routes/holders.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/holders", holdersRoute);
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

const TOKEN_ADDR = "0x4DFB6bebbdF9d5ea76123729E0b3a823f9c3ecC0";
const BONDING_PAIR = "0x1111111111111111111111111111111111111111";
const HYPERSWAP_PAIR = "0x2222222222222222222222222222222222222222";

const ONE = 10n ** 18n;
const ONE_BILLION = 1_000_000_000n;
const TOTAL_SUPPLY = ONE_BILLION * ONE;

describe("GET /holders/:address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPonderQuery.mockResolvedValue({
      token: { bondingPair: BONDING_PAIR, hyperswapPair: HYPERSWAP_PAIR },
    });
    mockPonderPaginatedQuery.mockResolvedValue({ items: [], truncated: false });
  });

  it("returns 400 for an invalid address", async () => {
    const app = createApp();
    const res = await app.request("/holders/not-an-address", {}, makeEnv());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toBe("Invalid address");
  });

  it("returns 400 for a non-numeric limit", async () => {
    const app = createApp();
    const res = await app.request(`/holders/${TOKEN_ADDR}?limit=abc`, {}, makeEnv());
    expect(res.status).toBe(400);
  });

  it("returns 503 when the indexer is unavailable", async () => {
    mockPonderQuery.mockResolvedValue(null);
    const app = createApp();
    const res = await app.request(`/holders/${TOKEN_ADDR}`, {}, makeEnv());
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Indexer unavailable");
  });

  it("queries tokenBalances with the bonding + hyperswap pairs and zero address excluded", async () => {
    const app = createApp();
    await app.request(`/holders/${TOKEN_ADDR}`, {}, makeEnv());

    expect(mockPonderPaginatedQuery).toHaveBeenCalledTimes(1);
    const [query, collectionKey, vars] = mockPonderPaginatedQuery.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];

    expect(collectionKey).toBe("tokenBalances");
    expect(query).toContain("tokenBalances(");
    expect(query).toContain("balance_gt:");
    expect(query).toContain("wallet_not_in:");
    expect(query).toContain('orderBy: "balance"');
    expect(query).toContain('orderDirection: "desc"');

    expect(vars.address).toBe(TOKEN_ADDR.toLowerCase());
    expect(vars.excluded).toEqual([
      "0x0000000000000000000000000000000000000000",
      BONDING_PAIR.toLowerCase(),
      HYPERSWAP_PAIR.toLowerCase(),
    ]);
  });

  it("only excludes the zero address when the token has not yet been indexed", async () => {
    mockPonderQuery.mockResolvedValue({ token: null });
    const app = createApp();
    await app.request(`/holders/${TOKEN_ADDR}`, {}, makeEnv());

    const [, , vars] = mockPonderPaginatedQuery.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(vars.excluded).toEqual(["0x0000000000000000000000000000000000000000"]);
  });

  it("only excludes set pair addresses (drops null hyperswapPair pre-graduation)", async () => {
    mockPonderQuery.mockResolvedValue({
      token: { bondingPair: BONDING_PAIR, hyperswapPair: null },
    });
    const app = createApp();
    await app.request(`/holders/${TOKEN_ADDR}`, {}, makeEnv());

    const [, , vars] = mockPonderPaginatedQuery.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(vars.excluded).toEqual([
      "0x0000000000000000000000000000000000000000",
      BONDING_PAIR.toLowerCase(),
    ]);
  });

  it("returns balances ordered by balance desc with correct percentages", async () => {
    const wallet1 = "0xaaaa000000000000000000000000000000000001";
    const wallet2 = "0xbbbb000000000000000000000000000000000002";
    const wallet3 = "0xcccc000000000000000000000000000000000003";

    mockPonderPaginatedQuery.mockResolvedValue({
      items: [
        { wallet: wallet1, balance: (50_000_000n * ONE).toString() },
        { wallet: wallet2, balance: (10_000_000n * ONE).toString() },
        { wallet: wallet3, balance: (1_000n * ONE).toString() },
      ],
      truncated: false,
    });

    const app = createApp();
    const res = await app.request(`/holders/${TOKEN_ADDR}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: {
        holders: { wallet: string; balance: string; percentage: number }[];
        totalHolders: number;
        approximate: boolean;
      };
    };

    expect(body.status).toBe("success");
    expect(body.data.totalHolders).toBe(3);
    expect(body.data.approximate).toBe(false);
    expect(body.data.holders).toHaveLength(3);
    expect(body.data.holders[0]).toMatchObject({
      wallet: wallet1,
      balance: (50_000_000n * ONE).toString(),
      percentage: 5,
    });
    expect(body.data.holders[1]).toMatchObject({
      wallet: wallet2,
      percentage: 1,
    });
    expect(body.data.holders[2]).toMatchObject({
      wallet: wallet3,
      percentage: 0,
    });
  });

  it("respects the limit query param (capped at 100) without altering totalHolders", async () => {
    const items = Array.from({ length: 150 }, (_, i) => ({
      wallet: `0x${(i + 1).toString(16).padStart(40, "0")}`,
      balance: (BigInt(150 - i) * ONE).toString(),
    }));
    mockPonderPaginatedQuery.mockResolvedValue({ items, truncated: false });

    const app = createApp();
    const res = await app.request(`/holders/${TOKEN_ADDR}?limit=10`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { holders: unknown[]; totalHolders: number };
    };
    expect(body.data.holders).toHaveLength(10);
    expect(body.data.totalHolders).toBe(150);
  });

  it("caps limit at 100 even when a larger value is requested", async () => {
    const items = Array.from({ length: 250 }, (_, i) => ({
      wallet: `0x${(i + 1).toString(16).padStart(40, "0")}`,
      balance: ONE.toString(),
    }));
    mockPonderPaginatedQuery.mockResolvedValue({ items, truncated: false });

    const app = createApp();
    const res = await app.request(`/holders/${TOKEN_ADDR}?limit=500`, {}, makeEnv());

    const body = (await res.json()) as {
      data: { holders: unknown[]; totalHolders: number };
    };
    expect(body.data.holders).toHaveLength(100);
    expect(body.data.totalHolders).toBe(250);
  });

  it("propagates the truncated flag as `approximate`", async () => {
    mockPonderPaginatedQuery.mockResolvedValue({
      items: [
        { wallet: "0xaaaa000000000000000000000000000000000001", balance: ONE.toString() },
      ],
      truncated: true,
    });

    const app = createApp();
    const res = await app.request(`/holders/${TOKEN_ADDR}`, {}, makeEnv());
    const body = (await res.json()) as { data: { approximate: boolean } };
    expect(body.data.approximate).toBe(true);
  });

  it("returns 100% for the rare case of a single holder of full supply", async () => {
    mockPonderPaginatedQuery.mockResolvedValue({
      items: [
        { wallet: "0xaaaa000000000000000000000000000000000001", balance: TOTAL_SUPPLY.toString() },
      ],
      truncated: false,
    });

    const app = createApp();
    const res = await app.request(`/holders/${TOKEN_ADDR}`, {}, makeEnv());
    const body = (await res.json()) as {
      data: { holders: { percentage: number }[] };
    };
    expect(body.data.holders[0].percentage).toBe(100);
  });
});
