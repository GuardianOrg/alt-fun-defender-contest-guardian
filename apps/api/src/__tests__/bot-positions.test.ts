import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockPonderQuery = vi.fn();
const mockFetchTokensOnchainByAddresses = vi.fn();
const mockFetchLiveLtRates = vi.fn();

vi.mock("../lib/ponder-client.js", () => ({
  createPonderQuery: () => mockPonderQuery,
}));

vi.mock("../lib/market-data.js", () => ({
  fetchTokensOnchainByAddresses: (...args: unknown[]) =>
    mockFetchTokensOnchainByAddresses(...args),
  fetchLiveLtRates: (...args: unknown[]) => mockFetchLiveLtRates(...args),
}));

const { default: botPositions } = await import("../routes/bot/positions.js");

const VALID_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const TOKEN_A = "0x1111111111111111111111111111111111111111";
const TOKEN_B = "0x2222222222222222222222222222222222222222";

const makeEnv = (): AppBindings =>
  ({
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "http://localhost:42069",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
  }) as AppBindings;

const createApp = (): Hono<{ Bindings: AppBindings }> => {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/bot/positions", botPositions);
  return app;
};

interface PositionsResponseBody {
  data: {
    open: Array<{
      token: string;
      ticker: string;
      balance: string;
      costBasisUsdc: string;
      currentValueUsdc: string;
      unrealisedPnlUsdc: string;
      unrealisedPnlPct: number | null;
    }>;
    realised: Array<{
      token: string;
      ticker: string;
      totalCostUsdc: string;
      totalProceedsUsdc: string;
      realisedPnlUsdc: string;
      realisedPnlPct: number | null;
    }>;
  };
}

describe("GET /bot/positions/:wallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: { items: [] },
    });
    // Default: live mark unavailable → handler falls back to the indexer's
    // stale `currentValueUsdc` snapshot. Tests that exercise the live
    // refresh override these per-case.
    mockFetchTokensOnchainByAddresses.mockResolvedValue([]);
    mockFetchLiveLtRates.mockResolvedValue(new Map<string, number>());
  });

  it("rejects an invalid wallet address", async () => {
    const res = await createApp().request(
      "/bot/positions/not-an-address",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("returns empty open/realised when the indexer has no rows", async () => {
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data).toEqual({ open: [], realised: [] });
  });

  it("collapses indexer outages to empty data rather than 5xx", async () => {
    mockPonderQuery.mockResolvedValue(null);
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data).toEqual({ open: [], realised: [] });
  });

  it("collapses indexer entity-missing GraphQL errors to empty data", async () => {
    // Before the BotFeeRouter indexer migration ships, querying
    // `walletBotPositions` throws a GraphQL "field does not exist"
    // error. Route must absorb that and return empty arrays.
    mockPonderQuery.mockRejectedValue(new Error("Unknown field"));
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data).toEqual({ open: [], realised: [] });
  });

  it("classifies open vs realised by tokenBalance>0 / totalProceeds>0", async () => {
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          // Currently held, never sold → only open.
          {
            token: TOKEN_A,
            ticker: "ONE",
            tokenBalance: "1500000000000000000",
            costBasisUsdc: "20000000",
            currentValueUsdc: "25000000",
            realisedPnlUsdc: "0",
            totalCostUsdc: "20000000",
            totalProceedsUsdc: "0",
          },
          // Fully sold, no current balance → only realised.
          {
            token: TOKEN_B,
            ticker: "TWO",
            tokenBalance: "0",
            costBasisUsdc: "0",
            currentValueUsdc: "0",
            realisedPnlUsdc: "5000000",
            totalCostUsdc: "10000000",
            totalProceedsUsdc: "15000000",
          },
        ],
      },
    });
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open).toHaveLength(1);
    expect(body.data.realised).toHaveLength(1);
    expect(body.data.open[0]!.token).toBe(TOKEN_A);
    expect(body.data.realised[0]!.token).toBe(TOKEN_B);
  });

  it("derives unrealised PnL and percent from cost basis and current value", async () => {
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          {
            token: TOKEN_A,
            ticker: "ONE",
            tokenBalance: "1000",
            costBasisUsdc: "20000000",
            currentValueUsdc: "25000000",
            realisedPnlUsdc: "0",
            totalCostUsdc: "20000000",
            totalProceedsUsdc: "0",
          },
        ],
      },
    });
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open[0]!.unrealisedPnlUsdc).toBe("5000000");
    expect(body.data.open[0]!.unrealisedPnlPct).toBe(25);
  });

  it("renders unrealisedPnlPct as null when cost basis is zero (airdropped position)", async () => {
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          {
            token: TOKEN_A,
            ticker: "ONE",
            tokenBalance: "1000",
            costBasisUsdc: "0",
            currentValueUsdc: "5000000",
            realisedPnlUsdc: "0",
            totalCostUsdc: "0",
            totalProceedsUsdc: "0",
          },
        ],
      },
    });
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open[0]!.unrealisedPnlPct).toBeNull();
  });

  it("emits a negative unrealised PnL with leading minus when current value < cost", async () => {
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          {
            token: TOKEN_A,
            ticker: "ONE",
            tokenBalance: "1000",
            costBasisUsdc: "20000000",
            currentValueUsdc: "12000000",
            realisedPnlUsdc: "0",
            totalCostUsdc: "20000000",
            totalProceedsUsdc: "0",
          },
        ],
      },
    });
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open[0]!.unrealisedPnlUsdc).toBe("-8000000");
    expect(body.data.open[0]!.unrealisedPnlPct).toBe(-40);
  });

  it("sorts open by |unrealised PnL| desc and realised by realised PnL desc", async () => {
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          {
            token: TOKEN_A,
            ticker: "ONE",
            tokenBalance: "1000",
            costBasisUsdc: "10000000",
            currentValueUsdc: "11000000", // +$1
            realisedPnlUsdc: "0",
            totalCostUsdc: "10000000",
            totalProceedsUsdc: "0",
          },
          {
            token: TOKEN_B,
            ticker: "TWO",
            tokenBalance: "1000",
            costBasisUsdc: "10000000",
            currentValueUsdc: "5000000", // -$5
            realisedPnlUsdc: "0",
            totalCostUsdc: "10000000",
            totalProceedsUsdc: "0",
          },
        ],
      },
    });
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open[0]!.token).toBe(TOKEN_B); // |-5| > |+1|
    expect(body.data.open[1]!.token).toBe(TOKEN_A);
  });

  it("overrides indexer-stored currentValueUsdc with the live curve mark", async () => {
    // `walletBotPosition.currentValueUsdc` is written from the wallet's own
    // last router trade and freezes between trades — a fresh buy renders as
    // PnL = 0 / 0% until the wallet trades again. The handler must refresh
    // the mark from the indexer's current `(curveSupply, ltReserve)` + the
    // live LT rate before computing unrealised PnL.
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          {
            token: TOKEN_A,
            ticker: "ONE",
            tokenBalance: "2000000000000000000", // 2 tokens
            costBasisUsdc: "4000000", // $4 cost basis
            // Indexer's stale snapshot = cost basis (just-bought).
            currentValueUsdc: "4000000",
            realisedPnlUsdc: "0",
            totalCostUsdc: "4000000",
            totalProceedsUsdc: "0",
          },
        ],
      },
    });
    mockFetchTokensOnchainByAddresses.mockResolvedValue([
      {
        address: TOKEN_A,
        ltToken: "0xaaaa000000000000000000000000000000000000",
        // ratio = ltReserve / curveSupply = 5/1 = 5
        curveSupply: "1000000000000000000",
        ltReserve: "5000000000000000000",
        k: "0",
        pendingGraduation: false,
        pendingGraduationAt: null,
        graduated: false,
        graduatedAt: null,
        bondingPair: null,
        hyperswapPair: null,
        organicUsdcRaised: "0",
        volumeUsd: "0",
        creatorFeesUsd: "0",
        protocolFeesUsd: "0",
        timestamp: "0",
      },
    ]);
    mockFetchLiveLtRates.mockResolvedValue(
      new Map<string, number>([
        ["0xaaaa000000000000000000000000000000000000", 1],
      ]),
    );
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    // priceUsd = 5; 2 tokens × $5 = $10 = 10_000_000 USDC 6dp.
    expect(body.data.open[0]!.currentValueUsdc).toBe("10000000");
    expect(body.data.open[0]!.unrealisedPnlUsdc).toBe("6000000");
    expect(body.data.open[0]!.unrealisedPnlPct).toBe(150);
  });

  it("preserves sub-microcent-per-token prices without collapsing value to 0", async () => {
    // Regression: bonding curves with billions of token supply routinely price
    // a single token below $1e-6. The previous mark-to-6dp conversion floored
    // those prices to 0 raw USDC, zeroing the position's value and rendering
    // -100% PnL on a healthy $20 position. Live mark must use enough
    // precision (>=18dp) to survive sub-microcent prices.
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          {
            token: TOKEN_A,
            ticker: "CHAOS",
            // 35,890,703 whole tokens (matches a real prod regression case).
            tokenBalance: "35890703000000000000000000",
            costBasisUsdc: "20000000", // $20
            currentValueUsdc: "20000000",
            realisedPnlUsdc: "0",
            totalCostUsdc: "20000000",
            totalProceedsUsdc: "0",
          },
        ],
      },
    });
    mockFetchTokensOnchainByAddresses.mockResolvedValue([
      {
        address: TOKEN_A,
        ltToken: "0xaaaa000000000000000000000000000000000000",
        // ratio = ltReserve / curveSupply = 5.6e-7 → priceUsd = $5.6e-7
        // (at ltRate = 1). Math.floor(5.6e-7 * 1e6) == 0 under the old
        // 6dp scaling — the assertions below would all fail without the fix.
        curveSupply: "1000000000000000000000000000",
        ltReserve: "560000000000000000000",
        k: "0",
        pendingGraduation: false,
        pendingGraduationAt: null,
        graduated: false,
        graduatedAt: null,
        bondingPair: null,
        hyperswapPair: null,
        organicUsdcRaised: "0",
        volumeUsd: "0",
        creatorFeesUsd: "0",
        protocolFeesUsd: "0",
        timestamp: "0",
      },
    ]);
    mockFetchLiveLtRates.mockResolvedValue(
      new Map<string, number>([
        ["0xaaaa000000000000000000000000000000000000", 1],
      ]),
    );
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    // Expected: 35_890_703 tokens × $5.6e-7 ≈ $20.099 = 20_098_793 raw.
    expect(BigInt(body.data.open[0]!.currentValueUsdc)).toBeGreaterThan(
      19_000_000n,
    );
    expect(BigInt(body.data.open[0]!.currentValueUsdc)).toBeLessThan(
      21_000_000n,
    );
    // Within ±5% of cost → pct close to 0, definitely not -100.
    expect(body.data.open[0]!.unrealisedPnlPct).toBeGreaterThan(-5);
    expect(body.data.open[0]!.unrealisedPnlPct).toBeLessThan(5);
  });

  it("falls back to the indexer-stored mark when the live lookup is unavailable", async () => {
    // BounceTech rates API down → live mark is unknown for every token.
    // Better to show a stale snapshot than 503 the whole /positions view.
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          {
            token: TOKEN_A,
            ticker: "ONE",
            tokenBalance: "1000000000000000000",
            costBasisUsdc: "20000000",
            currentValueUsdc: "25000000",
            realisedPnlUsdc: "0",
            totalCostUsdc: "20000000",
            totalProceedsUsdc: "0",
          },
        ],
      },
    });
    mockFetchTokensOnchainByAddresses.mockResolvedValue([
      {
        address: TOKEN_A,
        ltToken: "0xaaaa000000000000000000000000000000000000",
        curveSupply: "1000000000000000000",
        ltReserve: "5000000000000000000",
        k: "0",
        pendingGraduation: false,
        pendingGraduationAt: null,
        graduated: false,
        graduatedAt: null,
        bondingPair: null,
        hyperswapPair: null,
        organicUsdcRaised: "0",
        volumeUsd: "0",
        creatorFeesUsd: "0",
        protocolFeesUsd: "0",
        timestamp: "0",
      },
    ]);
    mockFetchLiveLtRates.mockResolvedValue(null);
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open[0]!.currentValueUsdc).toBe("25000000");
    expect(body.data.open[0]!.unrealisedPnlUsdc).toBe("5000000");
    expect(body.data.open[0]!.unrealisedPnlPct).toBe(25);
  });

  it("falls back to the indexer-stored mark when the live lookup throws", async () => {
    // The internal try/catches in `fetchLiveLtRates` /
    // `fetchTokensOnchainByAddresses` already collapse most failures to a
    // `null` return — but a thrown error from any layer above them (e.g. a
    // BigInt parse failure on a malformed indexer payload) used to wipe
    // both `open` and `realised` to empty arrays via the outer catch. The
    // handler now wraps the refresh in its own try/catch so the snapshot
    // values survive.
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          {
            token: TOKEN_A,
            ticker: "ONE",
            tokenBalance: "1000000000000000000",
            costBasisUsdc: "20000000",
            currentValueUsdc: "25000000",
            realisedPnlUsdc: "0",
            totalCostUsdc: "20000000",
            totalProceedsUsdc: "0",
          },
        ],
      },
    });
    mockFetchTokensOnchainByAddresses.mockResolvedValue([
      {
        address: TOKEN_A,
        ltToken: "0xaaaa000000000000000000000000000000000000",
        curveSupply: "1000000000000000000",
        ltReserve: "5000000000000000000",
        k: "0",
        pendingGraduation: false,
        pendingGraduationAt: null,
        graduated: false,
        graduatedAt: null,
        bondingPair: null,
        hyperswapPair: null,
        organicUsdcRaised: "0",
        volumeUsd: "0",
        creatorFeesUsd: "0",
        protocolFeesUsd: "0",
        timestamp: "0",
      },
    ]);
    mockFetchLiveLtRates.mockRejectedValue(new Error("network down"));
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open).toHaveLength(1);
    expect(body.data.open[0]!.currentValueUsdc).toBe("25000000");
    expect(body.data.open[0]!.unrealisedPnlUsdc).toBe("5000000");
    expect(body.data.open[0]!.unrealisedPnlPct).toBe(25);
  });

  it("uses live mark per-token; tokens absent from the price map keep the stale snapshot", async () => {
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          {
            token: TOKEN_A,
            ticker: "ONE",
            tokenBalance: "1000000000000000000",
            costBasisUsdc: "10000000",
            currentValueUsdc: "10000000", // stale at cost
            realisedPnlUsdc: "0",
            totalCostUsdc: "10000000",
            totalProceedsUsdc: "0",
          },
          {
            token: TOKEN_B,
            ticker: "TWO",
            tokenBalance: "1000000000000000000",
            costBasisUsdc: "10000000",
            currentValueUsdc: "10000000", // stale at cost
            realisedPnlUsdc: "0",
            totalCostUsdc: "10000000",
            totalProceedsUsdc: "0",
          },
        ],
      },
    });
    // Only TOKEN_A appears in the indexer batch (e.g. TOKEN_B's row was
    // dropped because the indexer was reorging it). Handler refreshes A,
    // leaves B on its stale snapshot.
    mockFetchTokensOnchainByAddresses.mockResolvedValue([
      {
        address: TOKEN_A,
        ltToken: "0xaaaa000000000000000000000000000000000000",
        curveSupply: "1000000000000000000",
        ltReserve: "2000000000000000000", // ratio 2 → priceUsd $2
        k: "0",
        pendingGraduation: false,
        pendingGraduationAt: null,
        graduated: false,
        graduatedAt: null,
        bondingPair: null,
        hyperswapPair: null,
        organicUsdcRaised: "0",
        volumeUsd: "0",
        creatorFeesUsd: "0",
        protocolFeesUsd: "0",
        timestamp: "0",
      },
    ]);
    mockFetchLiveLtRates.mockResolvedValue(
      new Map<string, number>([
        ["0xaaaa000000000000000000000000000000000000", 1],
      ]),
    );
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    const byToken = Object.fromEntries(
      body.data.open.map((p) => [p.token.toLowerCase(), p]),
    );
    // TOKEN_A: live mark $2 → cost $10, value $2 → PnL -$8.
    expect(byToken[TOKEN_A.toLowerCase()]!.currentValueUsdc).toBe("2000000");
    expect(byToken[TOKEN_A.toLowerCase()]!.unrealisedPnlUsdc).toBe("-8000000");
    // TOKEN_B: live mark missing → stale value retained.
    expect(byToken[TOKEN_B.toLowerCase()]!.currentValueUsdc).toBe("10000000");
    expect(byToken[TOKEN_B.toLowerCase()]!.unrealisedPnlUsdc).toBe("0");
  });

  it("ignores malformed rows without crashing the response", async () => {
    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [
          null,
          { token: 123 }, // wrong types
          {
            token: TOKEN_A,
            ticker: "ONE",
            tokenBalance: "1000",
            costBasisUsdc: "10000000",
            currentValueUsdc: "11000000",
            realisedPnlUsdc: "0",
            totalCostUsdc: "10000000",
            totalProceedsUsdc: "0",
          },
        ],
      },
    });
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open).toHaveLength(1);
    expect(body.data.open[0]!.token).toBe(TOKEN_A);
  });
});
