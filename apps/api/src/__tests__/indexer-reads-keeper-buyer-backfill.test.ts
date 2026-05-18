import { describe, it, expect, vi, beforeEach } from "vitest";
import { asc, desc } from "drizzle-orm";

import { indexerToken, indexerWalletPosition } from "../db/indexer-schema.js";

// Mirror the mock pattern from indexer-reads-v2-helpers.test.ts: capture
// every Drizzle builder call so each test can assert on the SQL shape the
// helper assembled without hitting a real database.
const orderByCalls: unknown[][] = [];
const whereCalls: unknown[] = [];
const limitCalls: number[] = [];
let pendingRows: unknown[] = [];
let shouldThrow = false;

vi.mock("../db/client.js", () => ({
  createDb: () => ({
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = (...args: unknown[]) => {
        whereCalls.push(args[0]);
        return chain;
      };
      chain.orderBy = (...args: unknown[]) => {
        orderByCalls.push(args);
        return chain;
      };
      chain.limit = (n: number) => {
        limitCalls.push(n);
        return chain;
      };
      chain.then = (
        resolve: (v: unknown[]) => void,
        reject: (e: unknown) => void,
      ) => {
        if (shouldThrow) {
          reject(new Error("DB error"));
        } else {
          resolve(pendingRows);
        }
      };
      return chain;
    },
  }),
}));

const { createDb } = await import("../db/client.js");
const {
  fetchPendingGraduationTokens,
  fetchCurvePhaseTokens,
  fetchNonZeroWalletZapPositions,
  fetchMostRecentTokenAddresses,
  fetchCreatorVolumesByAddresses,
} = await import("../lib/indexer-reads.js");

function resetCapture(rows: unknown[] = [], throws = false): void {
  orderByCalls.length = 0;
  whereCalls.length = 0;
  limitCalls.length = 0;
  pendingRows = rows;
  shouldThrow = throws;
}

describe("fetchPendingGraduationTokens", () => {
  beforeEach(() => resetCapture());

  it("orders by pendingGraduationAt asc (oldest-first for FIFO keeper fairness)", async () => {
    const db = createDb("postgres://test");
    await fetchPendingGraduationTokens(db);
    expect(orderByCalls).toHaveLength(1);
    expect(orderByCalls[0]).toEqual([asc(indexerToken.pendingGraduationAt)]);
  });

  it("applies a hard limit of 50 matching the GraphQL cap", async () => {
    const db = createDb("postgres://test");
    await fetchPendingGraduationTokens(db);
    expect(limitCalls).toEqual([50]);
  });

  it("maps rows to { address, pendingGraduationAt } shape", async () => {
    // The mock returns rows in Drizzle's resolved camelCase shape
    resetCapture([
      { address: "0xabc", pendingGraduationAt: "1700000000" },
    ]);
    const db = createDb("postgres://test");
    const result = await fetchPendingGraduationTokens(db);
    expect(result).toEqual([
      { address: "0xabc", pendingGraduationAt: "1700000000" },
    ]);
  });

  it("returns empty array when no pending tokens", async () => {
    resetCapture([]);
    const db = createDb("postgres://test");
    const result = await fetchPendingGraduationTokens(db);
    expect(result).toEqual([]);
  });

  it("returns null on DB error so the keeper skips the tick", async () => {
    resetCapture([], true);
    const db = createDb("postgres://test");
    const result = await fetchPendingGraduationTokens(db);
    expect(result).toBeNull();
  });
});

describe("fetchCurvePhaseTokens", () => {
  beforeEach(() => resetCapture());

  it("orders by ltReserve desc (highest-reserve first for threshold detection)", async () => {
    const db = createDb("postgres://test");
    await fetchCurvePhaseTokens(db, 500);
    expect(orderByCalls).toHaveLength(1);
    expect(orderByCalls[0]).toEqual([desc(indexerToken.ltReserve)]);
  });

  it("passes the caller-supplied limit through", async () => {
    const db = createDb("postgres://test");
    await fetchCurvePhaseTokens(db, 42);
    expect(limitCalls).toEqual([42]);
  });

  it("maps rows to { address } shape", async () => {
    resetCapture([{ address: "0xdef" }]);
    const db = createDb("postgres://test");
    const result = await fetchCurvePhaseTokens(db, 500);
    expect(result).toEqual([{ address: "0xdef" }]);
  });

  it("returns null on DB error", async () => {
    resetCapture([], true);
    const db = createDb("postgres://test");
    const result = await fetchCurvePhaseTokens(db, 500);
    expect(result).toBeNull();
  });
});

describe("fetchNonZeroWalletZapPositions", () => {
  beforeEach(() => resetCapture());

  it("orders by tokenAddress asc for stable pagination", async () => {
    const db = createDb("postgres://test");
    await fetchNonZeroWalletZapPositions(db, "0xWallet", 200);
    expect(orderByCalls).toHaveLength(1);
    expect(orderByCalls[0]).toEqual([asc(indexerWalletPosition.tokenAddress)]);
  });

  it("passes the caller-supplied limit through", async () => {
    const db = createDb("postgres://test");
    await fetchNonZeroWalletZapPositions(db, "0xWallet", 200);
    expect(limitCalls).toEqual([200]);
  });

  it("maps rows to { tokenAddress } shape", async () => {
    resetCapture([{ tokenAddress: "0xTok" }]);
    const db = createDb("postgres://test");
    const result = await fetchNonZeroWalletZapPositions(db, "0xWallet", 200);
    expect(result).toEqual([{ tokenAddress: "0xTok" }]);
  });

  it("returns empty array when wallet has no non-zero positions", async () => {
    resetCapture([]);
    const db = createDb("postgres://test");
    const result = await fetchNonZeroWalletZapPositions(db, "0xEmpty", 200);
    expect(result).toEqual([]);
  });

  it("returns null on DB error", async () => {
    resetCapture([], true);
    const db = createDb("postgres://test");
    const result = await fetchNonZeroWalletZapPositions(db, "0xWallet", 200);
    expect(result).toBeNull();
  });
});

describe("fetchMostRecentTokenAddresses", () => {
  beforeEach(() => resetCapture());

  it("orders by blockNumber desc matching the original Ponder query", async () => {
    const db = createDb("postgres://test");
    await fetchMostRecentTokenAddresses(db, 50);
    expect(orderByCalls).toHaveLength(1);
    expect(orderByCalls[0]).toEqual([desc(indexerToken.blockNumber)]);
  });

  it("passes the caller-supplied limit through", async () => {
    const db = createDb("postgres://test");
    await fetchMostRecentTokenAddresses(db, 50);
    expect(limitCalls).toEqual([50]);
  });

  it("maps rows to { address } shape", async () => {
    resetCapture([{ address: "0xlatest" }]);
    const db = createDb("postgres://test");
    const result = await fetchMostRecentTokenAddresses(db, 50);
    expect(result).toEqual([{ address: "0xlatest" }]);
  });

  it("returns null on DB error", async () => {
    resetCapture([], true);
    const db = createDb("postgres://test");
    const result = await fetchMostRecentTokenAddresses(db, 50);
    expect(result).toBeNull();
  });
});

describe("fetchCreatorVolumesByAddresses", () => {
  beforeEach(() => resetCapture());

  it("returns empty array immediately when addresses list is empty (no DB call)", async () => {
    const db = createDb("postgres://test");
    const result = await fetchCreatorVolumesByAddresses(db, [], 50);
    expect(result).toEqual([]);
    expect(orderByCalls).toHaveLength(0);
    expect(limitCalls).toHaveLength(0);
  });

  it("passes the caller-supplied limit through", async () => {
    const db = createDb("postgres://test");
    await fetchCreatorVolumesByAddresses(db, ["0xtoken1"], 30);
    expect(limitCalls).toEqual([30]);
  });

  it("maps rows to { address, volumeUsd } shape", async () => {
    resetCapture([{ address: "0xtoken1", volumeUsd: "12345" }]);
    const db = createDb("postgres://test");
    const result = await fetchCreatorVolumesByAddresses(
      db,
      ["0xtoken1"],
      50,
    );
    expect(result).toEqual([{ address: "0xtoken1", volumeUsd: "12345" }]);
  });

  it("returns null on DB error", async () => {
    resetCapture([], true);
    const db = createDb("postgres://test");
    const result = await fetchCreatorVolumesByAddresses(
      db,
      ["0xtoken1"],
      50,
    );
    expect(result).toBeNull();
  });
});
