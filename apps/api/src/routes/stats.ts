import { Hono } from "hono";

import formatSuccess from "../utils/format-success.js";
import { createPonderQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const stats = new Hono<{ Bindings: AppBindings }>();

interface PonderGlobalStats {
  totalTokens: string | null;
  tokensLive: string | null;
  tokensGraduated: string | null;
  totalVolumeUsd: string | null;
}

interface PonderHourlyVolumeItem {
  hourStart: string;
  volumeUsd: string;
}

const SECONDS_PER_HOUR = 3600;

/**
 * Platform-wide stats. Two cheap queries replace the old "paginate every
 * token + every 24h trade" approach (issue #397):
 *
 *   1. `globalStats` singleton — token counts and lifetime volume, kept in
 *      lockstep on every TokenLaunched / TokenGraduated / Zap.Buy / Zap.Sell
 *      by the indexer (`apps/indexer/src/bonding.ts`).
 *   2. `hourlyVolumes` — one row per hour-start, summed across the last 24
 *      buckets to derive `volume24h`. Bounded scan (≤24 rows) regardless of
 *      how many trades the platform processes.
 *
 * The endpoint also sets a short `s-maxage` so the Cloudflare edge absorbs
 * concurrent requests (the values move slowly enough that 30s of staleness is
 * imperceptible, but it keeps Ponder protected from a thundering herd if the
 * landing page is suddenly viral).
 */
stats.get("/", async (c) => {
  const queryPonder = createPonderQuery(c.env.PONDER_URL);

  const nowSeconds = Math.floor(Date.now() / 1000);
  // Anchor the 24h window at the current hour-start so the bucket scan
  // matches indexer-side keying. We scan 25 buckets so the rolling window
  // always covers a full 24h regardless of where in the hour we land.
  const currentHourStart = Math.floor(nowSeconds / SECONDS_PER_HOUR) * SECONDS_PER_HOUR;
  const windowStart = currentHourStart - 24 * SECONDS_PER_HOUR;

  const data = await queryPonder<{
    globalStats: PonderGlobalStats | null;
    hourlyVolumes: { items: PonderHourlyVolumeItem[] } | null;
  }>(
    `query ($since: BigInt!) {
      globalStats(id: "global") {
        totalTokens
        tokensLive
        tokensGraduated
        totalVolumeUsd
      }
      hourlyVolumes(where: { hourStart_gte: $since }, limit: 25) {
        items {
          hourStart
          volumeUsd
        }
      }
    }`,
    { since: String(windowStart) },
  );

  if (!data) {
    // Indexer outage — emit zeros with `degraded` so the UI can render
    // something while the LandingPage doesn't know how to handle a 503 here.
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

  const singleton = data.globalStats;
  const totalTokens = singleton ? Number(singleton.totalTokens ?? "0") : 0;
  const tokensLive = singleton ? Number(singleton.tokensLive ?? "0") : 0;
  const tokensGraduated = singleton ? Number(singleton.tokensGraduated ?? "0") : 0;

  // Sum the windowed buckets. Sourced from `hourlyVolume`, which the indexer
  // keys by hour-start Unix timestamp on every Zap.Buy / Zap.Sell.
  const buckets = data.hourlyVolumes?.items ?? [];
  let volume24h = 0n;
  for (const b of buckets) {
    volume24h += BigInt(b.volumeUsd);
  }

  setStatsCacheHeader(c);
  return c.json(
    formatSuccess(
      {
        tokensLive,
        tokensGraduated,
        totalTokens,
        volume24h: volume24h.toString(),
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
 * per 30s through to Ponder.
 */
function setStatsCacheHeader(c: { header: (k: string, v: string) => void }) {
  c.header(
    "Cache-Control",
    "public, s-maxage=30, stale-while-revalidate=60",
  );
}

export default stats;
