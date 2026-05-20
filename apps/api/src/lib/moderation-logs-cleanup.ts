/**
 * Daily retention sweep for the `moderation_logs` table.
 *
 * The table grows monotonically — one row per upload (`approved`,
 * `rejected`, or `pending_review`), each carrying a JSON `classifications`
 * blob. There is no abuse vector here (the abuse defences in #509 / #510
 * cap the *rate* of new rows); this is pure cost/storage hygiene to bound
 * the *lifetime* of old ones.
 *
 * Retention policy (issue #511):
 *   - `approved`        → 90 days. Noise after the appeal window closes.
 *   - `rejected`        → 365 days. Longer window for moderation appeals
 *                         and abuse-pattern analysis.
 *   - `pending_review`  → NEVER deleted. These rows are waiting on a
 *                         human action via the admin endpoints; silently
 *                         dropping them would lose the queue.
 *
 * The sweep is idempotent — a retry that finds nothing left to delete is
 * a no-op. Safe to re-run.
 */

import { sql, and, eq, lt } from "drizzle-orm";

import { createDb } from "../db/client.js";
import { moderationLogs } from "../db/schema.js";
import type { AppBindings } from "./types.js";

export const APPROVED_RETENTION_DAYS = 90;
export const REJECTED_RETENTION_DAYS = 365;

/**
 * Daily-tick gate. The Worker cron fires every minute (see
 * `wrangler.json` — `"* * * * *"`) because the LT-ticker kickstart, the
 * graduation keeper, and the registration backfill all need 1-minute
 * cadence. Without this gate, the cleanup would thrash the table 1,440×
 * per day for no reason.
 *
 * 03:17 UTC is intentionally *off the hour*. Cloudflare's fleet runs
 * disproportionately many jobs at `:00` (the cron `"0 * * * *"` pattern),
 * so picking a non-zero minute is a cheap reliability hint. If the
 * 03:17 tick is ever dropped, the sweep simply runs the next day —
 * harmless given the 90 / 365 day retention windows.
 */
export const CLEANUP_HOUR_UTC = 3;
export const CLEANUP_MINUTE_UTC = 17;

export function shouldRunModerationLogsCleanup(now: Date): boolean {
  return (
    now.getUTCHours() === CLEANUP_HOUR_UTC &&
    now.getUTCMinutes() === CLEANUP_MINUTE_UTC
  );
}

export interface ModerationLogsCleanupResult {
  deletedApproved: number;
  deletedRejected: number;
  remainingRows: number;
  estimatedSizeBytes: number | null;
}

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Run the daily moderation-logs retention sweep.
 *
 * Returns `null` if the gate didn't match (the common case — 1,439 of
 * every 1,440 cron ticks). Returns the per-decision delete counts and
 * post-cleanup observability metrics on the one tick per day that does
 * run.
 *
 * The function is designed to be wrapped in `ctx.waitUntil(...catch(...))`
 * by the caller so any failure is logged but never blocks the rest of
 * the scheduled handler — same pattern as the other cron jobs.
 */
export async function runModerationLogsCleanup(
  env: AppBindings,
  now: Date = new Date(),
): Promise<ModerationLogsCleanupResult | null> {
  if (!shouldRunModerationLogsCleanup(now)) return null;

  const db = createDb(env.DATABASE_URL);

  const approvedCutoff = new Date(
    now.getTime() - APPROVED_RETENTION_DAYS * MILLIS_PER_DAY,
  );
  const rejectedCutoff = new Date(
    now.getTime() - REJECTED_RETENTION_DAYS * MILLIS_PER_DAY,
  );

  // `.returning({ id })` gives an exact delete count without a separate
  // `SELECT count(*)` round trip and without racing the delete against
  // concurrent inserts. The returned array is bounded by the
  // retention-edge slice, which at our scale is tiny — even at 10K
  // uploads/day the day-90 slice is ~10K rows, well within an HTTP
  // round-trip budget.
  //
  // Decisions are *enumerated explicitly* rather than excluding
  // `pending_review` — a future "needs_appeal" or "auto_rejected"
  // status added without updating this file must not be silently
  // swept.
  const deletedApproved = await db
    .delete(moderationLogs)
    .where(
      and(
        eq(moderationLogs.decision, "approved"),
        lt(moderationLogs.createdAt, approvedCutoff),
      ),
    )
    .returning({ id: moderationLogs.id });

  const deletedRejected = await db
    .delete(moderationLogs)
    .where(
      and(
        eq(moderationLogs.decision, "rejected"),
        lt(moderationLogs.createdAt, rejectedCutoff),
      ),
    )
    .returning({ id: moderationLogs.id });

  // Post-cleanup observability: how many rows we kept and how much
  // disk that costs. Both are best-effort — a failure to fetch them
  // must never mask the successful delete in the logs, so each lives
  // in its own try/catch and falls through to the summary log.
  let remainingRows = 0;
  try {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(moderationLogs);
    remainingRows = row?.count ?? 0;
  } catch (err) {
    log("warn", "moderation_logs_cleanup_count_failed", describeError(err));
  }

  let estimatedSizeBytes: number | null = null;
  try {
    estimatedSizeBytes = await fetchTableSize(db);
  } catch (err) {
    log("warn", "moderation_logs_cleanup_size_failed", describeError(err));
  }

  const result: ModerationLogsCleanupResult = {
    deletedApproved: deletedApproved.length,
    deletedRejected: deletedRejected.length,
    remainingRows,
    estimatedSizeBytes,
  };

  log("info", "moderation_logs_cleanup_completed", { ...result });

  return result;
}

/**
 * `pg_total_relation_size` includes indexes and TOAST — the value that
 * matches what you'd see in `pg_class` for capacity-planning purposes.
 * Cast through `text` because the underlying type is `bigint` and the
 * neon-http JSON pipe doesn't promise a safe integer round-trip for
 * values > 2^53 (we'd never hit that for this table, but the explicit
 * `Number(...)` parse keeps the contract honest).
 */
async function fetchTableSize(
  db: ReturnType<typeof createDb>,
): Promise<number | null> {
  const raw = await db.execute(
    sql`SELECT pg_total_relation_size('moderation_logs')::text AS size`,
  );

  // The neon-http result shape carries rows on a `.rows` property
  // (`NeonHttpQueryResult`); other drizzle drivers may return the rows
  // directly as an array. Handle both shapes so a future driver swap
  // (or a test mock that returns plain rows) doesn't silently lose the
  // value.
  const rows = isQueryResultWithRows(raw)
    ? raw.rows
    : (raw as Array<{ size?: string | number }>);
  const size = rows?.[0]?.size;
  if (size == null) return null;
  const parsed = Number(size);
  return Number.isFinite(parsed) ? parsed : null;
}

function isQueryResultWithRows(
  value: unknown,
): value is { rows: Array<{ size?: string | number }> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "rows" in value &&
    Array.isArray((value as { rows: unknown }).rows)
  );
}

function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { error: err.message };
  }
  return { error: String(err) };
}

function log(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      level,
      event,
      ...fields,
      timestamp: new Date().toISOString(),
    }),
  );
}
