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
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  }) as AppBindings;

const createApp = (): Hono<{ Bindings: AppBindings }> => {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/bot/positions", botPositions);
  return app;
};

interface PositionRow {
  token: string;
  ticker: string;
  tokenBalance: string;
  costBasisUsdc: string;
  currentValueUsdc: string;
  realisedPnlUsdc: string;
  totalCostUsdc: string;
  totalProceedsUsdc: string;
}

/**
 * The route now joins `walletBotPositions` against the indexer's
 * `tokenBalance` index to filter phantom positions (router-tracked
 * balance > 0 but the wallet no longer holds any of the token on
 * chain). The fetch is two steps — first the position rows, then a
 * scoped balance query for the open tokens — so the test mock has to
 * route requests to the right response shape. For tests that only care
 * about the cost-basis / PnL math, default the chain balance to the
 * router-tracked balance (no out-of-router disposal) by deriving it
 * from the position rows. Tests that exercise phantom filtering pass
 * an explicit `chainBalances` override.
 */
const mockPositionsAndBalances = (
  positions: unknown[],
  balances: Array<{ tokenAddress: string; balance: string }>,
): void => {
  mockPonderQuery.mockImplementation((query: string) => {
    if (query.includes("walletBotPositions")) {
      return Promise.resolve({ walletBotPositions: { items: positions } });
    }
    if (query.includes("tokenBalances")) {
      return Promise.resolve({ tokenBalances: { items: balances } });
    }
    return Promise.resolve(null);
  });
};

const positionsWithMatchingChainBalances = (rows: PositionRow[]): void => {
  const balances = rows
    .filter((p) => BigInt(p.tokenBalance) > 0n)
    .map((p) => ({ tokenAddress: p.token, balance: p.tokenBalance }));
  mockPositionsAndBalances(rows, balances);
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
    positionsWithMatchingChainBalances([]);
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
    positionsWithMatchingChainBalances([
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
    ]);
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
    positionsWithMatchingChainBalances([
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
    ]);
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
    positionsWithMatchingChainBalances([
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
    ]);
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open[0]!.unrealisedPnlPct).toBeNull();
  });

  it("emits a negative unrealised PnL with leading minus when current value < cost", async () => {
    positionsWithMatchingChainBalances([
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
    ]);
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
    positionsWithMatchingChainBalances([
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
    ]);
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
    positionsWithMatchingChainBalances([
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
    ]);
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
    positionsWithMatchingChainBalances([
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
    ]);
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
    positionsWithMatchingChainBalances([
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
    ]);
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
    positionsWithMatchingChainBalances([
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
    ]);
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
    positionsWithMatchingChainBalances([
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
    ]);
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
    mockPositionsAndBalances(
      [
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
      [{ tokenAddress: TOKEN_A, balance: "1000" }],
    );
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

  it("drops phantom open positions where router-tracked balance > 0 but on-chain balance is 0", async () => {
    // Production regression: `walletBotPosition.tokenBalance` only tracks
    // BotFeeRouter trades, so a wallet that bought via the bot and later
    // disposed of the tokens any other way (direct Transfer, web-app Zap
    // sell, HyperSwap swap) leaves the counter frozen with phantom value.
    // The route must join the indexer's real-balance `tokenBalance` table
    // and hide rows where the wallet no longer holds the token.
    mockPositionsAndBalances(
      [
        {
          token: TOKEN_A,
          ticker: "ONE",
          tokenBalance: "165102332794400000000000000",
          costBasisUsdc: "23690000",
          currentValueUsdc: "25240000",
          realisedPnlUsdc: "0",
          totalCostUsdc: "23690000",
          totalProceedsUsdc: "0",
        },
      ],
      [],
    );
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open).toEqual([]);
  });

  it("keeps realised history for tokens with zero current on-chain balance", async () => {
    // A fully closed-out position has both router-tracked balance = 0 and
    // on-chain balance = 0. The realised row must still surface so the
    // user can see lifetime PnL even after the chain balance hits zero.
    mockPositionsAndBalances(
      [
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
      [],
    );
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open).toEqual([]);
    expect(body.data.realised).toHaveLength(1);
    expect(body.data.realised[0]!.token).toBe(TOKEN_B);
  });

  it("clamps balance and rescales value + cost basis when chain balance is below router-tracked balance", async () => {
    // User bought 2 tokens via the bot ($4 cost basis, $4 indexer snapshot
    // value), then disposed of 1 token off-router (direct Transfer / web
    // Zap sell / HyperSwap swap). The route displays 1 token and rescales
    // BOTH the stale snapshot value AND the cost basis proportionally —
    // average-cost accounting on the remaining half, mirroring the sell
    // handler's own `costBasisUsdc *= remaining / prevBalance` math. The
    // alternative (cost basis frozen at $4 vs rescaled $2 value) would
    // surface a phantom -50% PnL on a position whose per-token cost is
    // actually unchanged.
    mockPositionsAndBalances(
      [
        {
          token: TOKEN_A,
          ticker: "ONE",
          tokenBalance: "2000000000000000000",
          costBasisUsdc: "4000000",
          currentValueUsdc: "4000000",
          realisedPnlUsdc: "0",
          totalCostUsdc: "4000000",
          totalProceedsUsdc: "0",
        },
      ],
      [{ tokenAddress: TOKEN_A, balance: "1000000000000000000" }],
    );
    const res = await createApp().request(
      `/bot/positions/${VALID_WALLET}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open).toHaveLength(1);
    expect(body.data.open[0]!.balance).toBe("1000000000000000000");
    // Snapshot rescales proportionally: $4 × (1 / 2) = $2.
    expect(body.data.open[0]!.currentValueUsdc).toBe("2000000");
    // Cost basis rescales proportionally too: $4 × (1 / 2) = $2.
    expect(body.data.open[0]!.costBasisUsdc).toBe("2000000");
    // Per-token PnL is flat: $2 value vs $2 cost.
    expect(body.data.open[0]!.unrealisedPnlUsdc).toBe("0");
    expect(body.data.open[0]!.unrealisedPnlPct).toBe(0);
  });

  it("preserves cross-channel PnL accuracy when the live mark moved since the off-router disposal", async () => {
    // Regression for the cross-channel PnL bug: user bought 2 tokens via the
    // bot at $2 each ($4 cost), then sold 1 off-router. The bot's view of the
    // remaining 1 token should track its real PnL against the live mark, not
    // inherit the displaced $4 cost basis. Live mark = $3/token, so the
    // displayed position is 1 token worth $3 against $2 rescaled cost — a
    // genuine +$1 / +50% unrealised gain, not the +$1 mark vs $4 stale cost
    // (-$3 / -75%) the un-rescaled cost basis would surface.
    mockPositionsAndBalances(
      [
        {
          token: TOKEN_A,
          ticker: "ONE",
          tokenBalance: "2000000000000000000", // 2 tokens router-tracked
          costBasisUsdc: "4000000", // $4 total cost ($2/token)
          currentValueUsdc: "4000000",
          realisedPnlUsdc: "0",
          totalCostUsdc: "4000000",
          totalProceedsUsdc: "0",
        },
      ],
      // 1 token left on chain after off-router disposal.
      [{ tokenAddress: TOKEN_A, balance: "1000000000000000000" }],
    );
    mockFetchTokensOnchainByAddresses.mockResolvedValue([
      {
        address: TOKEN_A,
        ltToken: "0xaaaa000000000000000000000000000000000000",
        // ratio = 3 → priceUsd = $3 (up from the $2 entry).
        curveSupply: "1000000000000000000",
        ltReserve: "3000000000000000000",
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
    expect(body.data.open[0]!.balance).toBe("1000000000000000000");
    expect(body.data.open[0]!.costBasisUsdc).toBe("2000000"); // rescaled
    expect(body.data.open[0]!.currentValueUsdc).toBe("3000000"); // live mark
    expect(body.data.open[0]!.unrealisedPnlUsdc).toBe("1000000"); // +$1
    expect(body.data.open[0]!.unrealisedPnlPct).toBe(50);
  });

  it("clamps live-mark value to the on-chain balance, not the router-tracked balance", async () => {
    // Live-mark refresh path: clamped balance must flow into the
    // value-from-curve-price multiplication too, otherwise the phantom-
    // half of a partially-disposed position would still inflate value.
    mockPositionsAndBalances(
      [
        {
          token: TOKEN_A,
          ticker: "ONE",
          tokenBalance: "2000000000000000000", // 2 tokens router-tracked
          costBasisUsdc: "4000000",
          currentValueUsdc: "4000000",
          realisedPnlUsdc: "0",
          totalCostUsdc: "4000000",
          totalProceedsUsdc: "0",
        },
      ],
      // Only 1 token held on chain.
      [{ tokenAddress: TOKEN_A, balance: "1000000000000000000" }],
    );
    mockFetchTokensOnchainByAddresses.mockResolvedValue([
      {
        address: TOKEN_A,
        ltToken: "0xaaaa000000000000000000000000000000000000",
        // ratio = 5 → priceUsd = $5
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
    // 1 token × $5 = $5, not 2 × $5 = $10.
    expect(body.data.open[0]!.balance).toBe("1000000000000000000");
    expect(body.data.open[0]!.currentValueUsdc).toBe("5000000");
  });
});
