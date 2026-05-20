import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockFetchHolders = vi.fn();
const mockFetchTokenPairAddresses = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchHolders: (...args: unknown[]) => mockFetchHolders(...args),
  fetchTokenPairAddresses: (...args: unknown[]) =>
    mockFetchTokenPairAddresses(...args),
}));

vi.mock("../db/client.js", () => ({
  createDb: () => ({}),
}));

const { default: holdersRoute } = await import("../routes/holders.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/holders", holdersRoute);
  return app;
}

function makeEnv(): AppBindings {
  return {
    HYPERDRIVE: { connectionString: "postgres://hyperdrive-test" } as unknown as Hyperdrive,
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

import { CONTRACT_ADDRESSES } from "@launchpad/shared";

const TOKEN_ADDR = "0x4DFB6bebbdF9d5ea76123729E0b3a823f9c3ecC0";
const BONDING_PAIR = "0x1111111111111111111111111111111111111111";
const HYPERSWAP_PAIR = "0x2222222222222222222222222222222222222222";
const BONDING_ADDRESS = CONTRACT_ADDRESSES.bonding.toLowerCase();

const ONE = 10n ** 18n;
const ONE_BILLION = 1_000_000_000n;
const TOTAL_SUPPLY = ONE_BILLION * ONE;

describe("GET /holders/:address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchTokenPairAddresses.mockResolvedValue({
      bondingPair: BONDING_PAIR,
      hyperswapPair: HYPERSWAP_PAIR,
    });
    mockFetchHolders.mockResolvedValue({ holders: [], totalHolders: 0 });
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
    const res = await app.request(
      `/holders/${TOKEN_ADDR}?limit=abc`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 503 when the pair-address resolution errors", async () => {
    mockFetchTokenPairAddresses.mockResolvedValue("error");
    const app = createApp();
    const res = await app.request(`/holders/${TOKEN_ADDR}`, {}, makeEnv());
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string | null };
    expect(body.error).toContain("Indexer unavailable");
  });

  it("returns 503 when the holders read errors", async () => {
    mockFetchHolders.mockResolvedValue(null);
    const app = createApp();
    const res = await app.request(`/holders/${TOKEN_ADDR}`, {}, makeEnv());
    expect(res.status).toBe(503);
  });

  it("queries the holders read with the bonding proxy + bonding/hyperswap pairs + zero address excluded", async () => {
    const app = createApp();
    await app.request(`/holders/${TOKEN_ADDR}`, {}, makeEnv());

    expect(mockFetchHolders).toHaveBeenCalledTimes(1);
    const [, opts] = mockFetchHolders.mock.calls[0] as [
      unknown,
      {
        tokenAddress: string;
        limit: number;
        excludedWallets: string[];
      },
    ];

    expect(opts.tokenAddress).toBe(TOKEN_ADDR.toLowerCase());
    expect(opts.excludedWallets).toEqual([
      "0x0000000000000000000000000000000000000000",
      BONDING_ADDRESS,
      BONDING_PAIR.toLowerCase(),
      HYPERSWAP_PAIR.toLowerCase(),
    ]);
  });

  it("only excludes zero address and bonding proxy when the token has not yet been indexed", async () => {
    mockFetchTokenPairAddresses.mockResolvedValue("missing");
    const app = createApp();
    await app.request(`/holders/${TOKEN_ADDR}`, {}, makeEnv());

    const [, opts] = mockFetchHolders.mock.calls[0] as [
      unknown,
      { excludedWallets: string[] },
    ];
    expect(opts.excludedWallets).toEqual([
      "0x0000000000000000000000000000000000000000",
      BONDING_ADDRESS,
    ]);
  });

  it("only excludes set pair addresses (drops null hyperswapPair pre-graduation)", async () => {
    mockFetchTokenPairAddresses.mockResolvedValue({
      bondingPair: BONDING_PAIR,
      hyperswapPair: null,
    });
    const app = createApp();
    await app.request(`/holders/${TOKEN_ADDR}`, {}, makeEnv());

    const [, opts] = mockFetchHolders.mock.calls[0] as [
      unknown,
      { excludedWallets: string[] },
    ];
    expect(opts.excludedWallets).toEqual([
      "0x0000000000000000000000000000000000000000",
      BONDING_ADDRESS,
      BONDING_PAIR.toLowerCase(),
    ]);
  });

  it("returns balances ordered by balance desc with correct percentages", async () => {
    const wallet1 = "0xaaaa000000000000000000000000000000000001";
    const wallet2 = "0xbbbb000000000000000000000000000000000002";
    const wallet3 = "0xcccc000000000000000000000000000000000003";

    mockFetchHolders.mockResolvedValue({
      holders: [
        { wallet: wallet1, balance: (50_000_000n * ONE).toString() },
        { wallet: wallet2, balance: (10_000_000n * ONE).toString() },
        { wallet: wallet3, balance: (1_000n * ONE).toString() },
      ],
      totalHolders: 3,
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
    // The route caps `limit` at 100 before calling `fetchHolders`. We
    // assert the cap by inspecting the args, then return a representative
    // page so the response shape can be checked too.
    mockFetchHolders.mockResolvedValue({
      holders: Array.from({ length: 10 }, (_, i) => ({
        wallet: `0x${(i + 1).toString(16).padStart(40, "0")}`,
        balance: (BigInt(10 - i) * ONE).toString(),
      })),
      totalHolders: 150,
    });

    const app = createApp();
    const res = await app.request(
      `/holders/${TOKEN_ADDR}?limit=10`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const [, opts] = mockFetchHolders.mock.calls[0] as [
      unknown,
      { limit: number },
    ];
    expect(opts.limit).toBe(10);

    const body = (await res.json()) as {
      data: { holders: unknown[]; totalHolders: number };
    };
    expect(body.data.holders).toHaveLength(10);
    expect(body.data.totalHolders).toBe(150);
  });

  it("caps limit at 100 even when a larger value is requested", async () => {
    mockFetchHolders.mockResolvedValue({
      holders: Array.from({ length: 100 }, (_, i) => ({
        wallet: `0x${(i + 1).toString(16).padStart(40, "0")}`,
        balance: ONE.toString(),
      })),
      totalHolders: 250,
    });

    const app = createApp();
    const res = await app.request(
      `/holders/${TOKEN_ADDR}?limit=500`,
      {},
      makeEnv(),
    );

    const [, opts] = mockFetchHolders.mock.calls[0] as [
      unknown,
      { limit: number },
    ];
    expect(opts.limit).toBe(100);

    const body = (await res.json()) as {
      data: { holders: unknown[]; totalHolders: number };
    };
    expect(body.data.holders).toHaveLength(100);
    expect(body.data.totalHolders).toBe(250);
  });

  it("always returns `approximate: false` — direct SQL count is exact", async () => {
    mockFetchHolders.mockResolvedValue({
      holders: [
        {
          wallet: "0xaaaa000000000000000000000000000000000001",
          balance: ONE.toString(),
        },
      ],
      totalHolders: 1,
    });

    const app = createApp();
    const res = await app.request(`/holders/${TOKEN_ADDR}`, {}, makeEnv());
    const body = (await res.json()) as { data: { approximate: boolean } };
    expect(body.data.approximate).toBe(false);
  });

  it("filters out zero-balance rows the indexer may surface (issue #421)", async () => {
    const wallet1 = "0xaaaa000000000000000000000000000000000001";
    const wallet2 = "0xbbbb000000000000000000000000000000000002";
    const wallet3 = "0xcccc000000000000000000000000000000000003";

    mockFetchHolders.mockResolvedValue({
      holders: [
        { wallet: wallet1, balance: (50_000_000n * ONE).toString() },
        { wallet: wallet2, balance: "0" },
        { wallet: wallet3, balance: (1_000n * ONE).toString() },
      ],
      // `totalHolders` comes from the SQL aggregation which already
      // filters `balance > 0`, so the route trusts it verbatim. The
      // post-fetch zero filter is purely a defence against malformed
      // rows; it does not subtract from `totalHolders`.
      totalHolders: 3,
    });

    const app = createApp();
    const res = await app.request(`/holders/${TOKEN_ADDR}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        holders: { wallet: string; balance: string }[];
        totalHolders: number;
      };
    };

    expect(body.data.holders).toHaveLength(2);
    expect(body.data.holders.map((h) => h.wallet)).toEqual([wallet1, wallet3]);
  });

  it("skips rows with malformed balance strings rather than 500-ing the route", async () => {
    const wallet1 = "0xaaaa000000000000000000000000000000000001";
    const wallet2 = "0xbbbb000000000000000000000000000000000002";

    mockFetchHolders.mockResolvedValue({
      holders: [
        { wallet: wallet1, balance: (10n * ONE).toString() },
        { wallet: wallet2, balance: "not-a-bigint" },
      ],
      totalHolders: 2,
    });

    const app = createApp();
    const res = await app.request(`/holders/${TOKEN_ADDR}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        holders: { wallet: string }[];
        totalHolders: number;
      };
    };

    expect(body.data.holders).toHaveLength(1);
    expect(body.data.holders[0].wallet).toBe(wallet1);
  });

  it("returns 100% for the rare case of a single holder of full supply", async () => {
    mockFetchHolders.mockResolvedValue({
      holders: [
        {
          wallet: "0xaaaa000000000000000000000000000000000001",
          balance: TOTAL_SUPPLY.toString(),
        },
      ],
      totalHolders: 1,
    });

    const app = createApp();
    const res = await app.request(`/holders/${TOKEN_ADDR}`, {}, makeEnv());
    const body = (await res.json()) as {
      data: { holders: { percentage: number }[] };
    };
    expect(body.data.holders[0].percentage).toBe(100);
  });
});
