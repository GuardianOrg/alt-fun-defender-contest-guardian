import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getHandler } from "./mocks/ponder";
import { createMockDb, createMockEvent } from "./mocks/db";
import {
  pairReserve,
  hyperswapPairIndex,
  token,
  tokenSnapshot,
} from "../ponder.schema";

// Importing the module registers handlers on the mock ponder object
await import("../src/hyperswap");

describe("HyperSwapPair:Sync", () => {
  let db: ReturnType<typeof createMockDb>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = createMockDb();
    process.env.API_WEBHOOK_URL = "http://test";
    process.env.ADMIN_API_KEY = "test-key";
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.API_WEBHOOK_URL;
    delete process.env.ADMIN_API_KEY;
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

    const reserveInsert = db._insertCalls.find((c) => c.table === pairReserve);
    expect(reserveInsert).toBeDefined();
    expect(reserveInsert!.values).toEqual({
      pairAddress: "0xpair1",
      reserve0: 10000n,
      reserve1: 20000n,
      blockNumber: 400n,
      timestamp: 1700300000n,
    });
    expect(reserveInsert!.conflict).toBe("doUpdate");
    expect(reserveInsert!.conflictValues).toEqual({
      reserve0: 10000n,
      reserve1: 20000n,
      blockNumber: 400n,
      timestamp: 1700300000n,
    });
  });

  it("updates reserves on replay (upsert)", async () => {
    const handler = getHandler("HyperSwapPair:Sync");

    const event1 = createMockEvent({
      args: { reserve0: 100n, reserve1: 200n },
      logAddress: "0xpair1",
      blockNumber: 10n,
      blockTimestamp: 1000n,
    });
    await handler({ event: event1, context: { db } });

    const event2 = createMockEvent({
      args: { reserve0: 150n, reserve1: 250n },
      logAddress: "0xpair1",
      blockNumber: 20n,
      blockTimestamp: 2000n,
    });
    await handler({ event: event2, context: { db } });

    const reserveInserts = db._insertCalls.filter((c) => c.table === pairReserve);
    expect(reserveInserts).toHaveLength(2);
    for (const ins of reserveInserts) expect(ins.conflict).toBe("doUpdate");
    expect(reserveInserts[1].conflictValues).toEqual({
      reserve0: 150n,
      reserve1: 250n,
      blockNumber: 20n,
      timestamp: 2000n,
    });
  });

  it("skips token mirror when the pair index is missing (pre-graduation Sync)", async () => {
    // No `_setFindResult` for `hyperswapPairIndex` — the very first Sync
    // emitted in the same tx as `TokenGraduated` won't see a registered
    // pair index. The handler must still update `pairReserve` but skip
    // the token mirror so we don't crash or leak phantom rows.
    const handler = getHandler("HyperSwapPair:Sync");
    await handler({
      event: createMockEvent({
        args: { reserve0: 100n, reserve1: 200n },
        logAddress: "0xunknownpair",
      }),
      context: { db },
    });

    expect(db._updateCalls.find((c) => c.table === token)).toBeUndefined();
    expect(db._insertCalls.find((c) => c.table === tokenSnapshot)).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("mirrors reserves into token (token0 case) and inserts a snapshot", async () => {
    db._setFindResult(hyperswapPairIndex, { pairAddress: "0xpair1" }, {
      pairAddress: "0xpair1",
      tokenAddress: "0xtoken1",
      ltAddress: "0xlt1",
      tokenIsToken0: true,
    });

    const handler = getHandler("HyperSwapPair:Sync");
    const event = createMockEvent({
      args: { reserve0: 1_000_000n, reserve1: 5_000n },
      logAddress: "0xpair1",
      txHash: "0xsynctx",
      logIndex: 7,
      blockNumber: 500n,
      blockTimestamp: 1700400000n,
    });
    await handler({ event, context: { db } });

    const tokenUpdate = db._updateCalls.find((c) => c.table === token);
    expect(tokenUpdate).toBeDefined();
    expect(tokenUpdate!.key).toEqual({ address: "0xtoken1" });
    expect(tokenUpdate!.values).toEqual({
      curveSupply: 1_000_000n,
      ltReserve: 5_000n,
    });

    const snapshotInsert = db._insertCalls.find((c) => c.table === tokenSnapshot);
    expect(snapshotInsert).toBeDefined();
    expect(snapshotInsert!.values).toEqual({
      id: "sync-0xsynctx-7",
      tokenAddress: "0xtoken1",
      curveSupply: 1_000_000n,
      ltReserve: 5_000n,
      blockNumber: 500n,
      timestamp: 1700400000n,
    });
    expect(snapshotInsert!.conflict).toBe("doNothing");
  });

  it("flips reserve mapping when the token is token1 in the pair", async () => {
    db._setFindResult(hyperswapPairIndex, { pairAddress: "0xpair2" }, {
      pairAddress: "0xpair2",
      tokenAddress: "0xtokenZ",
      ltAddress: "0xltA",
      tokenIsToken0: false,
    });

    const handler = getHandler("HyperSwapPair:Sync");
    await handler({
      event: createMockEvent({
        args: { reserve0: 5_000n, reserve1: 1_000_000n },
        logAddress: "0xpair2",
        blockTimestamp: 1700400000n,
      }),
      context: { db },
    });

    const tokenUpdate = db._updateCalls.find((c) => c.table === token);
    // tokenIsToken0=false → token reserve == reserve1, lt reserve == reserve0.
    expect(tokenUpdate!.values).toEqual({
      curveSupply: 1_000_000n,
      ltReserve: 5_000n,
    });
  });

  it("broadcasts a chart-only `trade` WS event with the new ratio", async () => {
    db._setFindResult(hyperswapPairIndex, { pairAddress: "0xpair1" }, {
      pairAddress: "0xpair1",
      tokenAddress: "0xtoken1",
      ltAddress: "0xlt1",
      tokenIsToken0: true,
    });

    const handler = getHandler("HyperSwapPair:Sync");
    await handler({
      event: createMockEvent({
        args: { reserve0: 100n, reserve1: 200n },
        logAddress: "0xpair1",
        txHash: "0xtx",
        logIndex: 3,
        // Live event window — broadcast must fire.
        blockTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      }),
      context: { db },
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init!.body as string) as {
      event: string;
      tokenAddress: string;
      data: Record<string, string | boolean>;
    };
    expect(body.event).toBe("trade");
    expect(body.tokenAddress).toBe("0xtoken1");
    expect(body.data).toMatchObject({
      tokenAddress: "0xtoken1",
      curveSupply: "100",
      ltReserve: "200",
    });
    // Trade-list payload deliberately absent — see `TradeBroadcast`'s
    // docstring. The trade-feed UI sources rows from the Zap:Buy /
    // Zap:Sell broadcasts (which fire alongside post-grad swaps) plus
    // the REST `/api/v1/trades` poll fallback.
    expect(body.data.usdcAmount).toBeUndefined();
    expect(body.data.trader).toBeUndefined();
    expect(body.data.isBuy).toBeUndefined();
    expect(body.data.tokenAmount).toBeUndefined();
  });

  it("skips the WS broadcast for backfill events (older than the live window)", async () => {
    db._setFindResult(hyperswapPairIndex, { pairAddress: "0xpair1" }, {
      pairAddress: "0xpair1",
      tokenAddress: "0xtoken1",
      ltAddress: "0xlt1",
      tokenIsToken0: true,
    });

    const handler = getHandler("HyperSwapPair:Sync");
    await handler({
      event: createMockEvent({
        args: { reserve0: 1n, reserve1: 1n },
        logAddress: "0xpair1",
        // Way in the past → not a live event.
        blockTimestamp: 1_000_000n,
      }),
      context: { db },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
