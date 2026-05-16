import { describe, it, expect, vi, beforeEach } from "vitest";
import { desc } from "drizzle-orm";

import {
  indexerFeeAccrual,
  indexerGraduation,
  indexerReferral,
  indexerRouterTrade,
  indexerToken,
} from "../db/indexer-schema.js";

// Capture every Drizzle builder method call across the helpers exercised
// in this file. The mocked `db.select()` chain records `where`, `orderBy`,
// and `limit` arguments so each test can assert on the actual SQL shape
// the helper assembled (ORDER BY columns, WHERE clause presence, the
// 1-row LIMIT for primary-key reads, etc.).
const orderByCalls: unknown[][] = [];
const whereCalls: unknown[] = [];
const limitCalls: number[] = [];
let pendingRows: unknown[] = [];

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
      chain.then = (resolve: (v: unknown[]) => void) => resolve(pendingRows);
      return chain;
    },
  }),
}));

const { createDb } = await import("../db/client.js");
const {
  fetchFeeAccrualsSince,
  fetchGraduationsSince,
  fetchReferralsByReferrer,
  fetchReferrerStatsById,
  fetchRouterTradesForAnalytics,
  fetchTokenBalanceById,
  fetchTokenBalancesByWallet,
  fetchTokenBalancesByWalletAndTokens,
  fetchTokenMeta,
  fetchTokensLaunchedSince,
  fetchWalletBotPositions,
} = await import("../lib/indexer-reads.js");

function resetCapture(rows: unknown[] = []): void {
  orderByCalls.length = 0;
  whereCalls.length = 0;
  limitCalls.length = 0;
  pendingRows = rows;
}

describe("indexer-reads v2 helpers — SQL shape", () => {
  beforeEach(() => resetCapture());

  it("fetchFeeAccrualsSince orders by (timestamp desc, id desc) so multi-event blocks are stable", async () => {
    const db = createDb("postgres://test");
    const rows = await fetchFeeAccrualsSince(db, 1700000000);
    expect(rows).toEqual([]);
    expect(orderByCalls).toHaveLength(1);
    const [tsOrder, idOrder] = orderByCalls[0] as [unknown, unknown];
    expect(tsOrder).toEqual(desc(indexerFeeAccrual.timestamp));
    expect(idOrder).toEqual(desc(indexerFeeAccrual.id));
  });

  it("fetchRouterTradesForAnalytics shares the same (timestamp,id) tiebreak as the chart trade reads", async () => {
    const db = createDb("postgres://test");
    await fetchRouterTradesForAnalytics(db, 100);
    expect(orderByCalls).toHaveLength(1);
    const [tsOrder, idOrder] = orderByCalls[0] as [unknown, unknown];
    expect(tsOrder).toEqual(desc(indexerRouterTrade.timestamp));
    expect(idOrder).toEqual(desc(indexerRouterTrade.id));
  });

  it("fetchGraduationsSince orders by timestamp desc (graduation has a unique tokenAddress PK; no id tiebreak needed)", async () => {
    const db = createDb("postgres://test");
    await fetchGraduationsSince(db, 100);
    expect(orderByCalls).toHaveLength(1);
    const [tsOrder] = orderByCalls[0] as [unknown];
    expect(tsOrder).toEqual(desc(indexerGraduation.timestamp));
  });

  it("fetchTokensLaunchedSince orders by timestamp desc", async () => {
    const db = createDb("postgres://test");
    await fetchTokensLaunchedSince(db, 100);
    expect(orderByCalls).toHaveLength(1);
    const [tsOrder] = orderByCalls[0] as [unknown];
    expect(tsOrder).toEqual(desc(indexerToken.timestamp));
  });

  it("fetchReferralsByReferrer orders by (timestamp desc, id desc)", async () => {
    const db = createDb("postgres://test");
    await fetchReferralsByReferrer(db, "0xAAAAAAAA");
    expect(orderByCalls).toHaveLength(1);
    const [tsOrder, idOrder] = orderByCalls[0] as [unknown, unknown];
    expect(tsOrder).toEqual(desc(indexerReferral.timestamp));
    expect(idOrder).toEqual(desc(indexerReferral.id));
  });

  it("fetchTokenBalancesByWallet has no orderBy or limit (returns the whole holdings set)", async () => {
    const db = createDb("postgres://test");
    await fetchTokenBalancesByWallet(db, "0xAAA");
    expect(orderByCalls).toHaveLength(0);
    expect(limitCalls).toHaveLength(0);
  });

  it("fetchTokenBalancesByWalletAndTokens short-circuits to [] on empty token list (no DB query)", async () => {
    const db = createDb("postgres://test");
    const rows = await fetchTokenBalancesByWalletAndTokens(db, "0xAAA", []);
    expect(rows).toEqual([]);
    expect(whereCalls).toHaveLength(0);
  });

  it("fetchTokenBalanceById issues a primary-key lookup with limit(1)", async () => {
    const db = createDb("postgres://test");
    await fetchTokenBalanceById(db, "0xWALLET", "0xTOKEN");
    expect(limitCalls).toEqual([1]);
  });

  it("fetchWalletBotPositions has no orderBy (route sorts in app code)", async () => {
    const db = createDb("postgres://test");
    await fetchWalletBotPositions(db, "0xAAA");
    expect(orderByCalls).toHaveLength(0);
  });

  it("fetchReferrerStatsById issues a primary-key lookup with limit(1)", async () => {
    const db = createDb("postgres://test");
    await fetchReferrerStatsById(db, "0xAAA");
    expect(limitCalls).toEqual([1]);
  });

  it("fetchTokenMeta issues a primary-key lookup with limit(1)", async () => {
    const db = createDb("postgres://test");
    await fetchTokenMeta(db, "0xAAA");
    expect(limitCalls).toEqual([1]);
  });
});
