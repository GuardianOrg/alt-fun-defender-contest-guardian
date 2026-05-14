import { Hono } from "hono";

import { createDb } from "../db/client.js";
import formatSuccess from "../utils/format-success.js";
import { fetchPlatformStats } from "../lib/indexer-reads.js";

import type { AppBindings } from "../lib/types.js";

const stats = new Hono<{ Bindings: AppBindings }>();

const SECONDS_PER_HOUR = 3600;

/**
 * Platform-wide stats. Two cheap reads replace the old "paginate every token
 * + every 24h trade" approach (issue #397):
 *
 *   1. `ponder_prod.global_stats` singleton — token counts and lifetime
 *      volume, kept in lockstep on every TokenLaunched / TokenGraduated /
 *      Zap.Buy / Zap.Sell by the indexer.
 *   2. `ponder_prod.hourly_volume` — one row per hour-start, summed across
 *      the last 25 buckets by Postgres so `volume24h` falls out of a
 *      bounded-cost aggregation.
 *
 * As of the GraphQL → direct-SQL migration both reads go through Drizzle on
 * the existing Neon connection (`lib/indexer-reads.ts`), eliminating the
 * Ponder GraphQL hop that was the bottleneck under launch traffic.
 *
 * The endpoint also sets a short `s-maxage` so the Cloudflare edge absorbs
 * concurrent requests (the values move slowly enough that 30s of staleness is
 * imperceptible).
 */
stats.get("/", async (c) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  // Anchor the 24h window at the current hour-start so the bucket scan
  // matches indexer-side keying. We scan 25 buckets so the rolling window
  // always covers a full 24h regardless of where in the hour we land.
  const currentHourStart =
    Math.floor(nowSeconds / SECONDS_PER_HOUR) * SECONDS_PER_HOUR;
  const windowStart = currentHourStart - 24 * SECONDS_PER_HOUR;

  const db = createDb(c.env.DATABASE_URL);
  const result = await fetchPlatformStats(db, windowStart);

  if (!result) {
    // Indexer-table read threw (e.g. Neon pool exhaustion) — emit zeros with
    // `degraded` so the landing page still renders something while the
    // upstream issue resolves. The 503 alternative would blank the homepage
    // banner outright, which is a worse failure mode.
    setStatsCacheHeader(c);
    return c.json(
      formatSuccess(
        {
          tokensLive: 0,
          tokensGraduated: 0,
          totalTokens: 0,
          volume24h: "0",
        },
        "degraded",
      ),
    );
  }

  const singleton = result.singleton;
  const totalTokens = singleton ? singleton.totalTokens : 0;
  const tokensLive = singleton ? singleton.tokensLive : 0;
  const tokensGraduated = singleton ? singleton.tokensGraduated : 0;

  setStatsCacheHeader(c);
  return c.json(
    formatSuccess(
      {
        tokensLive,
        tokensGraduated,
        totalTokens,
        volume24h: result.volume24h.toString(),
      },
      "live",
    ),
  );
});

/**
 * Edge-cache for 30s + serve-stale-while-revalidate for 60s. The numbers
 * change slowly (totalTokens at most a few times an hour, volume24h on every
 * trade) and the UI surface is the homepage banner — staleness is invisible.
 * Critically this means a viral page-load only ever fans 1 request per region
 * per 30s through to the indexer DB.
 */
function setStatsCacheHeader(c: { header: (k: string, v: string) => void }) {
  c.header(
    "Cache-Control",
    "public, s-maxage=30, stale-while-revalidate=60",
  );
}

export default stats;
