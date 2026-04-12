import { describe, it, expect, beforeEach } from "vitest";
import { getHandler } from "./mocks/ponder";
import { createMockDb, createMockEvent } from "./mocks/db";
import { token, trade, graduation } from "../../ponder.schema";

// Importing the module registers handlers on the mock ponder object
await import("../bonding");

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
      symbol: "TEST", // ticker -> symbol mapping
      creator: "0xcreator",
      ltToken: "0xlt1",
      k: 500000n,
      curveSupply: 0n,
      ltReserve: 0n,
      graduated: false,
      blockNumber: 42n,
      timestamp: 1700000000n,
    });
    expect(call.conflict).toBe("doNothing");
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

  it("uses onConflictDoNothing for replay safety", async () => {
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
    });

    await handler({ event, context: { db } });

    expect(db._insertCalls[0].conflict).toBe("doNothing");
  });
});

describe("Bonding:Trade", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("inserts a trade and updates token reserves", async () => {
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

    // Should insert trade
    expect(db._insertCalls).toHaveLength(1);
    const insertCall = db._insertCalls[0];
    expect(insertCall.table).toBe(trade);
    expect(insertCall.values).toEqual({
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
    expect(insertCall.conflict).toBe("doNothing");

    // Should update token
    expect(db._updateCalls).toHaveLength(1);
    const updateCall = db._updateCalls[0];
    expect(updateCall.table).toBe(token);
    expect(updateCall.key).toEqual({ address: "0xtoken1" });
    expect(updateCall.values).toEqual({
      curveSupply: 5000n,
      ltReserve: 1000n,
    });
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

    const values = db._insertCalls[0].values as Record<string, unknown>;
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

    const values = db._insertCalls[0].values as Record<string, unknown>;
    expect(values.isBuy).toBe(false);
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

    // Should insert graduation
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

    // Should update token
    expect(db._updateCalls).toHaveLength(1);
    const updateCall = db._updateCalls[0];
    expect(updateCall.table).toBe(token);
    expect(updateCall.key).toEqual({ address: "0xtoken1" });
    expect(updateCall.values).toEqual({
      graduated: true,
      graduatedAt: 1700100000n,
      pairAddress: "0xpair1",
    });
  });
});
