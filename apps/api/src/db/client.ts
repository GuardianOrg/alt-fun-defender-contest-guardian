import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as apiSchema from "./schema.js";
import * as indexerSchema from "./indexer-schema.js";

/**
 * Combined Drizzle schema covering both:
 *
 *   - The API's own `public.*` tables (`tokens`, `api_keys`, …).
 *   - The indexer's `ponder_prod.*` tables exposed read-only via the
 *     handles in `indexer-schema.ts`.
 *
 * They live in the same Neon database, so a single Drizzle instance can
 * address both. Drizzle scopes each query by the table object the caller
 * imports — the API tables resolve to `public.*` and the indexer ones to
 * `ponder_prod.*` (via `pgSchema(...)` in `indexer-schema.ts`).
 *
 * This is the foundation for the "read direct from Postgres" migration off
 * the Ponder GraphQL hop. See `lib/indexer-reads.ts` for the typed read
 * helpers callers should prefer over hand-rolled `db.select()`s.
 */
const schema = { ...apiSchema, ...indexerSchema };

const dbCache = new Map<string, ReturnType<typeof drizzle<typeof schema>>>();

export function createDb(databaseUrl: string) {
  const cached = dbCache.get(databaseUrl);
  if (cached) return cached;

  const sql = neon(databaseUrl);
  const db = drizzle(sql, { schema });
  dbCache.set(databaseUrl, db);
  return db;
}

export type Database = ReturnType<typeof createDb>;
