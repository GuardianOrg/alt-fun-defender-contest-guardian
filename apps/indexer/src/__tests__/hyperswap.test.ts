import { describe, it, expect, beforeEach } from "vitest";
import { getHandler } from "./mocks/ponder";
import { createMockDb, createMockEvent } from "./mocks/db";
import { swap, pairReserve } from "../../ponder.schema";

// Importing the module registers handlers on the mock ponder object
await import("../hyperswap");

describe("HyperSwapPair:Swap", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("inserts a swap record with correct fields", async () => {
    const handler = getHandler("HyperSwapPair:Swap");
    const event = createMockEvent({
      args: {
        sender: "0xsender1",
        to: "0xreceiver1",
        amount0In: 1000n,
        amount1In: 0n,
        amount0Out: 0n,
        amount1Out: 500n,
      },
      txHash: "0xswaptx",
      logIndex: 2,
      logAddress: "0xpairABC",
      blockNumber: 300n,
      blockTimestamp: 1700200000n,
    });

    await handler({ event, context: { db } });

    expect(db._insertCalls).toHaveLength(1);
    const call = db._insertCalls[0];
    expect(call.table).toBe(swap);
    expect(call.values).toEqual({
      id: "0xswaptx-2",
      pairAddress: "0xpairABC",
      sender: "0xsender1",
      to: "0xreceiver1",
      amount0In: 1000n,
      amount1In: 0n,
      amount0Out: 0n,
      amount1Out: 500n,
      blockNumber: 300n,
      timestamp: 1700200000n,
    });
  });

  it("uses onConflictDoNothing for replay safety", async () => {
    const handler = getHandler("HyperSwapPair:Swap");
    const event = createMockEvent({
      args: {
        sender: "0xs",
        to: "0xr",
        amount0In: 1n,
        amount1In: 2n,
        amount0Out: 3n,
        amount1Out: 4n,
      },
    });

    await handler({ event, context: { db } });

    expect(db._insertCalls[0].conflict).toBe("doNothing");
  });

  it("uses log.transactionHash and log.logIndex for ID", async () => {
    const handler = getHandler("HyperSwapPair:Swap");
    const event = createMockEvent({
      args: {
        sender: "0xs",
        to: "0xr",
        amount0In: 0n,
        amount1In: 0n,
        amount0Out: 0n,
        amount1Out: 0n,
      },
      txHash: "0xuniquetx",
      logIndex: 99,
    });

    await handler({ event, context: { db } });

    const values = db._insertCalls[0].values as Record<string, unknown>;
    expect(values.id).toBe("0xuniquetx-99");
  });
});

describe("HyperSwapPair:Sync", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("upserts pair reserves with onConflictDoUpdate", async () => {
    const handler = getHandler("HyperSwapPair:Sync");
    const event = createMockEvent({
      args: {
        reserve0: 10000n,
        reserve1: 20000n,
      },
      logAddress: "0xpair1",
      blockNumber: 400n,
      blockTimestamp: 1700300000n,
    });

    await handler({ event, context: { db } });

    expect(db._insertCalls).toHaveLength(1);
    const call = db._insertCalls[0];
    expect(call.table).toBe(pairReserve);
    expect(call.values).toEqual({
      pairAddress: "0xpair1",
      reserve0: 10000n,
      reserve1: 20000n,
      blockNumber: 400n,
      timestamp: 1700300000n,
    });
    // Sync uses onConflictDoUpdate for upsert behavior
    expect(call.conflict).toBe("doUpdate");
    expect(call.conflictValues).toEqual({
      reserve0: 10000n,
      reserve1: 20000n,
      blockNumber: 400n,
      timestamp: 1700300000n,
    });
  });

  it("updates reserves on replay (upsert)", async () => {
    const handler = getHandler("HyperSwapPair:Sync");

    // First sync
    const event1 = createMockEvent({
      args: { reserve0: 100n, reserve1: 200n },
      logAddress: "0xpair1",
      blockNumber: 10n,
      blockTimestamp: 1000n,
    });
    await handler({ event: event1, context: { db } });

    // Second sync for same pair (simulates replay or new block)
    const event2 = createMockEvent({
      args: { reserve0: 150n, reserve1: 250n },
      logAddress: "0xpair1",
      blockNumber: 20n,
      blockTimestamp: 2000n,
    });
    await handler({ event: event2, context: { db } });

    // Both should use onConflictDoUpdate
    expect(db._insertCalls).toHaveLength(2);
    expect(db._insertCalls[0].conflict).toBe("doUpdate");
    expect(db._insertCalls[1].conflict).toBe("doUpdate");

    // Second call should have updated values
    expect(db._insertCalls[1].conflictValues).toEqual({
      reserve0: 150n,
      reserve1: 250n,
      blockNumber: 20n,
      timestamp: 2000n,
    });
  });
});
