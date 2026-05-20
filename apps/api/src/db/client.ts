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
 * Driver options mirror Cloudflare's canonical Hyperdrive + postgres.js
 * example verbatim — see
 * https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/postgres-js/
 *
 * - `max: 5` — Workers' runtime caps concurrent outbound TCP per request
 *   at a small number (canonical guidance is 5). Each Worker request
 *   creates its own `postgres()` client, so this is the per-request
 *   pool, NOT the fleet-wide cap. Fleet throughput is bounded by
 *   Hyperdrive's `origin_connection_limit` (currently 60 → Neon),
 *   multiplexed across all in-flight Worker requests; bumping `max`
 *   past 5 doesn't get us closer to Neon's `max_connections` ceiling
 *   and actively triggers the `Network connection lost.` mode the
 *   2026-05-20T17:37 deploy was hitting (postgres.js queues queries on
 *   connections that the runtime tears down at request end).
 * - `fetch_types: false` — skip the per-isolate type-introspection
 *   round-trip postgres.js otherwise issues on first connect. We don't
 *   use array types or anything else that needs it, and CF's docs call
 *   this out as a latency contributor in Workers.
 * - `prepare: true` — required for Hyperdrive's prepared-statement
 *   cache to participate. postgres.js' default; listed explicitly so
 *   the next reader doesn't have to dig.
 *
 * Do NOT pass `types: {}` — it replaces every default type parser
 * (boolean, date, numeric, etc.) with empty handlers, so booleans come
 * back as raw text `"f"`/`"t"` and corrupt prepared-statement parameter
 * slots when paired with `prepare: true` (see
 * `PostgresError: invalid input syntax for type bigint: "f"` cluster
 * captured 2026-05-20T17:43Z, hours after the initial Hyperdrive
 * cutover).
 *
 * Do NOT call `client.end()` per-request either — the postgres.js +
 * Workers combo has a known bug where `.end()` after an interrupted
 * socket can hang indefinitely
 * (https://github.com/porsager/postgres/issues/1097). The Workers
 * runtime tears down the I/O context at request end, which is the
 * right cleanup behaviour here. CF's own example does not call
 * `.end()`.
 */
export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    max: 5,
    fetch_types: false,
    prepare: true,
  });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
