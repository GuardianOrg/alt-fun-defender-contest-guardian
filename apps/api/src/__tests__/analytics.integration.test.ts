import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import { createDb } from "../db/client.js";
import {
  fetchPlatformAggregates,
  fetchVolumeBuckets,
  fetchRevenueBuckets,
  fetchNetInflowBuckets,
  fetchNetInflowBaseline,
  fetchActiveUserBuckets,
  fetchUniqueTraderCount,
  fetchGraduationBuckets,
  fetchGraduationFunnelStats,
  fetchBreakdown,
  fetchTopTokens,
  fetchWindowedFees,
  fetchWindowedVolume,
} from "../lib/analytics-reads.js";

import type { AppBindings } from "../lib/types.js";

/**
 * Live-DB integration tests. Each `describe` block is gated on
 * `process.env.DATABASE_URL` so the suite is a no-op when the secret
 * isn't injected — that's both the local "I haven't sourced `.dev.vars`"
 * case and the CI "no `DATABASE_URL` configured on this repo" case.
 *
 * **Use a Neon branch URL, not production.** Per `.cursor/rules/testing.mdc`
 * ("Test database queries against a Neon branch, not production"), point
 * `DATABASE_URL` at a Neon branch of the launchpad project. The suite only
 * issues read-only `SELECT` queries against `ponder_views.*` and the
 * API-owned `public.tokens`, so hitting prod is technically safe — but a
 * branch removes the production read load and isolates the test from
 * concurrent schema changes. Spin one up via the Neon MCP or the Neon
 * console; branches are copy-on-write from production so the read shape
 * matches without re-indexing.
 *
 * A soft warning is logged when `DATABASE_URL` matches a production-looking
 * pattern; the suite still runs (don't break the existing local-dev path)
 * but the warning surfaces in test output so the operator sees the
 * recommendation. Detection is best-effort — pooler hostnames on Neon
 * are the high-signal pattern (`*-pooler.*.neon.tech`) since branch
 * connection strings carry distinct host slugs.
 *
 * The assertions are deliberately *shape-only* (not value-equality):
 *
 *   - Every SQL string we ship parses on the live Postgres planner.
 *   - The Drizzle `sql.raw` columns join cleanly against the
 *     `ponder_views.*` mirror.
 *   - Response envelopes match the union shape the dashboard expects.
 *
 * Values are not pinned because the live DB changes minute-to-minute.
 * The integration check is "can I make this query without exploding",
 * not "is the indexer at row count N".
 *
 * To run locally:
 *
 *   ```bash
 *   DATABASE_URL="<neon-branch-connection-string>" \
 *     npm test --workspace=@launchpad/api -- analytics.integration
 *   ```
 *
 * To run in CI, add `DATABASE_URL` as a GitHub Actions secret (point it
 * at a long-lived Neon branch) and the `api-analytics-integration` job in
 * `.github/workflows/ci.yml` picks it up.
 */

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const HAS_DB = DATABASE_URL.length > 0;

/**
 * Production-endpoint heuristic. Neon production pooler hostnames follow
 * the `<endpoint-slug>-pooler.<region>.aws.neon.tech` shape; branch
 * connection strings carry a distinct endpoint slug (e.g. `ep-branch-…`).
 * We can't reliably tell prod from branch on the *direct* connection
 * because both share the bare `*.aws.neon.tech` suffix — but the
 * project's prod string lives behind the pooler, so flagging that is
 * high-signal in practice. False negatives are acceptable (worst case:
 * a missed recommendation); false positives are not (we'd nag every
 * legit branch URL).
 */
function looksLikeProductionNeonUrl(url: string): boolean {
  if (url.length === 0) return false;
  // Match the prod-pooler host pattern in `.dev.vars` against any branch.
  // A genuine Neon branch URL gets a different `<endpoint-slug>` even
  // when going through a pooler, so the well-known prod slug
  // `ep-super-feather-am3pnzsa-pooler` is the smoking gun. Generic
  // "uses a pooler" isn't conclusive (branches can use poolers too)
  // so we keep this conservative — operators can rename their branch
  // slug to avoid the warning.
  return /ep-super-feather-am3pnzsa-pooler/.test(url);
}

if (HAS_DB && looksLikeProductionNeonUrl(DATABASE_URL)) {
  console.warn(
    "[analytics.integration] DATABASE_URL looks like the production Neon endpoint. " +
      "Per .cursor/rules/testing.mdc, please point it at a Neon branch for integration tests. " +
      "The suite is read-only so this isn't blocking, but a branch isolates the test from " +
      "production read load and concurrent schema changes.",
  );
}

function makeEnv(): AppBindings {
  return {
    DATABASE_URL,
    BOUNCETECH_DATABASE_URL: process.env.BOUNCETECH_DATABASE_URL ?? "",
    ADMIN_API_KEY: "integration-admin",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

// `describe.skipIf(!HAS_DB)` is a noop when the secret isn't injected, so
// `npm test` against a contributor's machine without DB creds passes
// without spurious skips cluttering the report — Vitest aggregates a
// single "skipped" line per gated block.
const describeWithDb = describe.skipIf(!HAS_DB);

describeWithDb("analytics-reads helpers (live DB)", () => {
  const db = HAS_DB ? createDb(DATABASE_URL) : null;

  it("fetchPlatformAggregates returns a complete shape", async () => {
    if (!db) return;
    const r = await fetchPlatformAggregates(db);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(typeof r.lifetimeProtocolFeesUsdcRaw).toBe("string");
    expect(typeof r.lifetimeCreatorFeesUsdcRaw).toBe("string");
    expect(typeof r.totalValueLockedUsdcRaw).toBe("string");
    expect(typeof r.lifetimeGrossVolumeUsdcRaw).toBe("string");
    expect(typeof r.cumulativeNetInflowUsdcRaw).toBe("string");
    expect(typeof r.uniqueTradersAllTime).toBe("number");
    expect(typeof r.uniqueCreatorsAllTime).toBe("number");
    // Counters can never go negative — protocol-side bug if they do.
    expect(Number(r.lifetimeProtocolFeesUsdcRaw)).toBeGreaterThanOrEqual(0);
    expect(Number(r.lifetimeCreatorFeesUsdcRaw)).toBeGreaterThanOrEqual(0);
    expect(r.uniqueTradersAllTime).toBeGreaterThanOrEqual(0);
    expect(r.uniqueCreatorsAllTime).toBeGreaterThanOrEqual(0);
  });

  it("fetchVolumeBuckets returns ordered (bucket, volume) rows", async () => {
    if (!db) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const since = nowSec - 30 * 86_400;
    const r = await fetchVolumeBuckets(db, {
      bucketSec: 86_400,
      sinceSec: since,
    });
    expect(r).not.toBeNull();
    if (r === null) return;
    for (let i = 1; i < r.length; i++) {
      expect(r[i].bucket).toBeGreaterThan(r[i - 1].bucket);
    }
    for (const row of r) {
      expect(Number.isFinite(row.bucket)).toBe(true);
      // Bucket-start must be aligned to `86_400`.
      expect(row.bucket % 86_400).toBe(0);
      expect(Number(row.volumeUsdcRaw)).toBeGreaterThanOrEqual(0);
    }
  });

  it("fetchVolumeBuckets handles sub-hour bucketing via router_trade", async () => {
    if (!db) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const since = nowSec - 60 * 60; // last hour
    const r = await fetchVolumeBuckets(db, {
      bucketSec: 60, // 1-minute buckets
      sinceSec: since,
    });
    expect(r).not.toBeNull();
    if (r === null) return;
    for (const row of r) {
      expect(row.bucket % 60).toBe(0);
      expect(Number(row.volumeUsdcRaw)).toBeGreaterThanOrEqual(0);
    }
  });

  it("fetchRevenueBuckets surfaces creator + protocol split", async () => {
    if (!db) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const since = nowSec - 30 * 86_400;
    const r = await fetchRevenueBuckets(db, {
      bucketSec: 86_400,
      sinceSec: since,
    });
    expect(r).not.toBeNull();
    if (r === null) return;
    for (const row of r) {
      expect(Number(row.protocolFeesUsdcRaw)).toBeGreaterThanOrEqual(0);
      expect(Number(row.creatorFeesUsdcRaw)).toBeGreaterThanOrEqual(0);
      expect(row.feeEvents).toBeGreaterThanOrEqual(0);
    }
  });

  it("fetchNetInflowBuckets allows negative net inflow rows", async () => {
    if (!db) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const since = nowSec - 30 * 86_400;
    const r = await fetchNetInflowBuckets(db, {
      bucketSec: 86_400,
      sinceSec: since,
    });
    expect(r).not.toBeNull();
    if (r === null) return;
    for (const row of r) {
      // `netInflow` is `sum(buy) - sum(sell)`, so a sell-heavy bucket
      // legitimately renders as negative. Just verify it parses.
      expect(() => BigInt(row.netInflowUsdcRaw)).not.toThrow();
      expect(Number(row.grossVolumeUsdcRaw)).toBeGreaterThanOrEqual(0);
    }
  });

  it("fetchNetInflowBaseline returns a parseable bigint string", async () => {
    if (!db) return;
    const r = await fetchNetInflowBaseline(db, 1_700_000_000);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(() => BigInt(r)).not.toThrow();
  });

  it("fetchActiveUserBuckets respects the threshold filter", async () => {
    if (!db) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const since = nowSec - 7 * 86_400;
    const r = await fetchActiveUserBuckets(db, {
      bucketSec: 86_400,
      sinceSec: since,
      thresholdUsdcRaw: "500000000",
    });
    expect(r).not.toBeNull();
    if (r === null) return;
    for (const row of r) {
      // `qualifiedTraders` is by construction a subset of `uniqueTraders`.
      expect(row.qualifiedTraders).toBeLessThanOrEqual(row.uniqueTraders);
      expect(row.uniqueTraders).toBeGreaterThanOrEqual(0);
    }
  });

  it("fetchUniqueTraderCount returns subset counts", async () => {
    if (!db) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const r = await fetchUniqueTraderCount(db, {
      sinceSec: nowSec - 30 * 86_400,
      thresholdUsdcRaw: "0",
    });
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.uniqueTraders).toBeGreaterThanOrEqual(r.qualifiedTraders);
  });

  it("fetchGraduationBuckets parses correctly", async () => {
    if (!db) return;
    const r = await fetchGraduationBuckets(db, {
      bucketSec: 86_400,
      sinceSec: 0,
    });
    expect(r).not.toBeNull();
    if (r === null) return;
    for (const row of r) {
      expect(row.graduations).toBeGreaterThanOrEqual(0);
      expect(row.bucket).toBeGreaterThan(0);
    }
  });

  it("fetchGraduationFunnelStats returns consistent counts", async () => {
    if (!db) return;
    const r = await fetchGraduationFunnelStats(db);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.totalGraduated).toBeLessThanOrEqual(r.totalLaunched);
    expect(r.totalPendingGraduation).toBeGreaterThanOrEqual(0);
    expect(r.graduationRatePct).toBeGreaterThanOrEqual(0);
    expect(r.graduationRatePct).toBeLessThanOrEqual(100);
    if (r.medianTimeToGraduateSec !== null) {
      expect(r.medianTimeToGraduateSec).toBeGreaterThanOrEqual(0);
    }
    if (r.meanTimeToGraduateSec !== null) {
      expect(r.meanTimeToGraduateSec).toBeGreaterThanOrEqual(0);
    }
  });

  it("fetchBreakdown(leverage) joins `public.tokens` and `ponder_views.token`", async () => {
    if (!db) return;
    const r = await fetchBreakdown(db, "leverage");
    expect(r).not.toBeNull();
    if (r === null) return;
    for (const row of r) {
      expect(row.tokenCount).toBeGreaterThan(0);
      expect(row.graduatedCount).toBeLessThanOrEqual(row.tokenCount);
      expect(Number(row.lifetimeVolumeUsdcRaw)).toBeGreaterThanOrEqual(0);
    }
  });

  it("fetchBreakdown(direction) parses correctly", async () => {
    if (!db) return;
    const r = await fetchBreakdown(db, "direction");
    expect(r).not.toBeNull();
    if (r === null) return;
    for (const row of r) {
      // `lt_direction` is 'long' or 'short'.
      expect(["long", "short"]).toContain(row.key);
    }
  });

  it("fetchBreakdown(underlying) parses correctly", async () => {
    if (!db) return;
    const r = await fetchBreakdown(db, "underlying");
    expect(r).not.toBeNull();
    if (r === null) return;
    for (const row of r) {
      expect(typeof row.key).toBe("string");
      expect(row.key.length).toBeGreaterThan(0);
    }
  });

  it("fetchBreakdown(lt_pair) parses correctly", async () => {
    if (!db) return;
    const r = await fetchBreakdown(db, "lt_pair");
    expect(r).not.toBeNull();
    if (r === null) return;
    for (const row of r) {
      // Lowercased 0x-prefixed Ethereum address (42 chars).
      expect(row.key).toMatch(/^0x[0-9a-f]{40}$/);
    }
  });

  it("fetchTopTokens(volume_lifetime) returns descending volume order", async () => {
    if (!db) return;
    const r = await fetchTopTokens(db, {
      sort: "volume_lifetime",
      limit: 10,
    });
    expect(r).not.toBeNull();
    if (r === null) return;
    for (let i = 1; i < r.length; i++) {
      const prev = BigInt(r[i - 1].lifetimeVolumeUsdcRaw);
      const curr = BigInt(r[i].lifetimeVolumeUsdcRaw);
      expect(prev >= curr).toBe(true);
    }
  });

  it("fetchTopTokens(protocol_fees_lifetime) returns descending fee order", async () => {
    if (!db) return;
    const r = await fetchTopTokens(db, {
      sort: "protocol_fees_lifetime",
      limit: 10,
    });
    expect(r).not.toBeNull();
    if (r === null) return;
    for (let i = 1; i < r.length; i++) {
      const prev = BigInt(r[i - 1].protocolFeesUsdcRaw);
      const curr = BigInt(r[i].protocolFeesUsdcRaw);
      expect(prev >= curr).toBe(true);
    }
  });

  it("fetchWindowedVolume + fetchWindowedFees handle 0-second sinceSec", async () => {
    if (!db) return;
    // Lifetime aggregates via `sinceSec = 0`.
    const [vol, fee] = await Promise.all([
      fetchWindowedVolume(db, 0),
      fetchWindowedFees(db, 0),
    ]);
    expect(vol).not.toBeNull();
    expect(fee).not.toBeNull();
    if (vol === null || fee === null) return;
    expect(Number(vol.grossVolumeUsdcRaw)).toBeGreaterThanOrEqual(0);
    expect(Number(fee.protocolFeesUsdcRaw)).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end route tests (real DB through full Hono pipeline).
// Mounts the analytics router under `/analytics` directly. No admin
// auth involved — these endpoints sit on the public `/api/v1/*` path
// behind `apiKeyAuth` in prod, and the test mounts the bare router
// without that middleware (same pattern as every other route's
// integration test).
// ---------------------------------------------------------------------------

describeWithDb("analytics routes (live DB, mounted directly)", () => {
  it("/overview returns a well-formed payload", async () => {
    if (!HAS_DB) return;
    const { default: analyticsRoute } = await import(
      "../routes/analytics.js"
    );
    const app = new Hono<{ Bindings: AppBindings }>();
    app.route("/analytics", analyticsRoute);

    const res = await app.request(
      "/analytics/overview",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      dataSource: string;
      data: {
        lifetime: { totalValueLockedUsd: number };
        graduation: { totalLaunched: number };
      };
    };
    expect(body.status).toBe("success");
    expect(["live", "degraded"]).toContain(body.dataSource);
    expect(typeof body.data.lifetime.totalValueLockedUsd).toBe("number");
    expect(typeof body.data.graduation.totalLaunched).toBe("number");
  });

  it("/volume returns a dense lookback series", async () => {
    if (!HAS_DB) return;
    const { default: analyticsRoute } = await import(
      "../routes/analytics.js"
    );
    const app = new Hono<{ Bindings: AppBindings }>();
    app.route("/analytics", analyticsRoute);
    const res = await app.request(
      "/analytics/volume?interval=day&lookback=7",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { series: Array<{ t: number; volumeUsd: number }> };
    };
    expect(body.data.series).toHaveLength(7);
    for (const row of body.data.series) {
      expect(typeof row.t).toBe("number");
      expect(typeof row.volumeUsd).toBe("number");
      expect(row.volumeUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it("/value-locked returns cumulative + snapshot", async () => {
    if (!HAS_DB) return;
    const { default: analyticsRoute } = await import(
      "../routes/analytics.js"
    );
    const app = new Hono<{ Bindings: AppBindings }>();
    app.route("/analytics", analyticsRoute);
    const res = await app.request(
      "/analytics/value-locked?interval=day&lookback=7",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        baselineUsdcRaw: string;
        series: Array<{ t: number; cumulativeNetInflowUsd: number }>;
        snapshot: { totalValueLockedUsd: number };
      };
    };
    expect(() => BigInt(body.data.baselineUsdcRaw)).not.toThrow();
    expect(body.data.series).toHaveLength(7);
    expect(typeof body.data.snapshot.totalValueLockedUsd).toBe("number");
  });

  it("/revenue-forecast returns flat + EWMA windows", async () => {
    if (!HAS_DB) return;
    const { default: analyticsRoute } = await import(
      "../routes/analytics.js"
    );
    const app = new Hono<{ Bindings: AppBindings }>();
    app.route("/analytics", analyticsRoute);
    const res = await app.request(
      "/analytics/revenue-forecast",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        flat: Record<string, { annualisedUsd: number }>;
        ewma: Record<string, { annualisedUsd: number }>;
        lifetimeAverage: { annualisedUsd: number };
        series: Array<{ t: number; protocolFeesUsd: number }>;
      };
    };
    expect(Object.keys(body.data.flat).sort()).toEqual([
      "last1d",
      "last30d",
      "last3d",
      "last7d",
      "last90d",
    ]);
    expect(Object.keys(body.data.ewma).sort()).toEqual([
      "halfLife14d",
      "halfLife30d",
      "halfLife7d",
    ]);
    expect(body.data.series).toHaveLength(120);
  });

  it("/active-users honours custom threshold", async () => {
    if (!HAS_DB) return;
    const { default: analyticsRoute } = await import(
      "../routes/analytics.js"
    );
    const app = new Hono<{ Bindings: AppBindings }>();
    app.route("/analytics", analyticsRoute);
    const res = await app.request(
      "/analytics/active-users?lookback=7&threshold=250",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        thresholdUsd: number;
        series: Array<{
          uniqueTraders: number;
          qualifiedTraders: number;
        }>;
      };
    };
    expect(body.data.thresholdUsd).toBe(250);
    for (const row of body.data.series) {
      expect(row.qualifiedTraders).toBeLessThanOrEqual(row.uniqueTraders);
    }
  });

  it("/breakdown?by=leverage joins both tables", async () => {
    if (!HAS_DB) return;
    const { default: analyticsRoute } = await import(
      "../routes/analytics.js"
    );
    const app = new Hono<{ Bindings: AppBindings }>();
    app.route("/analytics", analyticsRoute);
    const res = await app.request(
      "/analytics/breakdown?by=leverage",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        dimension: string;
        rows: Array<{ key: string; tokenCount: number }>;
      };
    };
    expect(body.data.dimension).toBe("leverage");
    for (const row of body.data.rows) {
      expect(row.tokenCount).toBeGreaterThan(0);
    }
  });

  it("/top-tokens returns rows in descending sort order", async () => {
    if (!HAS_DB) return;
    const { default: analyticsRoute } = await import(
      "../routes/analytics.js"
    );
    const app = new Hono<{ Bindings: AppBindings }>();
    app.route("/analytics", analyticsRoute);
    const res = await app.request(
      "/analytics/top-tokens?sort=volume_lifetime&limit=5",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        sort: string;
        rows: Array<{ lifetimeVolumeUsdcRaw: string }>;
      };
    };
    expect(body.data.sort).toBe("volume_lifetime");
    for (let i = 1; i < body.data.rows.length; i++) {
      const prev = BigInt(body.data.rows[i - 1].lifetimeVolumeUsdcRaw);
      const curr = BigInt(body.data.rows[i].lifetimeVolumeUsdcRaw);
      expect(prev >= curr).toBe(true);
    }
  });
});
