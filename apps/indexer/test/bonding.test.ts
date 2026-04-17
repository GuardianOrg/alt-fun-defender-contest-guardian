import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getHandler } from "./mocks/ponder";
import { createMockDb, createMockEvent } from "./mocks/db";
import { token, trade, graduation, tokenSnapshot } from "../ponder.schema";

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

    expect(db._insertCalls).toHaveLength(1);
    const call = db._insertCalls[0];
    expect(call.table).toBe(token);
    expect(call.values).toEqual({
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
    expect(call.conflict).toBe("doUpdate");
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

    const values = db._insertCalls[0].values as Record<string, unknown>;
    expect(values.curveSupply).toBe(0n);
    expect(values.ltReserve).toBe(0n);
    expect(values.graduated).toBe(false);
  });

  it("uses onConflictDoUpdate to overwrite FFactory:PairCreated placeholder", async () => {
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

    expect(db._insertCalls[0].conflict).toBe("doUpdate");
    expect(db._insertCalls[0].conflictValues).toEqual({
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

describe("FFactory:PairCreated", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("inserts a placeholder row carrying bondingPair", async () => {
    const handler = getHandler("FFactory:PairCreated");
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

  it("broadcasts live trades with curveSupply and ltReserve", async () => {
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
    expect(body.data.curveSupply).toBe("5000");
    expect(body.data.ltReserve).toBe("1000");
    expect(body.data.isBuy).toBe(true);
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

describe("Bonding:TokenGraduated", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("inserts graduation record and updates token status", async () => {
    const handler = getHandler("Bonding:TokenGraduated");
    const event = createMockEvent({
      args: {
        token: "0xtoken1",
        pairAddress: "0xpair1",
        liquidity: 50000n,
      },
      blockNumber: 200n,
      blockTimestamp: 1700100000n,
    });

    await handler({ event, context: { db } });

    expect(db._insertCalls).toHaveLength(1);
    const insertCall = db._insertCalls[0];
    expect(insertCall.table).toBe(graduation);
    expect(insertCall.values).toEqual({
      tokenAddress: "0xtoken1",
      pairAddress: "0xpair1",
      liquidity: 50000n,
      blockNumber: 200n,
      timestamp: 1700100000n,
    });
    expect(insertCall.conflict).toBe("doNothing");

    expect(db._updateCalls).toHaveLength(1);
    const updateCall = db._updateCalls[0];
    expect(updateCall.table).toBe(token);
    expect(updateCall.key).toEqual({ address: "0xtoken1" });
    expect(updateCall.values).toEqual({
      graduated: true,
      graduatedAt: 1700100000n,
      hyperswapPair: "0xpair1",
    });
  });
});
