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
    // Id is now per-second per-token (`sync-bucket-${token}-${blockTs}`)
    // rather than per-event (`sync-${txHash}-${logIndex}`) — the per-second
    // decimation collapses MEV bot tail-swaps and multi-step arbitrage
    // routes inside the same block into a single snapshot row. See issue
    // #978 and the comment block in `apps/indexer/src/hyperswap.ts`.
    expect(snapshotInsert!.values).toEqual({
      id: "sync-bucket-0xtoken1-1700400000",
      tokenAddress: "0xtoken1",
      curveSupply: 1_000_000n,
      ltReserve: 5_000n,
      blockNumber: 500n,
      timestamp: 1700400000n,
    });
    // `doUpdate` (latest-wins) — the most recent reserve in the second is
    // the canonical close for any candle bucket ending in that second.
    // `timestamp` is intentionally absent from the conflict-update payload:
    // it's the bucket key, so updating it is a no-op and including it
    // would just add noise to the SQL.
    expect(snapshotInsert!.conflict).toBe("doUpdate");
    expect(snapshotInsert!.conflictValues).toEqual({
      curveSupply: 1_000_000n,
      ltReserve: 5_000n,
      blockNumber: 500n,
    });
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
    const blockTs = BigInt(Math.floor(Date.now() / 1000));
    await handler({
      event: createMockEvent({
        args: { reserve0: 100n, reserve1: 200n },
        logAddress: "0xpair1",
        txHash: "0xtx",
        logIndex: 3,
        // Live event window — broadcast must fire.
        blockTimestamp: blockTs,
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
    // The broadcast id matches the new decimated snapshot id shape
    // (`sync-bucket-${token}-${blockTs}`) — see issue #978.
    expect(body.data.id).toBe(`sync-bucket-0xtoken1-${blockTs.toString()}`);
    // Trade-list payload deliberately absent — see `TradeBroadcast`'s
    // docstring. The trade-feed UI sources rows from the Zap:Buy /
    // Zap:Sell broadcasts (which fire alongside post-grad swaps) plus
    // the REST `/api/v1/trades` poll fallback.
    expect(body.data.usdcAmount).toBeUndefined();
    expect(body.data.trader).toBeUndefined();
    expect(body.data.isBuy).toBeUndefined();
    expect(body.data.tokenAmount).toBeUndefined();
  });

  it("decimates same-second snapshot writes with latest-wins reserves (issue #978)", async () => {
    // Two Sync events in the same block (same `block.timestamp`) — e.g. a
    // user swap immediately followed by an MEV tail-swap. The handler must
    // collapse them into a single `tokenSnapshot` row keyed
    // `sync-bucket-${token}-${blockTs}`, with the second event's reserves
    // overwriting the first via `onConflictDoUpdate` (NOT `doNothing`,
    // which would freeze the candle close at the pre-tail-swap state).
    db._setFindResult(hyperswapPairIndex, { pairAddress: "0xpair1" }, {
      pairAddress: "0xpair1",
      tokenAddress: "0xtoken1",
      ltAddress: "0xlt1",
      tokenIsToken0: true,
    });

    const handler = getHandler("HyperSwapPair:Sync");

    await handler({
      event: createMockEvent({
        args: { reserve0: 1_000n, reserve1: 2_000n },
        logAddress: "0xpair1",
        txHash: "0xtx-first",
        logIndex: 1,
        blockNumber: 500n,
        blockTimestamp: 1700400000n,
      }),
      context: { db },
    });

    await handler({
      event: createMockEvent({
        args: { reserve0: 1_500n, reserve1: 1_800n },
        logAddress: "0xpair1",
        txHash: "0xtx-second",
        logIndex: 2,
        blockNumber: 500n,
        blockTimestamp: 1700400000n,
      }),
      context: { db },
    });

    const snapshotInserts = db._insertCalls.filter(
      (c) => c.table === tokenSnapshot,
    );
    // Both calls happen against the SAME bucket id. Postgres applies the
    // ON CONFLICT DO UPDATE on the second one, so the persisted row ends
    // up with the second event's reserves — that's the verified contract.
    expect(snapshotInserts).toHaveLength(2);
    for (const ins of snapshotInserts) {
      expect((ins.values as { id: string }).id).toBe(
        "sync-bucket-0xtoken1-1700400000",
      );
      expect(ins.conflict).toBe("doUpdate");
    }
    // The second event's reserves win — verifies the latest-per-second
    // strategy from issue #978's acceptance criteria.
    expect(snapshotInserts[1].conflictValues).toEqual({
      curveSupply: 1_500n,
      ltReserve: 1_800n,
      blockNumber: 500n,
    });
  });

  it("broadcasts on every Sync regardless of the snapshot dedup (issue #978)", async () => {
    // The DB-side decimation must NOT suppress the WS broadcast — the
    // chart's live-tick aggregator merges every tick into the in-progress
    // candle for sub-second high/low fidelity, and silencing intra-second
    // ticks would visibly flat-line a candle whenever a user trade landed
    // in the same block as a follow-up MEV swap.
    db._setFindResult(hyperswapPairIndex, { pairAddress: "0xpair1" }, {
      pairAddress: "0xpair1",
      tokenAddress: "0xtoken1",
      ltAddress: "0xlt1",
      tokenIsToken0: true,
    });

    const handler = getHandler("HyperSwapPair:Sync");
    const blockTs = BigInt(Math.floor(Date.now() / 1000));

    await handler({
      event: createMockEvent({
        args: { reserve0: 1_000n, reserve1: 2_000n },
        logAddress: "0xpair1",
        txHash: "0xtx-first",
        logIndex: 1,
        blockNumber: 500n,
        blockTimestamp: blockTs,
      }),
      context: { db },
    });

    await handler({
      event: createMockEvent({
        args: { reserve0: 1_500n, reserve1: 1_800n },
        logAddress: "0xpair1",
        txHash: "0xtx-second",
        logIndex: 2,
        blockNumber: 500n,
        blockTimestamp: blockTs,
      }),
      context: { db },
    });

    // Two broadcasts despite collapsing into a single snapshot row — the
    // contract is "every Sync gets a WS tick".
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const [, init0] = fetchSpy.mock.calls[0];
    const [, init1] = fetchSpy.mock.calls[1];
    const body0 = JSON.parse(init0!.body as string) as {
      event: string;
      data: Record<string, string>;
    };
    const body1 = JSON.parse(init1!.body as string) as {
      event: string;
      data: Record<string, string>;
    };
    expect(body0.data.curveSupply).toBe("1000");
    expect(body0.data.ltReserve).toBe("2000");
    expect(body1.data.curveSupply).toBe("1500");
    expect(body1.data.ltReserve).toBe("1800");
    // Both broadcasts share the bucket id — the chart's WS handler keys
    // off `(curveSupply, ltReserve)` rather than `id`, so a shared id is
    // harmless and matches what the persisted snapshot row carries.
    const expectedId = `sync-bucket-0xtoken1-${blockTs.toString()}`;
    expect(body0.data.id).toBe(expectedId);
    expect(body1.data.id).toBe(expectedId);
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
