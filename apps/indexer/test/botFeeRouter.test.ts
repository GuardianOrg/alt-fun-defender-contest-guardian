import { describe, it, expect, beforeEach } from "vitest";
import { getHandler } from "./mocks/ponder";
import { createMockDb, createMockEvent } from "./mocks/db";
import {
  botReferrerTrader,
  botRouterTrade,
  referrerStats,
  token,
  walletBotPosition,
} from "../ponder.schema";

await import("../src/botFeeRouter");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const TRADER = "0xtrader1";
const TOKEN = "0xtoken1";
const REFERRER = "0xreferrer1";
const positionId = `${TRADER.toLowerCase()}-${TOKEN.toLowerCase()}`;

/** Helper: build a BotRouterTrade event with sensible defaults. */
function buyEvent(overrides: Record<string, unknown> = {}) {
  return createMockEvent({
    args: {
      trader: TRADER,
      token: TOKEN,
      side: 0,
      usdcAmount: 20_000_000n, // $20 USDC (6dp)
      tokenAmount: 1_000_000_000_000_000_000n, // 1 token (18dp)
      botFee: 100_000n, // 0.5% of $20 = $0.10
      referrer: ZERO_ADDRESS,
      referrerCut: 0n,
      treasuryCut: 100_000n,
      ...overrides,
    },
    blockNumber: 100n,
    blockTimestamp: 1700000000n,
    txHash: "0xhash-buy",
    logIndex: 0,
  });
}

function sellEvent(overrides: Record<string, unknown> = {}) {
  return createMockEvent({
    args: {
      trader: TRADER,
      token: TOKEN,
      side: 1,
      usdcAmount: 25_000_000n, // $25 USDC gross out (6dp)
      tokenAmount: 1_000_000_000_000_000_000n, // selling 1 token (18dp)
      botFee: 125_000n,
      referrer: ZERO_ADDRESS,
      referrerCut: 0n,
      treasuryCut: 125_000n,
      ...overrides,
    },
    blockNumber: 110n,
    blockTimestamp: 1700000100n,
    txHash: "0xhash-sell",
    logIndex: 0,
  });
}

describe("BotFeeRouter:BotRouterTrade — buys", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("inserts a botRouterTrade row and a fresh walletBotPosition with buy state", async () => {
    db._setFindResult(token, { address: TOKEN }, {
      address: TOKEN,
      symbol: "TKN",
    });
    const handler = getHandler("BotFeeRouter:BotRouterTrade");

    await handler({ event: buyEvent(), context: { db } });

    const tradeInsert = db._insertCalls.find((c) => c.table === botRouterTrade);
    expect(tradeInsert).toBeDefined();
    expect(tradeInsert!.values).toMatchObject({
      tokenAddress: TOKEN,
      trader: TRADER,
      isBuy: true,
      usdcAmount: 20_000_000n,
      tokenAmount: 1_000_000_000_000_000_000n,
      botFee: 100_000n,
      referrer: ZERO_ADDRESS,
      referrerCut: 0n,
      treasuryCut: 100_000n,
    });

    const positionInsert = db._insertCalls.find(
      (c) => c.table === walletBotPosition,
    );
    expect(positionInsert).toBeDefined();
    expect(positionInsert!.values).toMatchObject({
      id: positionId,
      wallet: TRADER,
      token: TOKEN,
      ticker: "TKN",
      tokenBalance: 1_000_000_000_000_000_000n,
      costBasisUsdc: 20_000_000n,
      currentValueUsdc: 20_000_000n,
      realisedPnlUsdc: 0n,
      totalCostUsdc: 20_000_000n,
      totalProceedsUsdc: 0n,
    });
  });

  it("accumulates cost basis and balance on a follow-up buy", async () => {
    db._setFindResult(token, { address: TOKEN }, { symbol: "TKN" });
    db._setFindResult(walletBotPosition, { id: positionId }, {
      id: positionId,
      wallet: TRADER,
      token: TOKEN,
      ticker: "TKN",
      tokenBalance: 1_000_000_000_000_000_000n,
      costBasisUsdc: 20_000_000n,
      currentValueUsdc: 20_000_000n,
      realisedPnlUsdc: 0n,
      totalCostUsdc: 20_000_000n,
      totalProceedsUsdc: 0n,
    });
    const handler = getHandler("BotFeeRouter:BotRouterTrade");

    await handler({ event: buyEvent(), context: { db } });

    const positionUpdate = db._updateCalls.find(
      (c) => c.table === walletBotPosition,
    );
    expect(positionUpdate).toBeDefined();
    expect(positionUpdate!.values).toMatchObject({
      tokenBalance: 2_000_000_000_000_000_000n,
      costBasisUsdc: 40_000_000n,
      totalCostUsdc: 40_000_000n,
    });
  });

  it("preserves an existing ticker when the token row lookup returns no symbol", async () => {
    // Token row resolves but the symbol hasn't been filled yet
    // (e.g. Factory:PairCreated placeholder, before TokenLaunched).
    db._setFindResult(token, { address: TOKEN }, { symbol: "" });
    db._setFindResult(walletBotPosition, { id: positionId }, {
      id: positionId,
      wallet: TRADER,
      token: TOKEN,
      ticker: "TKN",
      tokenBalance: 1n,
      costBasisUsdc: 0n,
      currentValueUsdc: 0n,
      realisedPnlUsdc: 0n,
      totalCostUsdc: 0n,
      totalProceedsUsdc: 0n,
    });
    const handler = getHandler("BotFeeRouter:BotRouterTrade");

    await handler({ event: buyEvent(), context: { db } });

    const positionUpdate = db._updateCalls.find(
      (c) => c.table === walletBotPosition,
    );
    expect(positionUpdate!.values).toMatchObject({ ticker: "TKN" });
  });
});

describe("BotFeeRouter:BotRouterTrade — sells", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("full-sell of an existing position banks realised PnL = proceeds − full cost", async () => {
    db._setFindResult(token, { address: TOKEN }, { symbol: "TKN" });
    db._setFindResult(walletBotPosition, { id: positionId }, {
      id: positionId,
      wallet: TRADER,
      token: TOKEN,
      ticker: "TKN",
      tokenBalance: 1_000_000_000_000_000_000n,
      costBasisUsdc: 20_000_000n,
      currentValueUsdc: 20_000_000n,
      realisedPnlUsdc: 0n,
      totalCostUsdc: 20_000_000n,
      totalProceedsUsdc: 0n,
    });
    const handler = getHandler("BotFeeRouter:BotRouterTrade");

    await handler({ event: sellEvent(), context: { db } });

    const positionUpdate = db._updateCalls.find(
      (c) => c.table === walletBotPosition,
    );
    expect(positionUpdate).toBeDefined();
    expect(positionUpdate!.values).toMatchObject({
      tokenBalance: 0n,
      costBasisUsdc: 0n,
      currentValueUsdc: 0n,
      realisedPnlUsdc: 5_000_000n, // $25 proceeds − $20 cost
      totalProceedsUsdc: 25_000_000n,
    });
  });

  it("partial sell reduces cost basis proportionally and accumulates realised PnL", async () => {
    db._setFindResult(token, { address: TOKEN }, { symbol: "TKN" });
    db._setFindResult(walletBotPosition, { id: positionId }, {
      id: positionId,
      wallet: TRADER,
      token: TOKEN,
      ticker: "TKN",
      tokenBalance: 2_000_000_000_000_000_000n, // 2 tokens
      costBasisUsdc: 40_000_000n, // $40 total
      currentValueUsdc: 40_000_000n,
      realisedPnlUsdc: 0n,
      totalCostUsdc: 40_000_000n,
      totalProceedsUsdc: 0n,
    });
    const handler = getHandler("BotFeeRouter:BotRouterTrade");

    // Sell 1 of 2 held tokens for $25 → realised cost = $20, realised PnL = $5.
    await handler({ event: sellEvent(), context: { db } });

    const positionUpdate = db._updateCalls.find(
      (c) => c.table === walletBotPosition,
    );
    expect(positionUpdate!.values).toMatchObject({
      tokenBalance: 1_000_000_000_000_000_000n,
      costBasisUsdc: 20_000_000n,
      realisedPnlUsdc: 5_000_000n,
      totalProceedsUsdc: 25_000_000n,
    });
  });

  it("emits a realised loss when sell proceeds < cost basis", async () => {
    db._setFindResult(token, { address: TOKEN }, { symbol: "TKN" });
    db._setFindResult(walletBotPosition, { id: positionId }, {
      id: positionId,
      wallet: TRADER,
      token: TOKEN,
      ticker: "TKN",
      tokenBalance: 1_000_000_000_000_000_000n,
      costBasisUsdc: 50_000_000n, // bought for $50
      currentValueUsdc: 0n,
      realisedPnlUsdc: 0n,
      totalCostUsdc: 50_000_000n,
      totalProceedsUsdc: 0n,
    });
    const handler = getHandler("BotFeeRouter:BotRouterTrade");

    await handler({ event: sellEvent(), context: { db } }); // $25 out

    const positionUpdate = db._updateCalls.find(
      (c) => c.table === walletBotPosition,
    );
    expect(positionUpdate!.values).toMatchObject({
      tokenBalance: 0n,
      costBasisUsdc: 0n,
      realisedPnlUsdc: -25_000_000n,
    });
  });

  it("sell with no prior position row inserts an airdropped-position record", async () => {
    db._setFindResult(token, { address: TOKEN }, { symbol: "TKN" });
    // No walletBotPosition row pre-seeded — sell of tokens that arrived
    // via direct Transfer.
    const handler = getHandler("BotFeeRouter:BotRouterTrade");

    await handler({ event: sellEvent(), context: { db } });

    const positionInsert = db._insertCalls.find(
      (c) => c.table === walletBotPosition,
    );
    expect(positionInsert).toBeDefined();
    expect(positionInsert!.values).toMatchObject({
      tokenBalance: 0n,
      costBasisUsdc: 0n,
      currentValueUsdc: 0n,
      realisedPnlUsdc: 25_000_000n,
      totalCostUsdc: 0n,
      totalProceedsUsdc: 25_000_000n,
    });
  });
});

describe("BotFeeRouter:BotRouterTrade — referrer attribution", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("does not touch referrerStats when referrer is zero", async () => {
    db._setFindResult(token, { address: TOKEN }, { symbol: "TKN" });
    const handler = getHandler("BotFeeRouter:BotRouterTrade");

    await handler({ event: buyEvent(), context: { db } });

    const referrerInserts = db._insertCalls.filter(
      (c) => c.table === referrerStats,
    );
    const referrerUpdates = db._updateCalls.filter(
      (c) => c.table === referrerStats,
    );
    expect(referrerInserts).toHaveLength(0);
    expect(referrerUpdates).toHaveLength(0);
  });

  it("bootstraps referrerStats with referredCount=1 on first-ever attribution", async () => {
    db._setFindResult(token, { address: TOKEN }, { symbol: "TKN" });
    const handler = getHandler("BotFeeRouter:BotRouterTrade");

    await handler({
      event: buyEvent({
        referrer: REFERRER,
        referrerCut: 20_000n,
        treasuryCut: 80_000n,
      }),
      context: { db },
    });

    const insert = db._insertCalls.find((c) => c.table === referrerStats);
    expect(insert).toBeDefined();
    expect(insert!.values).toMatchObject({
      id: REFERRER.toLowerCase(),
      referrer: REFERRER,
      referredCount: 1,
      badPaymentCount: 0,
    });

    // First-time attribution → write a botReferrerTrader pair.
    const attribInsert = db._insertCalls.find(
      (c) => c.table === botReferrerTrader,
    );
    expect(attribInsert).toBeDefined();
  });

  it("does not double-count referredCount on a repeat trade by the same trader", async () => {
    db._setFindResult(token, { address: TOKEN }, { symbol: "TKN" });
    db._setFindResult(
      botReferrerTrader,
      { id: `${REFERRER.toLowerCase()}-${TRADER.toLowerCase()}` },
      {
        id: `${REFERRER.toLowerCase()}-${TRADER.toLowerCase()}`,
        referrer: REFERRER,
        trader: TRADER,
      },
    );
    db._setFindResult(referrerStats, { id: REFERRER.toLowerCase() }, {
      id: REFERRER.toLowerCase(),
      referrer: REFERRER,
      referredCount: 1,
      lifetimeEarnedUsdc: 20_000n,
      badPaymentCount: 0,
      attributionLossCount: 0,
    });
    const handler = getHandler("BotFeeRouter:BotRouterTrade");

    await handler({
      event: buyEvent({
        referrer: REFERRER,
        referrerCut: 20_000n,
        treasuryCut: 80_000n,
      }),
      context: { db },
    });

    const update = db._updateCalls.find((c) => c.table === referrerStats);
    expect(update).toBeDefined();
    expect(update!.values).toMatchObject({
      referredCount: 1, // unchanged — same trader seen before
    });
  });

  it("bumps badPaymentCount when referrer is set but referrerCut is zero", async () => {
    db._setFindResult(token, { address: TOKEN }, { symbol: "TKN" });
    const handler = getHandler("BotFeeRouter:BotRouterTrade");

    // Bad-rewards-wallet fallback: router fired but referrerCut == 0.
    await handler({
      event: buyEvent({
        referrer: REFERRER,
        referrerCut: 0n,
        treasuryCut: 100_000n,
      }),
      context: { db },
    });

    const insert = db._insertCalls.find((c) => c.table === referrerStats);
    expect(insert!.values).toMatchObject({
      badPaymentCount: 1,
      referredCount: 1,
    });
  });
});

describe("BotFeeRouter:ReferralPaid", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("bumps lifetimeEarnedUsdc on an existing referrerStats row", async () => {
    db._setFindResult(referrerStats, { id: REFERRER.toLowerCase() }, {
      id: REFERRER.toLowerCase(),
      referrer: REFERRER,
      referredCount: 3,
      lifetimeEarnedUsdc: 100_000n,
      badPaymentCount: 0,
      attributionLossCount: 0,
    });
    const handler = getHandler("BotFeeRouter:ReferralPaid");
    const event = createMockEvent({
      args: {
        referrer: REFERRER,
        user: TRADER,
        amount: 20_000n,
        token: TOKEN,
        side: 0,
      },
    });

    await handler({ event, context: { db } });

    const update = db._updateCalls.find((c) => c.table === referrerStats);
    expect(update).toBeDefined();
    expect(update!.values).toMatchObject({
      lifetimeEarnedUsdc: 120_000n,
    });
  });

  it("bootstraps a referrerStats row when none exists yet", async () => {
    const handler = getHandler("BotFeeRouter:ReferralPaid");
    const event = createMockEvent({
      args: {
        referrer: REFERRER,
        user: TRADER,
        amount: 20_000n,
        token: TOKEN,
        side: 0,
      },
    });

    await handler({ event, context: { db } });

    const insert = db._insertCalls.find((c) => c.table === referrerStats);
    expect(insert).toBeDefined();
    expect(insert!.values).toMatchObject({
      id: REFERRER.toLowerCase(),
      referrer: REFERRER,
      lifetimeEarnedUsdc: 20_000n,
      referredCount: 0,
    });
  });
});
