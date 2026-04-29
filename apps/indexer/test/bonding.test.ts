import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getHandler } from "./mocks/ponder";
import { createMockDb, createMockEvent } from "./mocks/db";
import { token, trade, graduation, tokenSnapshot, hyperswapPairIndex } from "../ponder.schema";

await import("../src/bonding");

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

    // TokenLaunched only inserts the token row — there's no protocolConfig
    // bootstrap because graduationThresholdUsd is now an immutable
    // initialise-time constant on the proxy and off-chain consumers read it
    // directly via RPC.
    expect(db._insertCalls).toHaveLength(1);
    const tokenInsert = db._insertCalls.find((c) => c.table === token);
    expect(tokenInsert).toBeDefined();
    expect(tokenInsert!.values).toEqual({
      address: "0xtoken1",
      name: "Test Token",
      symbol: "TEST",
      creator: "0xcreator",
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
    });
    // No chart state on this variant — useChartData consumes the
    // Bonding:Trade broadcast for that.
    expect(body.data.curveSupply).toBeUndefined();
    expect(body.data.ltReserve).toBeUndefined();
  });

  it("broadcasts a Sell with isBuy=false and usdcAmount = usdcOut", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
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
    });
  });

  it("skips the broadcast on historical backfill", async () => {
    db._setFindResult(token, { address: "0xtoken1" }, {
      address: "0xtoken1",
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
