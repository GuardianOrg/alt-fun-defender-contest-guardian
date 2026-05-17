/**
 * Lock the composite indexes that back the GRADUATED and GRADUATING
 * tabs on `GET /api/v1/tokens?status=…`. The queries (see
 * `apps/api/src/lib/indexer-reads.ts → fetchGraduatedTokensOnchain` /
 * `fetchNonGraduatedTokensOnchain`) are:
 *
 *   -- GRADUATED tab
 *   SELECT ... FROM ponder_views.token
 *   WHERE graduated = true
 *   ORDER BY graduated_at DESC
 *   LIMIT 500
 *
 *   -- GRADUATING tab (route then applies the 85%-curve-filled gate
 *   --                in memory; see routes/tokens/list.ts)
 *   SELECT ... FROM ponder_views.token
 *   WHERE graduated = false
 *   ORDER BY curve_supply ASC
 *   LIMIT 500
 *
 * Without directionally-matching composites the planner falls back to
 * a full seq scan + external sort and both tab loads scale linearly
 * with the token catalogue — the regression these indexes exist to
 * prevent. Same fix pattern as `tokenSnapshot.tokenTsDescIdIdx`.
 *
 * Removing either index will silently let the planner regress. Lock
 * the contract here so a future schema tidy can't drop the index
 * without breaking this test.
 */
import { describe, it, expect } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import { token } from "../ponder.schema";

/**
 * Same shape inspection as `token-snapshot-index.test.ts` — Ponder
 * vendors its own `drizzle-orm` so an `is(rawColumn, PgColumn)` check
 * across the two copies always reads false. Property-shape inspection
 * is stable across both installs.
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

const tokenTable = token as unknown as PgTable;

describe("token schema indexes", () => {
  it("has a (graduated, graduated_at DESC) composite for the GRADUATED tab", () => {
    const { indexes } = getTableConfig(tokenTable);
    const composites = indexes
      .map((idx) => idx.config.columns.map(describeIndexColumn))
      .filter((cols) => cols.length === 2);

    expect(composites).toContainEqual([
      { name: "graduated", order: "asc" },
      { name: "graduated_at", order: "desc" },
    ]);
  });

  it("has a (graduated, curve_supply) composite for the GRADUATING tab", () => {
    const { indexes } = getTableConfig(tokenTable);
    const composites = indexes
      .map((idx) => idx.config.columns.map(describeIndexColumn))
      .filter((cols) => cols.length === 2);

    expect(composites).toContainEqual([
      { name: "graduated", order: "asc" },
      { name: "curve_supply", order: "asc" },
    ]);
  });
});
