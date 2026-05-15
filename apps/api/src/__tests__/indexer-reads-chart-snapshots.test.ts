import { describe, it, expect, vi, beforeEach } from "vitest";
import { asc, desc } from "drizzle-orm";

import { indexerTokenSnapshot } from "../db/indexer-schema.js";

// Capture every `orderBy(...)` invocation across the two parallel queries
// `fetchTokenChartSnapshots` issues (the pre-window anchor and the in-window
// scan). Asserted on per-test to verify both queries pin the ordering to
// (timestamp, id) — `id` is the indexer's primary key (txHash-logIndex) and
// the only stable secondary sort for snapshots that share `block.timestamp`
// in a multi-trade block.
const orderByCalls: unknown[][] = [];

// Drizzle's neon-http query is a Thenable: `await builder.limit(1)` and
// `await builder.orderBy(...)` both trigger execution. Mock the chain as a
// Thenable that resolves to `[]` so `fetchTokenChartSnapshots` returns an
// empty array (we don't care about the rows here; the contract under test
// is the *shape* of the query, specifically the ORDER BY clause).
//
// Each `db.select(...)` call returns a fresh chain object so the anchor and
// window subqueries don't share state when they run in `Promise.all`.
vi.mock("../db/client.js", () => ({
  createDb: () => ({
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.orderBy = (...args: unknown[]) => {
        orderByCalls.push(args);
        return chain;
      };
      chain.limit = () => chain;
      chain.then = (resolve: (v: unknown[]) => void) => resolve([]);
      return chain;
    },
  }),
}));

const { createDb } = await import("../db/client.js");
const { fetchTokenChartSnapshots } = await import("../lib/indexer-reads.js");

describe("fetchTokenChartSnapshots — multi-trade-block ordering", () => {
  beforeEach(() => {
    orderByCalls.length = 0;
  });

  it("orders both anchor and window queries by (timestamp, id) so same-timestamp snapshots are deterministic", async () => {
    // Regression for the chart-v2 / chart parity gap: `block.timestamp` is
    // second-resolution and NOT unique — a single block can carry multiple
    // `Bonding.Trade` events (or a Bonding.Trade plus a post-grad
    // HyperSwapPair.Sync), all stamped with the identical Unix-second
    // value. Without a secondary sort, Postgres returns those tied rows in
    // physical heap order, which (a) isn't stable across VACUUM / CLUSTER
    // / indexer schema swaps and (b) doesn't match the id-tiebreak the
    // legacy Ponder GraphQL paginator used. The relative order of tied
    // rows propagates into `buildPriceTimeline` (the *last* same-ts ratio
    // wins for events at or after that ts), changing intra-bucket OHLC
    // `high` / `low` / `close` values. Locking the secondary sort to
    // `id` matches the indexer's primary key — same fix already applied
    // to `fetchRouterTrades`.
    const db = createDb("postgres://test");
    const rows = await fetchTokenChartSnapshots(db, "0xabc", 1_700_000_000);

    expect(rows).toEqual([]);

    // Two queries: pre-window anchor (DESC) + in-window scan (ASC).
    expect(orderByCalls).toHaveLength(2);

    // Both must have exactly two columns in the ORDER BY — without the
    // `id` tiebreak we'd see one column here and the regression would
    // silently come back.
    for (const args of orderByCalls) {
      expect(args).toHaveLength(2);
    }

    // The anchor walks backwards (latest pre-window snapshot wins),
    // limited to one row — both columns descending so the limit picks
    // the deterministic row when the closest pre-window block has
    // multiple snapshots tied on timestamp.
    const [anchorTimestamp, anchorId] = orderByCalls[0] as [unknown, unknown];
    expect(anchorTimestamp).toEqual(desc(indexerTokenSnapshot.timestamp));
    expect(anchorId).toEqual(desc(indexerTokenSnapshot.id));

    // The window walks forwards in chronological order — both columns
    // ascending so the per-block snapshot order matches the order the
    // events were indexed (and therefore the legacy GraphQL response).
    const [windowTimestamp, windowId] = orderByCalls[1] as [unknown, unknown];
    expect(windowTimestamp).toEqual(asc(indexerTokenSnapshot.timestamp));
    expect(windowId).toEqual(asc(indexerTokenSnapshot.id));
  });
});
