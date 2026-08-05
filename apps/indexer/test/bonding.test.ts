import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getHandler } from "./mocks/ponder";
import { createMockDb, createMockEvent } from "./mocks/db";
import {
  token,
  trade,
  graduation,
  tokenSnapshot,
  hyperswapPairIndex,
  globalStats,
  hourlyVolume,
  walletPosition,
  tokenBalance,
  tokenHourlyMetrics,
} from "../ponder.schema";

await import("../src/bonding");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

describe("Bonding:TokenLaunched", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("inserts a token with correct field mapping", async () => {
    const handler = getHandler("Bonding:TokenLaunched");
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        name: "Test Token",
        ticker: "TEST",
        creator: "0xcreator",
        ltAddress: "0xlt1",
        k: 500000n,
      },
      blockNumber: 42n,
      blockTimestamp: 1700000000n,
    });

    await handler({ event, context: { db } });

    // TokenLaunched inserts the token row and bootstraps the singleton
    // `globalStats` row (first event ever — no prior row to update). Both
    // counters bump from zero. There's no `protocolConfig` bootstrap because
    // `graduationThresholdUsd` is now an immutable initialise-time constant
    // on the proxy and off-chain consumers read it directly via RPC.
    expect(db._insertCalls).toHaveLength(2);
    const tokenInsert = db._insertCalls.find((c) => c.table === token);
    expect(tokenInsert).toBeDefined();
    expect(tokenInsert!.values).toEqual({
      address: "0xtoken1",
      name: "Test Token",
      symbol: "TEST",
      creator: "0xcreator",
      // Seeded to the launch wallet; only `feeRecipient` moves later.
      feeRecipient: "0xcreator",
      ltToken: "0xlt1",
      k: 500000n,
      curveSupply: 0n,
      ltReserve: 0n,
      graduated: false,
      blockNumber: 42n,
      timestamp: 1700000000n,
    });
    expect(tokenInsert!.conflict).toBe("doUpdate");
  });

  it("initializes curveSupply and ltReserve to 0", async () => {
    const handler = getHandler("Bonding:TokenLaunched");
    const event = createMockEvent({
      args: {
        token: "0xtoken2",
        name: "Another",
        ticker: "ANO",
        creator: "0xcreator2",
        ltAddress: "0xlt2",
        k: 100n,
      },
    });

    await handler({ event, context: { db } });

    const tokenInsert = db._insertCalls.find((c) => c.table === token)!;
    const values = tokenInsert.values as Record<string, unknown>;
    expect(values.curveSupply).toBe(0n);
    expect(values.ltReserve).toBe(0n);
    expect(values.graduated).toBe(false);
  });

  it("uses onConflictDoUpdate to overwrite Factory:PairCreated placeholder", async () => {
    const handler = getHandler("Bonding:TokenLaunched");
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        name: "Test",
        ticker: "T",
        creator: "0xc",
        ltAddress: "0xlt",
        k: 1n,
      },
      blockNumber: 42n,
      blockTimestamp: 1700000000n,
    });

    await handler({ event, context: { db } });

    const tokenInsert = db._insertCalls.find((c) => c.table === token)!;
    expect(tokenInsert.conflict).toBe("doUpdate");
    expect(tokenInsert.conflictValues).toEqual({
      name: "Test",
      symbol: "T",
      creator: "0xc",
      feeRecipient: "0xc",
      ltToken: "0xlt",
      k: 1n,
      blockNumber: 42n,
      timestamp: 1700000000n,
    });
  });
});

describe("Factory:PairCreated", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("inserts a placeholder row carrying bondingPair", async () => {
    const handler = getHandler("Factory:PairCreated");
    const event = createMockEvent({
      args: {
        tokenA: "0xtoken1",
        tokenB: "0xlt1",
        pair: "0xbondingpair1",
        index: 1n,
      },
      blockNumber: 41n,
      blockTimestamp: 1699999999n,
    });

    await handler({ event, context: { db } });

    expect(db._insertCalls).toHaveLength(1);
    const call = db._insertCalls[0];
    expect(call.table).toBe(token);
    expect(call.values).toEqual({
      address: "0xtoken1",
      name: "",
      symbol: "",
      creator: "0x0000000000000000000000000000000000000000",
      feeRecipient: "0x0000000000000000000000000000000000000000",
      ltToken: "0xlt1",
      k: 0n,
      curveSupply: 0n,
      ltReserve: 0n,
      graduated: false,
      bondingPair: "0xbondingpair1",
      blockNumber: 41n,
      timestamp: 1699999999n,
    });
    expect(call.conflict).toBe("doUpdate");
    expect(call.conflictValues).toEqual({ bondingPair: "0xbondingpair1" });
  });
});

describe("creator reassignment", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  // Asserts the exact update payload for both events, which pins the two
  // invariants documented on `token.creator` / `token.communityTakeoverAt` in
  // ponder.schema.ts: `creator` never moves, and only the owner-forced event
  // stamps the takeover timestamp.
  it.each([
    ["Bonding:CreatorTransferred", { feeRecipient: "0xnewcreator" }],
    [
      "Bonding:CreatorReassigned",
      { feeRecipient: "0xnewcreator", communityTakeoverAt: 4242n },
    ],
  ])("%s lands the expected row update", async (eventName, expectedValues) => {
    const handler = getHandler(eventName);
    const event = createMockEvent({
      blockTimestamp: 4242n,
      args: {
        token: "0xtoken1",
        oldCreator: "0xoldcreator",
        newCreator: "0xnewcreator",
      },
    });

    await handler({ event, context: { db } });

    expect(db._updateCalls).toHaveLength(1);
    const call = db._updateCalls[0];
    expect(call.table).toBe(token);
    expect(call.key).toEqual({ address: "0xtoken1" });
    expect(call.values).toEqual(expectedValues);
    expect(call.values).not.toHaveProperty("creator");
  });
});

describe("Bonding:Trade", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("inserts a trade, updates token reserves, and writes a curve snapshot", async () => {
    const handler = getHandler("Bonding:Trade");
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        trader: "0xtrader1",
        isBuy: true,
        ltAmount: 1000n,
        tokenAmount: 5000n,
        newCurveSupply: 5000n,
        newLtReserve: 1000n,
      },
      txHash: "0xtx1",
      logIndex: 3,
      blockNumber: 50n,
      blockTimestamp: 1700001000n,
    });

    await handler({ event, context: { db } });

    const tradeInsert = db._insertCalls.find((c) => c.table === trade);
    expect(tradeInsert).toBeDefined();
    expect(tradeInsert!.values).toEqual({
      id: "0xtx1-3",
      tokenAddress: "0xtoken1",
      trader: "0xtrader1",
      isBuy: true,
      ltAmount: 1000n,
      tokenAmount: 5000n,
      curveSupply: 5000n,
      ltReserve: 1000n,
      blockNumber: 50n,
      timestamp: 1700001000n,
    });
    expect(tradeInsert!.conflict).toBe("doNothing");

    expect(db._updateCalls).toHaveLength(1);
    const updateCall = db._updateCalls[0];
    expect(updateCall.table).toBe(token);
    expect(updateCall.key).toEqual({ address: "0xtoken1" });
    expect(updateCall.values).toEqual({
      curveSupply: 5000n,
      ltReserve: 1000n,
    });

    const snapshotInsert = db._insertCalls.find(
      (c) => c.table === tokenSnapshot,
    );
    expect(snapshotInsert).toBeDefined();
    expect(snapshotInsert!.values).toEqual({
      id: "0xtx1-3",
      tokenAddress: "0xtoken1",
      curveSupply: 5000n,
      ltReserve: 1000n,
      blockNumber: 50n,
      timestamp: 1700001000n,
    });
    expect(snapshotInsert!.conflict).toBe("doNothing");
  });

  it("generates correct ID from txHash and logIndex", async () => {
    const handler = getHandler("Bonding:Trade");
    const event = createMockEvent({
      args: {
        token: "0xt",
        trader: "0xtr",
        isBuy: false,
        ltAmount: 100n,
        tokenAmount: 200n,
        newCurveSupply: 300n,
        newLtReserve: 400n,
      },
      txHash: "0xdeadbeef",
      logIndex: 7,
    });

    await handler({ event, context: { db } });

    const tradeInsert = db._insertCalls.find((c) => c.table === trade);
    const values = tradeInsert!.values as Record<string, unknown>;
    expect(values.id).toBe("0xdeadbeef-7");
  });

  it("handles sell trades (isBuy=false)", async () => {
    const handler = getHandler("Bonding:Trade");
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        trader: "0xtrader1",
        isBuy: false,
        ltAmount: 500n,
        tokenAmount: 2000n,
        newCurveSupply: 3000n,
        newLtReserve: 500n,
      },
    });

    await handler({ event, context: { db } });

    const tradeInsert = db._insertCalls.find((c) => c.table === trade);
    const values = tradeInsert!.values as Record<string, unknown>;
    expect(values.isBuy).toBe(false);
  });
});

describe("Bonding:Trade WS broadcaster", () => {
  let db: ReturnType<typeof createMockDb>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = createMockDb();
    fetchSpy = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchSpy);
    process.env.API_WEBHOOK_URL = "https://api.example.com";
    process.env.ADMIN_API_KEY = "test-admin-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.API_WEBHOOK_URL;
    delete process.env.ADMIN_API_KEY;
  });

  it("broadcasts a chart-only event with curveSupply/ltReserve and no trade-list payload", async () => {
    const handler = getHandler("Bonding:Trade");
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        trader: "0xtrader1",
        isBuy: true,
        ltAmount: 1000n,
        tokenAmount: 5000n,
        newCurveSupply: 5000n,
        newLtReserve: 1000n,
      },
      txHash: "0xlive",
      logIndex: 0,
      blockTimestamp: nowSec,
    });

    await handler({ event, context: { db } });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/v1/webhook/indexer");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Admin-Key"]).toBe("test-admin-key");

    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("trade");
    expect(body.tokenAddress).toBe("0xtoken1");
    expect(body.data).toEqual({
      id: "0xlive-0",
      tokenAddress: "0xtoken1",
      curveSupply: "5000",
      ltReserve: "1000",
      timestamp: nowSec.toString(),
    });
    // Trade-list payload absent — rows come from the Zap:Buy / Zap:Sell
    // broadcast (asserted below).
    expect(body.data.usdcAmount).toBeUndefined();
    expect(body.data.trader).toBeUndefined();
    expect(body.data.isBuy).toBeUndefined();
    expect(body.data.tokenAmount).toBeUndefined();
  });

  it("skips broadcast during historical backfill", async () => {
    const handler = getHandler("Bonding:Trade");
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        trader: "0xtrader1",
        isBuy: true,
        ltAmount: 1000n,
        tokenAmount: 5000n,
        newCurveSupply: 5000n,
        newLtReserve: 1000n,
      },
      blockTimestamp: 1700000000n,
    });

    await handler({ event, context: { db } });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips broadcast when webhook env vars are unset", async () => {
    delete process.env.API_WEBHOOK_URL;
    const handler = getHandler("Bonding:Trade");
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        trader: "0xtrader1",
        isBuy: true,
        ltAmount: 1000n,
        tokenAmount: 5000n,
        newCurveSupply: 5000n,
        newLtReserve: 1000n,
      },
      blockTimestamp: nowSec,
    });

    await handler({ event, context: { db } });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Zap:Buy / Sell WS broadcaster (trade-list rows)", () => {
  let db: ReturnType<typeof createMockDb>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = createMockDb();
    fetchSpy = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchSpy);
    process.env.API_WEBHOOK_URL = "https://api.example.com";
    process.env.ADMIN_API_KEY = "test-admin-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.API_WEBHOOK_URL;
    delete process.env.ADMIN_API_KEY;
  });

  it("broadcasts a Buy with usdcAmount and the routerTrade id", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      name: "Test Token",
      symbol: "TST",
      organicUsdcRaised: 0n,
      volumeUsd: 0n,
    });

    const handler = getHandler("Zap:Buy");
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        buyer: "0xbuyer",
        usdcIn: 300_000_000n, // $300, 6dp
        tokensOut: 583_000_000_000_000_000_000_000_000n,
      },
      txHash: "0xtxhash",
      logIndex: 27,
      blockTimestamp: nowSec,
    });

    await handler({ event, context: { db } });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("trade");
    expect(body.tokenAddress).toBe("0xtoken1");
    expect(body.data).toMatchObject({
      // ID matches the REST `routerTrade.id` so the live broadcast
      // dedupes against the REST poll fallback.
      id: "0xtxhash-27",
      tokenAddress: "0xtoken1",
      trader: "0xbuyer",
      isBuy: true,
      usdcAmount: "300000000",
      tokenAmount: "583000000000000000000000000",
      // Indexer-resolved labels — close the race window where the
      // first buy for a freshly-deployed token lands in the feed
      // before the Ponder GraphQL endpoint has caught up (issue #703).
      tokenSymbol: "TST",
      tokenName: "Test Token",
    });
    // No chart state on this variant — useChartData consumes the
    // Bonding:Trade broadcast for that.
    expect(body.data.curveSupply).toBeUndefined();
    expect(body.data.ltReserve).toBeUndefined();
  });

  it("broadcasts a Sell with isBuy=false and usdcAmount = usdcOut", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      name: "Test Token",
      symbol: "TST",
      organicUsdcRaised: 100_000_000n,
      volumeUsd: 100_000_000n,
    });

    const handler = getHandler("Zap:Sell");
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        seller: "0xseller",
        tokensIn: 1_000_000_000_000_000_000_000_000n,
        usdcOut: 50_000_000n,
      },
      txHash: "0xselltx",
      logIndex: 5,
      blockTimestamp: nowSec,
    });

    await handler({ event, context: { db } });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.data).toMatchObject({
      id: "0xselltx-5",
      trader: "0xseller",
      isBuy: false,
      usdcAmount: "50000000",
      tokenSymbol: "TST",
      tokenName: "Test Token",
    });
  });

  it("omits blank token labels so the client doesn't cache the placeholder row", async () => {
    // Mirrors the Factory:PairCreated → Bonding:TokenLaunched race:
    // if the metadata fields haven't been overwritten yet, the row's
    // `name` and `symbol` are empty strings. Caching those as
    // "resolved" on the client would freeze the row on a blank label —
    // strictly worse than the truncated-address fallback.
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      name: "",
      symbol: "   ", // whitespace-only also counts as blank
      organicUsdcRaised: 0n,
      volumeUsd: 0n,
    });

    const handler = getHandler("Zap:Buy");
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        buyer: "0xbuyer",
        usdcIn: 1n,
        tokensOut: 1n,
      },
      blockTimestamp: nowSec,
    });

    await handler({ event, context: { db } });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.data.tokenSymbol).toBeUndefined();
    expect(body.data.tokenName).toBeUndefined();
  });

  it("omits token labels when the token row is missing entirely", async () => {
    // Defensive case: `Zap:Buy` shouldn't fire before `TokenLaunched`
    // in normal operation, but if the indexer is in a partially-
    // bootstrapped state we still want the broadcast to go out — the
    // client falls back through `prefetchTokenName` + the truncated
    // address. The shape must still validate as a `TradeListBroadcast`.
    const handler = getHandler("Zap:Buy");
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        buyer: "0xbuyer",
        usdcIn: 1n,
        tokensOut: 1n,
      },
      blockTimestamp: nowSec,
    });

    await handler({ event, context: { db } });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.data.tokenSymbol).toBeUndefined();
    expect(body.data.tokenName).toBeUndefined();
  });

  it("skips the broadcast on historical backfill", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      name: "Test Token",
      symbol: "TST",
      organicUsdcRaised: 0n,
      volumeUsd: 0n,
    });

    const handler = getHandler("Zap:Buy");
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        buyer: "0xbuyer",
        usdcIn: 1n,
        tokensOut: 1n,
      },
      blockTimestamp: 1_700_000_000n,
    });

    await handler({ event, context: { db } });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Bonding:TokenGraduated", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("inserts graduation record with dynamic-LP-seeding fields and updates token status", async () => {
    // Scoped to the graduation row + token-row update only. Pair-index
    // population is exercised by the next three tests (which seed a
    // matching token row so the handler's `db.find(token, ...)` lookup
    // resolves), so we deliberately don't seed here.
    const handler = getHandler("Bonding:TokenGraduated");
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        pairAddress: "0xpair1",
        liquidity: 50000n,
        tokensInLP: 250_000_000n * 10n ** 18n,
        lpBurned: 0n,
        unsoldBurned: 10_000_000n * 10n ** 18n,
      },
      blockNumber: 200n,
      blockTimestamp: 1700100000n,
    });

    await handler({ event, context: { db } });

    const graduationInsert = db._insertCalls.find((c) => c.table === graduation);
    expect(graduationInsert).toBeDefined();
    expect(graduationInsert!.values).toEqual({
      tokenAddress: "0xtoken1",
      pairAddress: "0xpair1",
      liquidity: 50000n,
      tokensInLP: 250_000_000n * 10n ** 18n,
      lpBurned: 0n,
      unsoldBurned: 10_000_000n * 10n ** 18n,
      blockNumber: 200n,
      timestamp: 1700100000n,
    });
    expect(graduationInsert!.conflict).toBe("doNothing");

    expect(db._updateCalls).toHaveLength(1);
    const updateCall = db._updateCalls[0];
    expect(updateCall.table).toBe(token);
    expect(updateCall.key).toEqual({ address: "0xtoken1" });
    expect(updateCall.values).toEqual({
      pendingGraduation: false,
      graduated: true,
      graduatedAt: 1700100000n,
      hyperswapPair: "0xpair1",
    });
  });

  it("populates the hyperswapPairIndex with token0 ordering cached", async () => {
    // Token address sorts BELOW the LT address → token is token0.
    db._setFindResult(token, { address: "0x0011000000000000000000000000000000001100" }, {
      address: "0x0011000000000000000000000000000000001100",
      ltToken: "0xff0000000000000000000000000000000000ffff",
    });

    const handler = getHandler("Bonding:TokenGraduated");
    await handler({
      event: createMockEvent({
        args: {
          token: "0x0011000000000000000000000000000000001100",
          pairAddress: "0xpair_low",
          liquidity: 1n,
          tokensInLP: 1n,
          lpBurned: 0n,
          unsoldBurned: 0n,
        },
      }),
      context: { db },
    });

    const idxInsert = db._insertCalls.find((c) => c.table === hyperswapPairIndex);
    expect(idxInsert).toBeDefined();
    expect(idxInsert!.values).toEqual({
      pairAddress: "0xpair_low",
      tokenAddress: "0x0011000000000000000000000000000000001100",
      ltAddress: "0xff0000000000000000000000000000000000ffff",
      tokenIsToken0: true,
    });
    // `doNothing` so a hypothetical replay of TokenGraduated never clobbers
    // the cached ordering — pair addresses don't change after creation.
    expect(idxInsert!.conflict).toBe("doNothing");
  });

  it("flips tokenIsToken0 to false when the LT sorts below the token", async () => {
    db._setFindResult(token, { address: "0xff0000000000000000000000000000000000ffff" }, {
      address: "0xff0000000000000000000000000000000000ffff",
      ltToken: "0x0011000000000000000000000000000000001100",
    });

    const handler = getHandler("Bonding:TokenGraduated");
    await handler({
      event: createMockEvent({
        args: {
          token: "0xff0000000000000000000000000000000000ffff",
          pairAddress: "0xpair_high",
          liquidity: 1n,
          tokensInLP: 1n,
          lpBurned: 0n,
          unsoldBurned: 0n,
        },
      }),
      context: { db },
    });

    const idxInsert = db._insertCalls.find((c) => c.table === hyperswapPairIndex);
    expect(idxInsert!.values).toMatchObject({ tokenIsToken0: false });
  });

  it("skips the pair index when the token row is missing", async () => {
    // No `_setFindResult` — simulates an out-of-order event (shouldn't
    // happen in production since TokenLaunched is always indexed first,
    // but the handler must not throw).
    const handler = getHandler("Bonding:TokenGraduated");
    await handler({
      event: createMockEvent({
        args: {
          token: "0xunknown",
          pairAddress: "0xpair",
          liquidity: 1n,
          tokensInLP: 1n,
          lpBurned: 0n,
          unsoldBurned: 0n,
        },
      }),
      context: { db },
    });

    const idxInsert = db._insertCalls.find((c) => c.table === hyperswapPairIndex);
    expect(idxInsert).toBeUndefined();
  });
});

describe("Zap:Buy / Sell — organic USDC accumulator", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("bumps organicUsdcRaised and volumeUsd on Buy", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      organicUsdcRaised: 1_000_000n, // 1 USDC
      volumeUsd: 4_000_000n, // 4 USDC lifetime so far
    });

    const handler = getHandler("Zap:Buy");
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        buyer: "0xbuyer",
        usdcIn: 5_000_000n, // 5 USDC
        tokensOut: 1000n,
      },
    });

    await handler({ event, context: { db } });

    const tokenUpdate = db._updateCalls.find((c) => c.table === token);
    expect(tokenUpdate).toBeDefined();
    expect(tokenUpdate!.values).toEqual({
      organicUsdcRaised: 6_000_000n,
      volumeUsd: 9_000_000n,
    });
  });

  it("subtracts organicUsdcRaised on Sell (floored at zero) while volumeUsd still grows", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      organicUsdcRaised: 1_000_000n,
      volumeUsd: 7_000_000n,
    });

    const handler = getHandler("Zap:Sell");
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        seller: "0xseller",
        tokensIn: 1000n,
        usdcOut: 3_000_000n, // sell exceeds historical buys
      },
    });

    await handler({ event, context: { db } });

    const tokenUpdate = db._updateCalls.find((c) => c.table === token);
    expect(tokenUpdate).toBeDefined();
    expect(tokenUpdate!.values).toEqual({
      organicUsdcRaised: 0n,
      volumeUsd: 10_000_000n,
    });
  });

  it("skips the counter update when the token row is missing", async () => {
    // No `_setFindResult` — simulates a webhook event arriving for a token
    // that hasn't been indexed yet (shouldn't happen in practice, but the
    // handler must not crash).
    const handler = getHandler("Zap:Buy");
    const event = createMockEvent({
      args: {
        token: "0xunknown",
        buyer: "0xbuyer",
        usdcIn: 5_000_000n,
        tokensOut: 1000n,
      },
    });

    await handler({ event, context: { db } });

    expect(db._updateCalls.find((c) => c.table === token)).toBeUndefined();
  });
});

describe("globalStats singleton", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("bootstraps the singleton on the very first TokenLaunched", async () => {
    const handler = getHandler("Bonding:TokenLaunched");
    await handler({
      event: createMockEvent({
        args: {
          token: "0xtoken1",
          name: "T",
          ticker: "T",
          creator: "0xc",
          ltAddress: "0xlt",
          k: 1n,
        },
      }),
      context: { db },
    });

    const insert = db._insertCalls.find((c) => c.table === globalStats);
    expect(insert).toBeDefined();
    expect(insert!.values).toEqual({
      id: "global",
      totalTokens: 1n,
      tokensLive: 1n,
      tokensGraduated: 0n,
      totalVolumeUsd: 0n,
    });
  });

  it("increments totalTokens / tokensLive on subsequent TokenLaunched events", async () => {
    db._setFindResult(globalStats, { id: "global" }, {
      totalTokens: 7n,
      tokensLive: 5n,
      tokensGraduated: 2n,
      totalVolumeUsd: 1234n,
    });

    const handler = getHandler("Bonding:TokenLaunched");
    await handler({
      event: createMockEvent({
        args: {
          token: "0xtoken2",
          name: "T",
          ticker: "T",
          creator: "0xc",
          ltAddress: "0xlt",
          k: 1n,
        },
      }),
      context: { db },
    });

    const update = db._updateCalls.find((c) => c.table === globalStats);
    expect(update).toBeDefined();
    expect(update!.values).toEqual({ totalTokens: 8n, tokensLive: 6n });
  });

  it("moves a token from live to graduated on TokenGraduated", async () => {
    db._setFindResult(globalStats, { id: "global" }, {
      totalTokens: 10n,
      tokensLive: 7n,
      tokensGraduated: 3n,
      totalVolumeUsd: 0n,
    });
    // Required for the hyperswapPairIndex branch — irrelevant to the stats
    // assertion, just keeps the handler from short-circuiting before it
    // updates the singleton.
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      ltToken: "0xlt",
    });

    const handler = getHandler("Bonding:TokenGraduated");
    await handler({
      event: createMockEvent({
        args: {
          token: "0xtoken1",
          pairAddress: "0xpair",
          liquidity: 1n,
          tokensInLP: 1n,
          lpBurned: 0n,
          unsoldBurned: 0n,
        },
      }),
      context: { db },
    });

    const update = db._updateCalls.find((c) => c.table === globalStats);
    expect(update).toBeDefined();
    expect(update!.values).toEqual({ tokensLive: 6n, tokensGraduated: 4n });
  });

  it("bumps totalVolumeUsd on Buy and Sell (gross, never subtracts)", async () => {
    db._setFindResult(globalStats, { id: "global" }, {
      totalTokens: 1n,
      tokensLive: 1n,
      tokensGraduated: 0n,
      totalVolumeUsd: 100n,
    });
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      organicUsdcRaised: 0n,
      volumeUsd: 0n,
    });

    const buyHandler = getHandler("Zap:Buy");
    await buyHandler({
      event: createMockEvent({
        args: {
          token: "0xtoken1",
          buyer: "0xbuyer",
          usdcIn: 50n,
          tokensOut: 1n,
        },
      }),
      context: { db },
    });

    const buyUpdate = db._updateCalls.find((c) => c.table === globalStats);
    expect(buyUpdate!.values).toEqual({ totalVolumeUsd: 150n });
  });
});

describe("hourlyVolume buckets", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("creates a bucket keyed by hour-start on the first trade in the hour", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      organicUsdcRaised: 0n,
      volumeUsd: 0n,
    });

    const handler = getHandler("Zap:Buy");
    // 1_700_001_234 / 3600 = 472_222.56… → floor 472_222 → ×3600 = 1_699_999_200
    await handler({
      event: createMockEvent({
        args: {
          token: "0xtoken1",
          buyer: "0xbuyer",
          usdcIn: 75n,
          tokensOut: 1n,
        },
        blockTimestamp: 1_700_001_234n,
      }),
      context: { db },
    });

    const insert = db._insertCalls.find((c) => c.table === hourlyVolume);
    expect(insert).toBeDefined();
    expect(insert!.values).toEqual({
      hourStart: 1_699_999_200n,
      volumeUsd: 75n,
    });
  });

  it("adds to an existing bucket on subsequent trades in the same hour", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      organicUsdcRaised: 0n,
      volumeUsd: 0n,
    });
    db._setFindResult(hourlyVolume, { hourStart: 1_699_999_200n }, {
      volumeUsd: 100n,
    });

    const handler = getHandler("Zap:Sell");
    await handler({
      event: createMockEvent({
        args: {
          token: "0xtoken1",
          seller: "0xseller",
          tokensIn: 1n,
          usdcOut: 25n,
        },
        blockTimestamp: 1_700_002_000n, // same hour as 1_700_001_234
      }),
      context: { db },
    });

    const update = db._updateCalls.find((c) => c.table === hourlyVolume);
    expect(update).toBeDefined();
    expect(update!.key).toEqual({ hourStart: 1_699_999_200n });
    expect(update!.values).toEqual({ volumeUsd: 125n });
  });
});

describe("walletPosition (per-wallet cost basis)", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("creates a position on first Zap:Buy with full cost basis", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      organicUsdcRaised: 0n,
      volumeUsd: 0n,
    });

    const handler = getHandler("Zap:Buy");
    await handler({
      event: createMockEvent({
        args: {
          token: "0xtoken1",
          buyer: "0xbuyer",
          usdcIn: 1_000_000n,
          tokensOut: 5_000n,
        },
      }),
      context: { db },
    });

    const insert = db._insertCalls.find((c) => c.table === walletPosition);
    expect(insert).toBeDefined();
    expect(insert!.values).toEqual({
      id: "0xbuyer-0xtoken1",
      wallet: "0xbuyer",
      tokenAddress: "0xtoken1",
      zapTokenAmount: 5_000n,
      costBasisUsdc: 1_000_000n,
    });
  });

  it("adds to an existing position on subsequent Zap:Buy", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      organicUsdcRaised: 0n,
      volumeUsd: 0n,
    });
    db._setFindResult(walletPosition, { id: "0xbuyer-0xtoken1" }, {
      zapTokenAmount: 5_000n,
      costBasisUsdc: 1_000_000n,
    });

    const handler = getHandler("Zap:Buy");
    await handler({
      event: createMockEvent({
        args: {
          token: "0xtoken1",
          buyer: "0xbuyer",
          usdcIn: 500_000n,
          tokensOut: 2_000n,
        },
      }),
      context: { db },
    });

    const update = db._updateCalls.find((c) => c.table === walletPosition);
    expect(update).toBeDefined();
    expect(update!.values).toEqual({
      zapTokenAmount: 7_000n,
      costBasisUsdc: 1_500_000n,
    });
  });

  it("reduces cost basis proportionally on partial Zap:Sell", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      organicUsdcRaised: 1_000_000n,
      volumeUsd: 1_000_000n,
    });
    db._setFindResult(walletPosition, { id: "0xseller-0xtoken1" }, {
      zapTokenAmount: 10_000n,
      costBasisUsdc: 1_000_000n,
    });

    const handler = getHandler("Zap:Sell");
    await handler({
      event: createMockEvent({
        args: {
          token: "0xtoken1",
          seller: "0xseller",
          tokensIn: 4_000n, // selling 40% of position
          usdcOut: 500_000n,
        },
      }),
      context: { db },
    });

    const update = db._updateCalls.find((c) => c.table === walletPosition);
    expect(update).toBeDefined();
    // 10_000 − 4_000 = 6_000 tokens left; cost basis 1_000_000 × 4_000 / 10_000 = 400_000 reduction
    // → 1_000_000 − 400_000 = 600_000 left
    expect(update!.values).toEqual({
      zapTokenAmount: 6_000n,
      costBasisUsdc: 600_000n,
    });
  });

  it("zeroes the position when a sell exhausts it", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      organicUsdcRaised: 1_000_000n,
      volumeUsd: 1_000_000n,
    });
    db._setFindResult(walletPosition, { id: "0xseller-0xtoken1" }, {
      zapTokenAmount: 1_000n,
      costBasisUsdc: 100_000n,
    });

    const handler = getHandler("Zap:Sell");
    await handler({
      event: createMockEvent({
        args: {
          token: "0xtoken1",
          seller: "0xseller",
          tokensIn: 5_000n, // sells more than the position holds
          usdcOut: 500_000n,
        },
      }),
      context: { db },
    });

    const update = db._updateCalls.find((c) => c.table === walletPosition);
    expect(update!.values).toEqual({ zapTokenAmount: 0n, costBasisUsdc: 0n });
  });

  it("skips the wallet-position update when no prior position exists", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      organicUsdcRaised: 0n,
      volumeUsd: 0n,
    });
    // No `_setFindResult` for walletPosition — wallet sold transferred-in
    // tokens with no prior Zap-mediated buys. Position stays absent (cost
    // basis "0" by definition for transferred-in supply).

    const handler = getHandler("Zap:Sell");
    await handler({
      event: createMockEvent({
        args: {
          token: "0xtoken1",
          seller: "0xseller",
          tokensIn: 1_000n,
          usdcOut: 50_000n,
        },
      }),
      context: { db },
    });

    expect(
      db._updateCalls.find((c) => c.table === walletPosition),
    ).toBeUndefined();
  });
});

/**
 * `Token:Transfer` is the bookkeeping path for the `tokenBalance` table that
 * powers `/api/v1/holders` and `/api/v1/balances`. Regression coverage for
 * issue #418, where a misconfigured factory event in `ponder.config.ts`
 * silently dropped *every* Transfer log → both routes returned empty.
 *
 * The factory wiring itself is exercised separately in `ponder-config.test.ts`
 * (event-signature shape — what produced the silent breakage). These tests
 * cover the handler's per-side balance arithmetic and the mint / burn edges.
 */
describe("Token:Transfer (tokenBalance bookkeeping)", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("credits the recipient and debits the sender by `value`", async () => {
    db._setFindResult(
      tokenBalance,
      { id: "0xfrom-0xtoken1" },
      { balance: 1_000n },
    );
    db._setFindResult(
      tokenBalance,
      { id: "0xto-0xtoken1" },
      { balance: 500n },
    );

    const handler = getHandler("Token:Transfer");
    await handler({
      event: createMockEvent({
        args: { from: "0xfrom", to: "0xto", value: 300n },
        logAddress: "0xtoken1",
      }),
      context: { db },
    });

    const fromInsert = db._insertCalls.find(
      (c) => (c.values as { wallet?: string }).wallet === "0xfrom",
    );
    const toInsert = db._insertCalls.find(
      (c) => (c.values as { wallet?: string }).wallet === "0xto",
    );

    expect(fromInsert!.values).toEqual({
      id: "0xfrom-0xtoken1",
      wallet: "0xfrom",
      tokenAddress: "0xtoken1",
      balance: 700n,
    });
    expect(fromInsert!.conflict).toBe("doUpdate");
    expect(fromInsert!.conflictValues).toEqual({ balance: 700n });

    expect(toInsert!.values).toEqual({
      id: "0xto-0xtoken1",
      wallet: "0xto",
      tokenAddress: "0xtoken1",
      balance: 800n,
    });
    expect(toInsert!.conflict).toBe("doUpdate");
    expect(toInsert!.conflictValues).toEqual({ balance: 800n });
  });

  it("treats a mint (from = 0x0) as credit-only — no debit row", async () => {
    const handler = getHandler("Token:Transfer");
    await handler({
      event: createMockEvent({
        args: { from: ZERO_ADDRESS, to: "0xto", value: 1_000n },
        logAddress: "0xtoken1",
      }),
      context: { db },
    });

    expect(db._insertCalls).toHaveLength(1);
    expect((db._insertCalls[0]!.values as { wallet: string }).wallet).toBe("0xto");
  });

  it("treats a burn (to = 0x0) as debit-only — no credit row", async () => {
    db._setFindResult(
      tokenBalance,
      { id: "0xfrom-0xtoken1" },
      { balance: 5_000n },
    );
    const handler = getHandler("Token:Transfer");
    await handler({
      event: createMockEvent({
        args: { from: "0xfrom", to: ZERO_ADDRESS, value: 2_000n },
        logAddress: "0xtoken1",
      }),
      context: { db },
    });

    expect(db._insertCalls).toHaveLength(1);
    expect(db._insertCalls[0]!.values).toEqual({
      id: "0xfrom-0xtoken1",
      wallet: "0xfrom",
      tokenAddress: "0xtoken1",
      balance: 3_000n,
    });
  });

  it("floors a debit at zero when the prior balance is missing or stale", async () => {
    // No `_setFindResult` for the sender — first time we see them.
    const handler = getHandler("Token:Transfer");
    await handler({
      event: createMockEvent({
        args: { from: "0xunseen", to: "0xto", value: 100n },
        logAddress: "0xtoken1",
      }),
      context: { db },
    });

    const fromInsert = db._insertCalls.find(
      (c) => (c.values as { wallet?: string }).wallet === "0xunseen",
    );
    expect((fromInsert!.values as { balance: bigint }).balance).toBe(0n);
  });
});

/**
 * Per-(token, hour) bucket maintenance — sole backing store for the
 * trending tab and per-token 24h volume. Written incrementally on every
 * `Zap.Buy` / `Zap.Sell`; the API sums the last 24 rows per token at
 * read time to derive the rolling 24h figure that drives
 * `?sort=trending` (no precomputed score, no cron, no boost).
 *
 * The block lives inline in both Zap:Buy and Zap:Sell (see the
 * `MAINTAIN_TOKEN_HOURLY` markers in `bonding.ts`); the assertions here
 * cover the bootstrap-first-bucket case plus the accumulate-into-existing
 * case across mixed Buy/Sell trades.
 */
describe("tokenHourlyMetrics (per-token 24h volume buckets)", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("creates a tokenHourlyMetrics bucket keyed by (tokenAddress, hour-start) on the first trade in that hour", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      organicUsdcRaised: 0n,
      volumeUsd: 0n,
    });

    const handler = getHandler("Zap:Buy");
    // 1_700_001_234 / 3600 = 472_222.56… → floor 472_222 → ×3600 = 1_699_999_200
    await handler({
      event: createMockEvent({
        args: {
          token: "0xtoken1",
          buyer: "0xbuyer",
          usdcIn: 75n,
          tokensOut: 1n,
        },
        blockTimestamp: 1_700_001_234n,
      }),
      context: { db },
    });

    const insert = db._insertCalls.find(
      (c) => c.table === tokenHourlyMetrics,
    );
    expect(insert).toBeDefined();
    expect(insert!.values).toEqual({
      id: "0xtoken1-1699999200",
      tokenAddress: "0xtoken1",
      hourStart: 1_699_999_200n,
      volumeUsd: 75n,
      tradeCount: 1,
    });
  });

  it("adds to an existing tokenHourlyMetrics bucket on subsequent trades in the same hour (mixed Buy + Sell)", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      organicUsdcRaised: 100n,
      volumeUsd: 100n,
    });
    db._setFindResult(
      tokenHourlyMetrics,
      { id: "0xtoken1-1699999200" },
      { volumeUsd: 100n, tradeCount: 1 },
    );

    const handler = getHandler("Zap:Sell");
    await handler({
      event: createMockEvent({
        args: {
          token: "0xtoken1",
          seller: "0xseller",
          tokensIn: 1n,
          usdcOut: 25n,
        },
        blockTimestamp: 1_700_002_000n, // same hour as 1_700_001_234
      }),
      context: { db },
    });

    const update = db._updateCalls.find((c) => c.table === tokenHourlyMetrics);
    expect(update).toBeDefined();
    expect(update!.key).toEqual({ id: "0xtoken1-1699999200" });
    expect(update!.values).toEqual({ volumeUsd: 125n, tradeCount: 2 });
  });

  it("Zap:Sell adds to the per-token hourly bucket with the gross sell USDC", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
      organicUsdcRaised: 1_000_000n,
      volumeUsd: 1_000_000n,
    });

    const handler = getHandler("Zap:Sell");
    // 1_700_200_000 / 3600 = 472_277.78… → floor 472_277 → ×3600 = 1_700_197_200
    await handler({
      event: createMockEvent({
        args: {
          token: "0xtoken1",
          seller: "0xseller",
          tokensIn: 100n,
          usdcOut: 50_000n,
        },
        blockTimestamp: 1_700_200_000n,
      }),
      context: { db },
    });

    const insert = db._insertCalls.find(
      (c) => c.table === tokenHourlyMetrics,
    );
    expect(insert).toBeDefined();
    expect(insert!.values).toEqual({
      id: "0xtoken1-1700197200",
      tokenAddress: "0xtoken1",
      hourStart: 1_700_197_200n,
      volumeUsd: 50_000n,
      tradeCount: 1,
    });
    expect(insert!.conflict).toBe("doNothing");
  });
});
