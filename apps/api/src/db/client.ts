import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
