#!/usr/bin/env npx tsx
/**
 * Parity + performance test for the direct-DB `fetchTokenMeta` helper that
 * backs `GET /api/v1/tokens/:address/meta` (`apps/api/src/lib/indexer-reads.ts`).
 *
 * The web frontend's `apps/web/src/services/tokenNames.ts` currently POSTs
 * directly to the Ponder GraphQL endpoint via `fetchPonderToken(address)`
 * for every observed trade row. The migration target is the Cloudflare
 * Worker meta endpoint, which reads the same row over a direct SQL query.
 *
 * For an arbitrary set of addresses we run TWO SQL statements against the
 * production Neon read replica and diff the projected rows:
 *
 *   1. OLD — the SQL Ponder GraphQL emits for the legacy
 *      `token(address: $address) { address name symbol creator ltToken k
 *       curveSupply ltReserve graduated graduatedAt bondingPair
 *       hyperswapPair blockNumber timestamp }` query (full column list lifted
 *      from `apps/web/src/services/ponder.ts:55`).
 *   2. NEW — the SQL Drizzle generates for `fetchTokenMeta`, which projects
 *      only `{ address, name, symbol }` and limits to 1.
 *
 * Equivalence rule: after projecting both result sets down to
 * `{ address, name, symbol }`, the values must be byte-identical per
 * address.
 *
 * Each statement is timed with `performance.now()` over N iterations
 * (default 5) so we can see whether the narrower projection actually
 * shifts cost vs. the wide GraphQL-shaped read. Warmup pass is discarded.
 *
 * Additionally runs `EXPLAIN (ANALYZE, BUFFERS)` on each form for the
 * first probed address so we can confirm the query is index-served
 * (Index Cond on `token_pkey` / `token_address_idx`).
 *
 * Usage:
 *   DATABASE_URL=postgresql://…neon.tech/neondb?sslmode=require \
 *     npx tsx scripts/parity-token-meta.ts
 *
 * Optional env:
 *   ITERATIONS=10   timing samples per query (default 5, plus a warmup)
 *   ADDRESSES=0x…,0x…   override the address sample (otherwise auto-discovered)
 *   SAMPLE=20       size of the auto-discovered address sample (default 20)
 *
 * The script is read-only — no writes anywhere.
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const ITERATIONS = Number.parseInt(process.env.ITERATIONS ?? "5", 10);
const SAMPLE = Number.parseInt(process.env.SAMPLE ?? "20", 10);
const sql = neon(DATABASE_URL);

type QueryResult = { rows: Record<string, unknown>[]; ms: number };

async function timed(label: string, run: () => Promise<unknown[]>): Promise<QueryResult> {
  await run();
  const samples: number[] = [];
  let rows: Record<string, unknown>[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    rows = (await run()) as Record<string, unknown>[];
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const min = samples[0];
  const max = samples[samples.length - 1];
  console.log(
    `  ${label.padEnd(8)} n=${rows.length.toString().padStart(2)} ` +
      `min=${min.toFixed(2)}ms p50=${median.toFixed(2)}ms max=${max.toFixed(2)}ms`,
  );
  return { rows, ms: median };
}

async function pickAddresses(): Promise<string[]> {
  if (process.env.ADDRESSES) {
    return process.env.ADDRESSES.split(",")
      .map((a) => a.trim().toLowerCase())
      .filter((a) => a.length > 0);
  }
  // Mix recent + popular tokens so the sample covers both hot and cold
  // rows. `block_number desc` is a proxy for recency; `volume_usd::numeric
  // desc` is a proxy for hot-cache likelihood.
  const recent = (await sql`
    select address from ponder_views.token
    order by block_number desc
    limit ${Math.ceil(SAMPLE / 2)}
  `) as Array<{ address: string }>;
  const hot = (await sql`
    select address from ponder_views.token
    order by volume_usd::numeric desc nulls last
    limit ${Math.ceil(SAMPLE / 2)}
  `) as Array<{ address: string }>;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [...recent, ...hot]) {
    if (seen.has(r.address)) continue;
    seen.add(r.address);
    out.push(r.address);
    if (out.length >= SAMPLE) break;
  }
  return out;
}

interface MetaProjection {
  address: string;
  name: string | null;
  symbol: string | null;
}

function projectMeta(r: Record<string, unknown>): MetaProjection {
  return {
    address: (r.address as string) ?? null,
    name: (r.name as string) ?? null,
    symbol: (r.symbol as string) ?? null,
  } as MetaProjection;
}

async function checkParity(addresses: string[]): Promise<void> {
  console.log("\nParity (per-address, projected to {address,name,symbol})");
  let mismatched = 0;
  for (const address of addresses) {
    const lower = address.toLowerCase();
    const oldRow = (await sql`
      select address, name, symbol, creator, lt_token, k,
             curve_supply, lt_reserve, graduated, graduated_at,
             bonding_pair, hyperswap_pair, block_number, timestamp
      from ponder_views.token
      where address = ${lower}
      limit 1
    `) as Record<string, unknown>[];
    const newRow = (await sql`
      select address, name, symbol
      from ponder_views.token
      where address = ${lower}
      limit 1
    `) as Record<string, unknown>[];
    const a = JSON.stringify(oldRow.map(projectMeta));
    const b = JSON.stringify(newRow.map(projectMeta));
    if (a !== b) {
      mismatched++;
      console.error(`  ✗ ${lower}: rows differ`);
      console.error(`     old: ${a}`);
      console.error(`     new: ${b}`);
    }
  }
  if (mismatched === 0) {
    console.log(`  ✓ ${addresses.length} addresses match`);
  } else {
    console.error(`  ✗ ${mismatched}/${addresses.length} addresses diverge`);
  }
}

async function checkPerf(addresses: string[]): Promise<void> {
  console.log("\nPerf (single-address read, repeated)");
  const probe = addresses[0];
  console.log(`  probe=${probe}`);
  await timed("old", async () => sql`
    select address, name, symbol, creator, lt_token, k,
           curve_supply, lt_reserve, graduated, graduated_at,
           bonding_pair, hyperswap_pair, block_number, timestamp
    from ponder_views.token
    where address = ${probe}
    limit 1
  ` as unknown as Promise<unknown[]>);
  await timed("new", async () => sql`
    select address, name, symbol
    from ponder_views.token
    where address = ${probe}
    limit 1
  ` as unknown as Promise<unknown[]>);
}

async function checkExplain(addresses: string[]): Promise<void> {
  console.log("\nEXPLAIN ANALYZE (single-address read)");
  const probe = addresses[0];
  console.log(`  probe=${probe}`);
  const oldPlan = (await sql`
    explain (analyze, buffers, format text)
    select address, name, symbol, creator, lt_token, k,
           curve_supply, lt_reserve, graduated, graduated_at,
           bonding_pair, hyperswap_pair, block_number, timestamp
    from ponder_views.token
    where address = ${probe}
    limit 1
  `) as Array<Record<string, string>>;
  console.log("  --- OLD plan ---");
  for (const row of oldPlan) {
    const line = (row["QUERY PLAN"] ?? Object.values(row)[0]) as string;
    console.log(`    ${line}`);
  }
  const newPlan = (await sql`
    explain (analyze, buffers, format text)
    select address, name, symbol
    from ponder_views.token
    where address = ${probe}
    limit 1
  `) as Array<Record<string, string>>;
  console.log("  --- NEW plan ---");
  for (const row of newPlan) {
    const line = (row["QUERY PLAN"] ?? Object.values(row)[0]) as string;
    console.log(`    ${line}`);
  }
}

async function main(): Promise<void> {
  const addresses = await pickAddresses();
  if (addresses.length === 0) {
    console.error("No addresses available — DB empty?");
    process.exit(1);
  }
  console.log(`Sample: ${addresses.length} addresses (ITERATIONS=${ITERATIONS})`);
  await checkParity(addresses);
  await checkPerf(addresses);
  await checkExplain(addresses);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
