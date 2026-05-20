import { Hono } from "hono";

import { createDb } from "../db/client.js";
import { checkIndexerHealth } from "../lib/indexer-reads.js";
import formatSuccess from "../utils/format-success.js";

import type { AppBindings } from "../lib/types.js";

const health = new Hono<{ Bindings: AppBindings }>();

/**
 * Liveness/readiness probe for upstream load balancers and external uptime
 * monitors. Probes the read path the API actually depends on — direct
 * Postgres via Drizzle (`lib/indexer-reads.ts`) — not the legacy Ponder
 * GraphQL hop, which no read path consults anymore (the only remaining
 * GraphQL consumer is `routes/chart.ts`, tracked separately for migration).
 *
 * Why this matters operationally (issue #931):
 *   - Correctness. Pre-migration `/health` flagged the API as `degraded`
 *     on transient Ponder GraphQL hiccups even when every route the API
 *     actually serves was healthy via direct SQL — the probe and the
 *     traffic path had drifted apart.
 *   - Latency. The legacy probe round-tripped through Railway with a 3 s
 *     timeout; the direct-SQL probe shares the warm Neon HTTP session and
 *     returns in single-digit milliseconds, so `/health` no longer becomes
 *     the slowest endpoint in the deploy on a slow GraphQL day.
 *   - Load. Each probe was an extra Ponder query against the system the
 *     API explicitly stopped depending on; that load is now gone.
 *
 * Response shape is deliberately unchanged so external monitors don't
 * break. The `services.ponder` field name is preserved for compatibility,
 * but the value now reflects the direct-Postgres indexer read path's
 * reachability — the field's semantics shifted, the contract didn't. If
 * we ever rename the field we'll co-publish a `services.indexer` alias
 * for one release before retiring `ponder`.
 */
health.get("/", async (c) => {
  const indexerHealthy = await checkIndexerHealth(
    createDb(c.env.HYPERDRIVE.connectionString),
  );
  return c.json(
    formatSuccess({
      status: indexerHealthy ? "healthy" : "degraded",
      services: {
        api: true,
        ponder: indexerHealthy,
      },
    }),
  );
});

export default health;
