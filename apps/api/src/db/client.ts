import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as apiSchema from "./schema.js";
import * as indexerSchema from "./indexer-schema.js";

/**
 * Combined Drizzle schema covering both:
 *
 *   - The API's own `public.*` tables (`tokens`, `api_keys`, …).
 *   - The indexer's `ponder_views.*` views exposed read-only via the
 *     handles in `indexer-schema.ts`.
 *
 * They live in the same Neon database, so a single Drizzle instance can
 * address both. Drizzle scopes each query by the table object the caller
 * imports — the API tables resolve to `public.*` and the indexer ones to
 * `ponder_views.*` (via `pgSchema(...)` in `indexer-schema.ts`).
 *
 * `ponder_views` is the stable views layer; the underlying tables live in
 * a per-deploy schema (`$RAILWAY_DEPLOYMENT_ID`) that flips on every
 * indexer redeploy. See `apps/api/src/db/indexer-schema.ts` for the full
 * lifecycle.
 */
const schema = { ...apiSchema, ...indexerSchema };

/**
 * Build a Drizzle instance backed by `postgres.js` (`postgres`) talking
 * through Cloudflare Hyperdrive's pooled, edge-terminated connection.
 *
 * `connectionString` is the per-Worker virtual URL exposed by the
 * `HYPERDRIVE` binding — pass `c.env.HYPERDRIVE.connectionString` at every
 * call site, never the raw Neon URL. Hyperdrive performs the TLS + SCRAM
 * handshake once at the nearest Cloudflare POP, keeps a pool of hot TCP
 * connections to the origin database pre-warmed, and edge-caches read
 * query results for ~60s.
 *
 * Per-request, NOT per-isolate: Workers' runtime invalidates an I/O
 * context (sockets in particular) once the request that created it
 * resolves. A `postgres()` instance reused across requests fails on the
 * second query with `CONNECTION_ENDED` / "Cannot perform I/O on behalf of
 * a different request" — see Hyperdrive's troubleshooting matrix. We
 * therefore call `postgres(...)` fresh inside every `createDb(...)` call.
 * Hyperdrive's own pool absorbs the work the per-isolate `dbCache` Map
 * used to do back when the underlying driver was
 * `@neondatabase/serverless`'s stateless HTTP transport — a fresh client
 * here just borrows a pre-warmed connection from the POP-local pool.
 *
 * `prepare: true` is the postgres.js default and is required for
 * Hyperdrive's query cache to participate; leaving it on is intentional.
 */
export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    // Leaving `prepare: true` (postgres.js default) is required for
    // Hyperdrive's query cache to recognise our reads as cacheable.
    // Listed explicitly so the next reader doesn't have to dig.
    prepare: true,
    // postgres.js' default `types` handlers subscribe to a couple of
    // Postgres OIDs we don't use and they don't fully load under
    // `nodejs_compat` (no `process.binding`). Empty handler list = no-op
    // and matches the Cloudflare postgres.js example.
    types: {},
  });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
