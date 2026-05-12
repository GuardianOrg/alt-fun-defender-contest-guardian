import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit is retained ONLY for `npm run db:studio` (ad-hoc DB inspection).
 *
 * We do **not** use drizzle-kit migrations. There is no migration runner in
 * CI, and `src/db/migrations/` has been removed intentionally — see
 * `.cursor/rules/migrations.mdc` for the actual schema-change flow (Neon
 * MCP `prepare_database_migration` / `complete_database_migration`, raised
 * explicitly with the operator).
 *
 * Do not re-add `out:` here, and do not re-introduce `db:generate` /
 * `db:migrate` / `db:push` scripts. They imply automation that doesn't
 * exist, and have already caused at least one prod outage (the BRENTOIL
 * `underlying varchar(10)` overflow — schema bumped to varchar(24) in PR
 * #433, prod DB column never widened, four BRENTOIL tokens silently 500'd
 * on registration for days).
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
