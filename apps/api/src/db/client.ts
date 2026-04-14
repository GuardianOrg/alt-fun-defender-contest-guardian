import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema.js";

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
