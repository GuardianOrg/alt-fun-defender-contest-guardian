import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockPonderQuery = vi.fn();
const mockPonderPaginatedQuery = vi.fn();

vi.mock("../lib/ponder-client.js", () => ({
  createPonderQuery: () => mockPonderQuery,
  createPonderPaginatedQuery: () => mockPonderPaginatedQuery,
}));

const mockDbWhere = vi.fn().mockResolvedValue([]);
const mockDbSelect = vi.fn().mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: mockDbWhere,
  }),
});

vi.mock("../db/client.js", () => ({
  createDb: () => ({ select: mockDbSelect }),
}));

const { default: balancesRoute } = await import("../routes/balances.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/balances", balancesRoute);
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

describe("GET /balances/:wallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPonderQuery.mockResolvedValue({ __typename: "Query" });
  });

  it("returns 400 for invalid address", async () => {
    const app = createApp();
    const res = await app.request("/balances/not-an-address", {}, makeEnv());

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toBe("Invalid wallet address");
  });

  it("returns 503 when indexer is unavailable", async () => {
    mockPonderQuery.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request(`/balances/${VALID_WALLET}`, {}, makeEnv());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Indexer unavailable");
  });

  it("returns empty array when wallet holds no tokens", async () => {
    mockPonderPaginatedQuery.mockResolvedValue({ items: [], truncated: false });

    const app = createApp();
    const res = await app.request(`/balances/${VALID_WALLET}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; data: unknown[] };
    expect(body.status).toBe("success");
    expect(body.data).toEqual([]);
  });

  it("filters out tokens not found in the database", async () => {
    mockPonderPaginatedQuery.mockResolvedValue({
      items: [{ tokenAddress: TOKEN_ADDR, balance: "1000000000000000000000" }],
      truncated: false,
    });
    mockDbWhere.mockResolvedValue([]);

    const app = createApp();
    const res = await app.request(`/balances/${VALID_WALLET}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it("surfaces hidden-token positions so holders can sell out (issue #712)", async () => {
    // Pre-#712 the route filtered `isHidden = false`, which made it
    // impossible for a wallet still holding an admin-hidden token to see
    // (let alone sell) that position. The endpoint is wallet-scoped via
    // Ponder's `tokenBalances`, so leaving hidden rows in the response
    // can only ever surface tokens the caller already holds on-chain —
    // no information leak. The row is tagged `isHidden: true` so the UI
    // can render the policy-violation disclaimer and disable buys.
    mockPonderPaginatedQuery.mockResolvedValue({
      items: [{ tokenAddress: TOKEN_ADDR, balance: "5000000000000000000000000" }],
      truncated: false,
    });
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

    const app = createApp();
    const res = await app.request(`/balances/${VALID_WALLET}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: Record<string, unknown>[];
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      ticker: "BAN",
      isHidden: true,
      balance: "5000000000000000000000000",
    });
  });

  it("returns enriched balances on happy path", async () => {
    mockPonderPaginatedQuery.mockResolvedValue({
      items: [{ tokenAddress: TOKEN_ADDR, balance: "5000000000000000000000000" }],
      truncated: false,
    });
    mockDbWhere.mockResolvedValue([
      {
        address: TOKEN_ADDR,
        name: "PURR",
        ticker: "PURR",
        imageUrl: "/images/purr.png",
        ltPair: "0xabc",
        leverage: 2,
        underlying: "HYPE",
        ltDirection: "long",
        isHidden: false,
      },
    ]);

    const app = createApp();
    const res = await app.request(`/balances/${VALID_WALLET}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; data: Record<string, unknown>[] };
    expect(body.status).toBe("success");
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      name: "PURR",
      ticker: "PURR",
      leverage: 2,
      underlying: "HYPE",
      ltDirection: "long",
      isHidden: false,
      balance: "5000000000000000000000000",
    });
  });

  it("handles mixed known and unknown tokens", async () => {
    const unknownToken = "0x1111111111111111111111111111111111111111";
    mockPonderPaginatedQuery.mockResolvedValue({
      items: [
        { tokenAddress: TOKEN_ADDR, balance: "1000000000000000000" },
        { tokenAddress: unknownToken, balance: "2000000000000000000" },
      ],
      truncated: false,
    });
    mockDbWhere.mockResolvedValue([
      {
        address: TOKEN_ADDR,
        name: "PURR",
        ticker: "PURR",
        imageUrl: "",
        ltPair: "0xabc",
        leverage: 2,
        underlying: "HYPE",
        ltDirection: "long",
        isHidden: false,
      },
    ]);

    const app = createApp();
    const res = await app.request(`/balances/${VALID_WALLET}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; data: Record<string, unknown>[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("PURR");
  });
});
