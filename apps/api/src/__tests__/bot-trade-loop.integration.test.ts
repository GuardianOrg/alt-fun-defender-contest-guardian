import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

import { createMockDb, createMockEvent } from "../../../indexer/test/mocks/db";
import { clearHandlers, getHandler } from "../../../indexer/test/mocks/ponder";
import {
  botReferrerTrader,
  botRouterTrade,
  referrerStats,
  token,
  walletBotPosition,
} from "../../../indexer/ponder.schema";

// Side-effect import: registers `BotFeeRouter:BotRouterTrade` /
// `BotFeeRouter:ReferralPaid` handlers on the mock ponder registry.
await import("../../../indexer/src/botFeeRouter");

// The API route reads via `createPonderQuery` and may refresh live marks via
// `market-data`. Stub both at module level so the integration test can plug
// the indexer-derived rows in as the GraphQL response.
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
const { default: botReferrals } = await import("../routes/bot/referrals.js");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const TRADER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const REFERRER = "0x1234567890aBcDeF1234567890ABcdef12345678";
const TOKEN_ADDR = "0x1111111111111111111111111111111111111111";

const positionId = `${TRADER.toLowerCase()}-${TOKEN_ADDR.toLowerCase()}`;
const referrerLower = REFERRER.toLowerCase();
const attributionId = `${referrerLower}-${TRADER.toLowerCase()}`;

const makeEnv = (kv: KVNamespace | null = null): AppBindings =>
  ({
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "http://localhost:42069",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    WALLET_KV: kv ?? undefined,
  }) as AppBindings;

const positionsApp = (): Hono<{ Bindings: AppBindings }> => {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/bot/positions", botPositions);
  return app;
};

const referralsApp = (): Hono<{ Bindings: AppBindings }> => {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/bot/referrals", botReferrals);
  return app;
};

/**
 * Live in-memory simulator of Ponder's write API. The shared `createMockDb`
 * captures writes in flat arrays but does not feed them back into `find()`,
 * which is fine for single-event handler tests but doesn't let a follow-up
 * trade observe the state from the previous one. This wrapper records
 * inserts and updates against the same `_setFindResult` map so the handler
 * sees its own prior writes across a multi-event trade sequence — the same
 * shape the real Ponder DB exposes.
 */
function createLiveDb() {
  const db = createMockDb();
  const origInsert = db.insert;
  const origUpdate = db.update;

  db.insert = vi.fn((table: unknown) => {
    const chain = origInsert(table) as ReturnType<typeof origInsert>;
    const origValues = chain.values;
    return {
      values: vi.fn((vals: unknown) => {
        const inner = origValues(vals) as ReturnType<typeof origValues>;
        if (vals && typeof vals === "object") {
          const row = vals as Record<string, unknown>;
          if (typeof row.id === "string") {
            db._setFindResult(table, { id: row.id }, { ...row });
          }
          if (typeof row.address === "string") {
            db._setFindResult(table, { address: row.address }, { ...row });
          }
        }
        return inner;
      }),
    };
  }) as typeof db.insert;

  db.update = vi.fn((table: unknown, key: unknown) => {
    const chain = origUpdate(table, key) as ReturnType<typeof origUpdate>;
    const origSet = chain.set;
    return {
      set: vi.fn(async (vals: unknown) => {
        const result = origSet(vals);
        // Merge update into the latest-known row state so subsequent
        // `find(table, key)` calls reflect the write.
        const existing =
          ((await db.find(table, key)) as Record<string, unknown> | null) ??
          null;
        if (existing && vals && typeof vals === "object") {
          db._setFindResult(table, key, {
            ...existing,
            ...(vals as Record<string, unknown>),
          });
        }
        return result;
      }),
    };
  }) as typeof db.update;

  return db;
}

/**
 * Read the final state of a (table, key) pair after all writes in the
 * handler have run. Mirrors how the route's GraphQL query would read it.
 */
async function snapshot(
  db: ReturnType<typeof createLiveDb>,
  table: unknown,
  key: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  const row = (await db.find(table, key)) as Record<string, unknown> | null;
  return row;
}

/**
 * Ponder's GraphQL serialises `bigint` columns as decimal strings and
 * `integer` columns as numbers. Apply the same rule before plugging an
 * in-memory row in as a `walletBotPositions.items[]` entry so the API
 * route's `BigInt(item.tokenBalance)` parse paths line up with what
 * production traffic sees.
 */
function serialiseRow(
  row: Record<string, unknown>,
  bigintFields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] =
      bigintFields.includes(k) && typeof v === "bigint" ? v.toString() : v;
  }
  return out;
}

const POSITION_BIGINTS = [
  "tokenBalance",
  "costBasisUsdc",
  "currentValueUsdc",
  "realisedPnlUsdc",
  "totalCostUsdc",
  "totalProceedsUsdc",
] as const;

const REFERRER_BIGINTS = ["lifetimeEarnedUsdc"] as const;

function buyEvent(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof createMockEvent> {
  return createMockEvent({
    args: {
      trader: TRADER,
      token: TOKEN_ADDR,
      side: 0,
      usdcAmount: 20_000_000n, // $20
      tokenAmount: 1_000_000_000_000_000_000n, // 1 token
      botFee: 100_000n,
      referrer: ZERO_ADDRESS,
      referrerCut: 0n,
      treasuryCut: 100_000n,
      ...overrides,
    },
    blockNumber: 100n,
    blockTimestamp: 1700000000n,
    txHash: "0xbuy",
    logIndex: 0,
  });
}

function sellEvent(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof createMockEvent> {
  return createMockEvent({
    args: {
      trader: TRADER,
      token: TOKEN_ADDR,
      side: 1,
      usdcAmount: 25_000_000n,
      tokenAmount: 1_000_000_000_000_000_000n,
      botFee: 125_000n,
      referrer: ZERO_ADDRESS,
      referrerCut: 0n,
      treasuryCut: 125_000n,
      ...overrides,
    },
    blockNumber: 110n,
    blockTimestamp: 1700000100n,
    txHash: "0xsell",
    logIndex: 0,
  });
}

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

interface ReferralsResponseBody {
  data: {
    rewardsWallet: string;
    referredCount: number;
    lifetimeEarnedUsdc: string;
    badPaymentCount: number;
    attributionLossCount: number;
  };
}

/**
 * Cross-layer integration test for the bot's trade-to-position/referral loop.
 *
 * The unit tests on either side prove that:
 *   - the indexer handler writes the right rows for a `BotRouterTrade` event
 *     (apps/indexer/test/botFeeRouter.test.ts), and
 *   - the API route shapes a (canned) indexer response correctly
 *     (apps/api/src/__tests__/bot-positions.test.ts + bot-referrals.test.ts).
 *
 * Neither side proves the contract *between* them — silently divergent
 * field names, units, or sign conventions would slip through both suites.
 * This test runs the real indexer handler against a sequence of events,
 * captures the resulting `walletBotPosition` / `referrerStats` row, serialises
 * it the way Ponder's GraphQL layer would, plugs that into the API route, and
 * asserts the user-facing response matches the original on-chain event.
 *
 * Closes the gap flagged in the bot AGENTS.md verification section: "confirm
 * `GET /api/v1/bot/positions/:wallet` reflects the new position with cost
 * basis equal to the gross USDC spent (i.e. bot fee included)".
 */
describe("BotRouterTrade → /api/v1/bot/positions (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchTokensOnchainByAddresses.mockResolvedValue([]);
    mockFetchLiveLtRates.mockResolvedValue(new Map<string, number>());
  });

  it("buy event lands as an open position with cost basis = gross USDC", async () => {
    const db = createLiveDb();
    db._setFindResult(
      token,
      { address: TOKEN_ADDR },
      { address: TOKEN_ADDR, symbol: "TKN" },
    );

    const handler = getHandler("BotFeeRouter:BotRouterTrade");
    await handler({ event: buyEvent(), context: { db } });

    const row = await snapshot(db, walletBotPosition, { id: positionId });
    expect(row).not.toBeNull();
    // Sanity: the indexer wrote the (wallet, token) row before we hand it to
    // the API. The point of this test is the *cross-layer* check, but if this
    // ever fails the unit test on the indexer side is the right place to look.
    expect(row).toMatchObject({
      tokenBalance: 1_000_000_000_000_000_000n,
      costBasisUsdc: 20_000_000n,
    });

    const archive = db._insertCalls.find((c) => c.table === botRouterTrade);
    expect(archive).toBeDefined();

    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [serialiseRow(row!, POSITION_BIGINTS)],
      },
      tokenBalances: {
        items: [
          {
            tokenAddress: TOKEN_ADDR,
            balance: (row!.tokenBalance as bigint).toString(),
          },
        ],
      },
    });

    const res = await positionsApp().request(
      `/bot/positions/${TRADER}`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PositionsResponseBody;

    expect(body.data.open).toHaveLength(1);
    expect(body.data.open[0]).toMatchObject({
      token: TOKEN_ADDR,
      ticker: "TKN",
      balance: "1000000000000000000",
      // $20 gross USDC spent → cost basis $20 (bot fee already included, per
      // the AGENTS.md spec on /positions).
      costBasisUsdc: "20000000",
      currentValueUsdc: "20000000",
      unrealisedPnlUsdc: "0",
      unrealisedPnlPct: 0,
    });
    expect(body.data.realised).toEqual([]);
  });

  it("buy + full sell lands as a realised position with PnL = proceeds − cost", async () => {
    const db = createLiveDb();
    db._setFindResult(
      token,
      { address: TOKEN_ADDR },
      { address: TOKEN_ADDR, symbol: "TKN" },
    );

    const handler = getHandler("BotFeeRouter:BotRouterTrade");
    await handler({ event: buyEvent(), context: { db } });
    await handler({ event: sellEvent(), context: { db } });

    const row = await snapshot(db, walletBotPosition, { id: positionId });
    expect(row).toMatchObject({
      tokenBalance: 0n,
      costBasisUsdc: 0n,
      // $25 proceeds − $20 cost = $5 realised PnL.
      realisedPnlUsdc: 5_000_000n,
      totalCostUsdc: 20_000_000n,
      totalProceedsUsdc: 25_000_000n,
    });

    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [serialiseRow(row!, POSITION_BIGINTS)],
      },
      tokenBalances: {
        items: [
          {
            tokenAddress: TOKEN_ADDR,
            balance: (row!.tokenBalance as bigint).toString(),
          },
        ],
      },
    });

    const res = await positionsApp().request(
      `/bot/positions/${TRADER}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;

    expect(body.data.open).toEqual([]);
    expect(body.data.realised).toHaveLength(1);
    expect(body.data.realised[0]).toMatchObject({
      token: TOKEN_ADDR,
      ticker: "TKN",
      totalCostUsdc: "20000000",
      totalProceedsUsdc: "25000000",
      realisedPnlUsdc: "5000000",
      // 25 % gain on a $20 cost basis.
      realisedPnlPct: 25,
    });
  });

  it("buy + partial sell keeps the open half and adds a realised half", async () => {
    const db = createLiveDb();
    db._setFindResult(
      token,
      { address: TOKEN_ADDR },
      { address: TOKEN_ADDR, symbol: "TKN" },
    );

    const handler = getHandler("BotFeeRouter:BotRouterTrade");
    // Two $20 buys → 2 tokens for $40 cost basis.
    await handler({ event: buyEvent(), context: { db } });
    await handler({
      event: createMockEvent({
        args: {
          trader: TRADER,
          token: TOKEN_ADDR,
          side: 0,
          usdcAmount: 20_000_000n,
          tokenAmount: 1_000_000_000_000_000_000n,
          botFee: 100_000n,
          referrer: ZERO_ADDRESS,
          referrerCut: 0n,
          treasuryCut: 100_000n,
        },
        blockNumber: 105n,
        blockTimestamp: 1700000050n,
        txHash: "0xbuy2",
        logIndex: 0,
      }),
      context: { db },
    });
    // Sell 1 of 2 for $25.
    await handler({ event: sellEvent(), context: { db } });

    const row = await snapshot(db, walletBotPosition, { id: positionId });
    expect(row).toMatchObject({
      tokenBalance: 1_000_000_000_000_000_000n,
      costBasisUsdc: 20_000_000n, // half of original $40
      realisedPnlUsdc: 5_000_000n, // $25 − $20 (proportional cost)
      totalProceedsUsdc: 25_000_000n,
    });

    mockPonderQuery.mockResolvedValue({
      walletBotPositions: {
        items: [serialiseRow(row!, POSITION_BIGINTS)],
      },
      tokenBalances: {
        items: [
          {
            tokenAddress: TOKEN_ADDR,
            balance: (row!.tokenBalance as bigint).toString(),
          },
        ],
      },
    });

    const res = await positionsApp().request(
      `/bot/positions/${TRADER}`,
      {},
      makeEnv(),
    );
    const body = (await res.json()) as PositionsResponseBody;
    expect(body.data.open).toHaveLength(1);
    expect(body.data.realised).toHaveLength(1);
    expect(body.data.open[0]!.costBasisUsdc).toBe("20000000");
    expect(body.data.realised[0]!.realisedPnlUsdc).toBe("5000000");
  });
});

describe("BotRouterTrade + ReferralPaid → /api/v1/bot/referrals (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchTokensOnchainByAddresses.mockResolvedValue([]);
    mockFetchLiveLtRates.mockResolvedValue(new Map<string, number>());
  });

  it("trade with referrer + matching ReferralPaid populates referrerStats", async () => {
    const db = createLiveDb();
    db._setFindResult(
      token,
      { address: TOKEN_ADDR },
      { address: TOKEN_ADDR, symbol: "TKN" },
    );

    const tradeHandler = getHandler("BotFeeRouter:BotRouterTrade");
    const paidHandler = getHandler("BotFeeRouter:ReferralPaid");

    // Buy attributed to REFERRER: 20% of bot fee = 20_000 USDC raw.
    await tradeHandler({
      event: buyEvent({
        referrer: REFERRER,
        referrerCut: 20_000n,
        treasuryCut: 80_000n,
      }),
      context: { db },
    });
    // Router emits ReferralPaid alongside BotRouterTrade when the transfer
    // succeeded — confirm the indexer's `lifetimeEarnedUsdc` accumulator
    // picks it up.
    await paidHandler({
      event: createMockEvent({
        args: {
          referrer: REFERRER,
          user: TRADER,
          amount: 20_000n,
          token: TOKEN_ADDR,
          side: 0,
        },
        blockNumber: 100n,
        blockTimestamp: 1700000000n,
        txHash: "0xbuy",
        logIndex: 1,
      }),
      context: { db },
    });

    const attribution = await snapshot(db, botReferrerTrader, {
      id: attributionId,
    });
    expect(attribution).not.toBeNull();

    const stats = await snapshot(db, referrerStats, { id: referrerLower });
    expect(stats).toMatchObject({
      referrer: REFERRER,
      referredCount: 1,
      lifetimeEarnedUsdc: 20_000n,
      badPaymentCount: 0,
    });

    // The API GETs `referrerStats(id: rewardsWallet)` — feed the same row
    // back as the GraphQL response, with bigints stringified the way Ponder
    // would over the wire.
    const serialised = serialiseRow(stats!, REFERRER_BIGINTS);
    mockPonderQuery.mockResolvedValue({ referrerStats: serialised });

    const kv = makeKv();
    const res = await referralsApp().request(
      `/bot/referrals/${REFERRER}`,
      {},
      makeEnv(kv),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReferralsResponseBody;
    expect(body.data).toMatchObject({
      rewardsWallet: REFERRER.toLowerCase(),
      referredCount: 1,
      lifetimeEarnedUsdc: "20000",
      badPaymentCount: 0,
      attributionLossCount: 0,
    });
  });

  it("repeat trade by the same trader does not double-count referredCount", async () => {
    const db = createLiveDb();
    db._setFindResult(
      token,
      { address: TOKEN_ADDR },
      { address: TOKEN_ADDR, symbol: "TKN" },
    );

    const tradeHandler = getHandler("BotFeeRouter:BotRouterTrade");
    const paidHandler = getHandler("BotFeeRouter:ReferralPaid");

    await tradeHandler({
      event: buyEvent({
        referrer: REFERRER,
        referrerCut: 20_000n,
        treasuryCut: 80_000n,
      }),
      context: { db },
    });
    await paidHandler({
      event: createMockEvent({
        args: {
          referrer: REFERRER,
          user: TRADER,
          amount: 20_000n,
          token: TOKEN_ADDR,
          side: 0,
        },
        txHash: "0xbuy",
        logIndex: 1,
      }),
      context: { db },
    });

    // Same trader trades again — referredCount must stay at 1, lifetime earned
    // must accumulate to 40_000. `buyEvent` only spreads overrides into
    // `event.args`, so reusing it would land the same `txHash` / `logIndex`
    // pair as the first trade and `botRouterTrade.id = ${tx}-${log}` would
    // collide (insert silently no-ops under `onConflictDoNothing`). Construct
    // the event inline so the second trade carries a distinct identity.
    await tradeHandler({
      event: createMockEvent({
        args: {
          trader: TRADER,
          token: TOKEN_ADDR,
          side: 0,
          usdcAmount: 20_000_000n,
          tokenAmount: 1_000_000_000_000_000_000n,
          botFee: 100_000n,
          referrer: REFERRER,
          referrerCut: 20_000n,
          treasuryCut: 80_000n,
        },
        blockNumber: 105n,
        blockTimestamp: 1700000050n,
        txHash: "0xbuy2",
        logIndex: 0,
      }),
      context: { db },
    });
    await paidHandler({
      event: createMockEvent({
        args: {
          referrer: REFERRER,
          user: TRADER,
          amount: 20_000n,
          token: TOKEN_ADDR,
          side: 0,
        },
        txHash: "0xbuy2",
        logIndex: 1,
      }),
      context: { db },
    });

    const stats = await snapshot(db, referrerStats, { id: referrerLower });
    expect(stats).toMatchObject({
      referredCount: 1,
      lifetimeEarnedUsdc: 40_000n,
    });

    const serialised = serialiseRow(stats!, REFERRER_BIGINTS);
    mockPonderQuery.mockResolvedValue({ referrerStats: serialised });

    const kv = makeKv();
    const res = await referralsApp().request(
      `/bot/referrals/${REFERRER}`,
      {},
      makeEnv(kv),
    );
    const body = (await res.json()) as ReferralsResponseBody;
    expect(body.data.referredCount).toBe(1);
    expect(body.data.lifetimeEarnedUsdc).toBe("40000");
  });

  it("bad-rewards-wallet trade surfaces as a /referral banner counter", async () => {
    const db = createLiveDb();
    db._setFindResult(
      token,
      { address: TOKEN_ADDR },
      { address: TOKEN_ADDR, symbol: "TKN" },
    );

    const tradeHandler = getHandler("BotFeeRouter:BotRouterTrade");
    // Referrer set but transfer failed → router emits BotRouterTrade with
    // referrerCut=0 and the full bot fee routed to treasury. No ReferralPaid.
    await tradeHandler({
      event: buyEvent({
        referrer: REFERRER,
        referrerCut: 0n,
        treasuryCut: 100_000n,
      }),
      context: { db },
    });

    const stats = await snapshot(db, referrerStats, { id: referrerLower });
    expect(stats).toMatchObject({
      referredCount: 1,
      lifetimeEarnedUsdc: 0n,
      badPaymentCount: 1,
    });

    const serialised = serialiseRow(stats!, REFERRER_BIGINTS);
    mockPonderQuery.mockResolvedValue({ referrerStats: serialised });

    const kv = makeKv();
    const res = await referralsApp().request(
      `/bot/referrals/${REFERRER}`,
      {},
      makeEnv(kv),
    );
    const body = (await res.json()) as ReferralsResponseBody;
    expect(body.data.badPaymentCount).toBe(1);
    expect(body.data.lifetimeEarnedUsdc).toBe("0");
  });
});

function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

// Keep the test isolated from any future test file that also imports the
// botFeeRouter module by clearing the singleton handler registry on exit.
// Vitest tears each worker down between files but explicit cleanup keeps the
// behaviour deterministic if these tests ever share a worker.
afterAll(() => {
  clearHandlers();
});
