import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

const dbCache = new Map<string, ReturnType<typeof drizzle<typeof schema>>>();

export function createDb(databaseUrl: string) {
  const cached = dbCache.get(databaseUrl);
  if (cached) return cached;

  const client = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
  const db = drizzle(client, { schema });
  dbCache.set(databaseUrl, db);
  return db;
}

export type Database = ReturnType<typeof createDb>;
