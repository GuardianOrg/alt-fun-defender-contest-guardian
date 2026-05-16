/**
 * Lock the covering index that backs `fetchHistoricalCurveSnapshots`
 * in `apps/api/src/lib/indexer-reads.ts`. The query is:
 *
 *   SELECT DISTINCT ON (token_address) ...
 *   FROM ponder_views.token_snapshot
 *   WHERE token_address = ANY($1::text[]) AND timestamp <= $2::numeric
 *   ORDER BY token_address, timestamp DESC, id DESC
 *
 * It is called once per market-data fetch on a batch of token addresses
 * (50–500 per call) so the per-call cost compounds linearly. Without an
 * index whose column directions match `ORDER BY token_address ASC,
 * timestamp DESC, id DESC`, Postgres reverts to per-key index seeks on
 * `(token_address, timestamp)` followed by an external sort — measured
 * at ~1 s/call × ~77 calls/s on the 2026-05-16 incident.
 *
 * Removing this index will silently let the planner fall back to the
 * same hot-path regression. Lock the contract here so a future schema
 * tidy can't drop the directional index without breaking this test.
 */
import { describe, it, expect } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import { tokenSnapshot } from "../ponder.schema";

/**
 * Drizzle stores each index column with the column itself flattened
 * onto the entry (`name`, `keyAsName`, `type`, …) plus an
 * `indexConfig` object carrying `{ order, nulls }`. The
 * `getTableConfig` API types this loosely as
 * `Partial<IndexedColumn | SQL>` and gives no public helper to read
 * the per-column direction, so reach in directly and normalise.
 *
 * Ponder vendors its own copy of `drizzle-orm` under
 * `node_modules/ponder/node_modules/drizzle-orm`, so the bare
 * `PgColumn` class identity differs between the two copies and an
 * `is(rawColumn, PgColumn)` check from this file would always read
 * false. Property-shape inspection sidesteps that entirely and is
 * stable across the two installs.
 */
function describeIndexColumn(
  rawColumn: unknown,
): { name: string; order: "asc" | "desc" } {
  if (
    !rawColumn ||
    typeof rawColumn !== "object" ||
    !("name" in rawColumn) ||
    typeof (rawColumn as { name: unknown }).name !== "string"
  ) {
    throw new Error(
      `Unrecognised index column shape: ${JSON.stringify(rawColumn, null, 2)}`,
    );
  }
  const entry = rawColumn as {
    name: string;
    indexConfig?: { order?: "asc" | "desc" };
  };
  return {
    name: entry.name,
    order: entry.indexConfig?.order ?? "asc",
  };
}

// Two `drizzle-orm` copies coexist (root + Ponder's vendored). The
// `getTableConfig` runtime walks the same Symbol-keyed table
// internals in both copies, but the static type identities of the
// two `PgTable` classes diverge. Cast through `unknown` to bridge
// the type-level seam without affecting runtime behaviour.
const snapshotTable = tokenSnapshot as unknown as PgTable;

describe("tokenSnapshot schema indexes", () => {
  it("has a (token_address ASC, timestamp DESC, id DESC) composite", () => {
    const { indexes } = getTableConfig(snapshotTable);
    const composites = indexes
      .map((idx) => idx.config.columns.map(describeIndexColumn))
      .filter((cols) => cols.length === 3);

    expect(composites).toContainEqual([
      { name: "token_address", order: "asc" },
      { name: "timestamp", order: "desc" },
      { name: "id", order: "desc" },
    ]);
  });

  it("keeps the legacy (token_address, timestamp) index for the chart hot path", () => {
    // `fetchTokenChartSnapshots` reads `timestamp ASC, id ASC` for a
    // single token. A reverse scan of the new descending composite
    // would work but the forward scan on the legacy ascending index
    // is cheaper at the per-token row counts that path sees.
    const { indexes } = getTableConfig(snapshotTable);
    const twoColumnAsc = indexes
      .map((idx) => idx.config.columns.map(describeIndexColumn))
      .filter(
        (cols) =>
          cols.length === 2 &&
          cols[0].order === "asc" &&
          cols[1].order === "asc",
      );

    expect(twoColumnAsc).toContainEqual([
      { name: "token_address", order: "asc" },
      { name: "timestamp", order: "asc" },
    ]);
  });
});
