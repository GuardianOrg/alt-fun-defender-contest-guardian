/**
 * Daily retention sweep for R2 token-image objects that never made it
 * onto a launched token.
 *
 * The upload pipeline writes every accepted image to R2 under the
 * `tokens/` prefix immediately after OpenAI moderation passes — see
 * `routes/images.ts`. Most of those images go on to be stamped into
 * `LaunchParams.image` on-chain by the next `Zap.createToken` call,
 * which is picked up off-chain by the registration flow
 * (`token-registration.ts`) and stored as `tokens.imageUrl`.
 *
 * Two failure modes leave objects in R2 with no corresponding token row:
 *
 *   1. **Abandoned flow.** The user clicks Launch, the image uploads,
 *      then they reject the wallet popup / lose network / close the
 *      tab. Image is in R2 forever; no token references it.
 *
 *   2. **Spam.** A bypass of the front-end (or a leaked API key) calls
 *      `POST /api/v1/images` in a loop. The Cloudflare WAF rate-limit
 *      caps it at 5 req/min/IP, but a determined attacker rotating IPs
 *      can still accumulate orphans over time.
 *
 * Both are pure storage-cost hygiene (R2 bills per GB-month and per
 * 1K Class B operations). This sweep runs daily, lists R2 under the
 * `tokens/` prefix, and deletes every object that:
 *
 *   - is older than `GRACE_PERIOD_HOURS` (24h — much longer than the
 *     time between image upload and on-chain `Zap.createToken` landing,
 *     which is seconds to minutes via the new "upload-on-click" path
 *     in `useCreateToken`),
 *   - is not referenced by any row in the `tokens` table (i.e. no
 *     launched token has `imageUrl = /images/tokens/<key>`),
 *   - is not flagged `pending_review` in `moderation_logs` (those wait
 *     on a human admin via the moderation routes; silently dropping
 *     them would lose the queue).
 *
 * Issue #554.
 */

import { eq } from "drizzle-orm";

import { createDb } from "../db/client.js";
import { moderationLogs, tokens } from "../db/schema.js";
import type { AppBindings } from "./types.js";

/**
 * Minimum age before an R2 object becomes eligible for cleanup.
 *
 * The create flow uploads the image inside `useCreateToken.create()`
 * after vanity mining completes (so the page can sit open for minutes
 * during proof-of-work mining without the image ever touching R2).
 * From upload to `Zap.createToken` landing is then permit-sign +
 * tx-confirm — seconds to a minute in the steady state, a few minutes
 * worst case if the wallet is slow.
 *
 * 24h is ~3 orders of magnitude over the typical window and leaves a
 * comfortable buffer for any edge case (e.g. a user uploading, hitting
 * a transient API error, and retrying tens of minutes later). The
 * registration backfill cron also has up to a minute of latency
 * between on-chain launch and the DB row appearing — comfortably
 * inside this window.
 */
export const GRACE_PERIOD_HOURS = 24;

/**
 * Daily-tick gate. Cron fires every minute (see `wrangler.json` —
 * `"* * * * *"`), but listing + diffing R2 against PostgreSQL on every
 * tick would burn ~1,440× the operations per day for no benefit; the
 * window we're cleaning up grows on the order of hours, not minutes.
 *
 * 04:17 UTC is intentionally:
 *   - Off the hour (Cloudflare schedules disproportionately many jobs
 *     at `:00`), same rationale as `moderation-logs-cleanup.ts`.
 *   - One hour after the moderation-logs sweep (03:17), so the two
 *     storage-hygiene jobs don't race for the same DB connection /
 *     subrequest budget on a single cron tick.
 */
export const CLEANUP_HOUR_UTC = 4;
export const CLEANUP_MINUTE_UTC = 17;

/**
 * Prefix every uploaded token image lands under. Matches the key
 * convention in `routes/images.ts` (`tokens/<uuid>-<name>`). Anything
 * outside this prefix in R2 isn't a token logo and must not be touched
 * by this sweep.
 */
export const IMAGE_KEY_PREFIX = "tokens/";

/**
 * Maximum number of R2 `list` pages to walk per run. Each page returns
 * up to 1,000 objects, so this caps the per-run scan at 50K keys —
 * comfortable headroom over any realistic launch volume (every
 * launched token contributes exactly one referenced key; 50K is ~50×
 * the entire `tokens` table today and would still grow slower than
 * the cap if launch volume doubled).
 *
 * Note: this sweep walks the bucket from the start of the `tokens/`
 * prefix on every run rather than persisting a continuation cursor.
 * If the bucket *consistently* exceeded 50K keys with material
 * orphan density past the cap, later pages could be starved
 * indefinitely on the daily cadence. We pay attention to two
 * mitigating factors before adding cursor state:
 *
 *   1. Most keys in scan range are *referenced* (their token
 *      launched), so the per-page orphan count is small even in the
 *      worst case — the cap rarely binds.
 *   2. `MAX_DELETES_PER_RUN` (1,000) is the actual progress floor:
 *      every run that fills the delete queue removes 1K orphans
 *      from the front of the scan range, so the sweep self-corrects
 *      from any reachable backlog within a few days.
 *
 * If observability ever shows `truncated: true` for multiple days in
 * a row, switch to a persisted cursor (Durable Object or KV) — the
 * structure here makes that a localised change to the
 * `cursor`/loop-init lines.
 */
export const MAX_PAGES_PER_RUN = 50;

/**
 * Maximum number of objects to *attempt* to delete per run (counts
 * both successes and failures, see the `attempted` counter in
 * `runOrphanedImagesCleanup`).
 *
 * Caps the worst-case subrequest budget at:
 *   - `MAX_PAGES_PER_RUN` list calls (50)
 *   - `ceil(MAX_DELETES_PER_RUN / DELETE_BATCH_SIZE)` batch deletes
 *     (1, since `MAX_DELETES_PER_RUN === DELETE_BATCH_SIZE`)
 *   - + `MAX_DELETES_PER_RUN` per-key fallback deletes in the
 *     catastrophic-batch-failure case (rare; R2 batch deletes are
 *     atomic per-key on the backend).
 *
 * The daily cadence means up to ~365K *attempts* per year, which at
 * our scale is unreachable. We just want a hard ceiling so a
 * misconfigured grace period or schema migration that suddenly
 * flags every image as orphaned can't nuke the bucket in one tick.
 */
export const MAX_DELETES_PER_RUN = 1000;

/**
 * R2's `list` accepts up to 1,000 keys per page. Always fetch the
 * max to minimise list-call count.
 */
export const LIST_PAGE_SIZE = 1000;

/**
 * R2's `delete` accepts an array of keys in a single call. 1,000 is
 * the documented upper bound; we chunk at that size so a single batch
 * never exceeds it even if `MAX_DELETES_PER_RUN` is bumped.
 */
export const DELETE_BATCH_SIZE = 1000;

const MS_PER_HOUR = 60 * 60 * 1000;

export function shouldRunOrphanedImagesCleanup(now: Date): boolean {
  return (
    now.getUTCHours() === CLEANUP_HOUR_UTC &&
    now.getUTCMinutes() === CLEANUP_MINUTE_UTC
  );
}

export interface OrphanedImagesCleanupResult {
  scanned: number;
  candidates: number;
  deleted: number;
  deleteFailures: number;
  pagesProcessed: number;
  truncated: boolean;
}

/**
 * Run the daily orphaned-image sweep.
 *
 * Returns `null` on the 1,439 cron ticks per day that don't match the
 * gate. Returns the count/observability payload on the one tick that
 * does run.
 *
 * Designed to be wrapped in `ctx.waitUntil(...catch(...))` by the
 * caller — same pattern as the other cron jobs.
 */
export async function runOrphanedImagesCleanup(
  env: AppBindings,
  now: Date = new Date(),
): Promise<OrphanedImagesCleanupResult | null> {
  if (!shouldRunOrphanedImagesCleanup(now)) return null;

  const cutoff = new Date(now.getTime() - GRACE_PERIOD_HOURS * MS_PER_HOUR);

  const { referencedKeys, pendingReviewKeys } = await loadProtectedKeys(env);

  let cursor: string | undefined = undefined;
  let pagesProcessed = 0;
  let scanned = 0;
  let candidates = 0;
  let attempted = 0;
  let deleted = 0;
  let deleteFailures = 0;
  let truncated = false;

  const toDelete: string[] = [];

  while (pagesProcessed < MAX_PAGES_PER_RUN) {
    const listed = await env.IMAGES_BUCKET.list({
      prefix: IMAGE_KEY_PREFIX,
      limit: LIST_PAGE_SIZE,
      cursor,
    });

    pagesProcessed++;
    scanned += listed.objects.length;

    for (const obj of listed.objects) {
      // In-grace-period objects are skipped unconditionally. The
      // window is intentionally generous so a slow create flow (user
      // approves permit slowly, RPC is laggy, etc.) never has its
      // image collected out from under the still-confirming launch
      // tx.
      if (obj.uploaded.getTime() >= cutoff.getTime()) continue;

      // Already attached to a launched token. The registration flow
      // stores `imageUrl` as `/images/<key>` after a positive R2 HEAD
      // (see `validateImageUrl` in `token-registration.ts`), so a
      // verbatim string match against the R2 key is sufficient.
      if (referencedKeys.has(obj.key)) continue;

      // Waiting on admin review. Auto-deleting these would silently
      // erase the moderation queue — pending images stay until an
      // admin resolves them via the `/admin/moderation/:id/{approve,
      // reject}` endpoints.
      if (pendingReviewKeys.has(obj.key)) continue;

      candidates++;

      // Cap on *attempted* deletes, not successful ones. Gating on
      // `deleted + toDelete.length` would let a partial batch failure
      // (where `flushDeleteBatch` records failures into `deleteFailures`
      // rather than `deleted`) silently bump the per-run cap — the
      // run would still try to delete more keys, just to keep failing
      // them. `attempted` records every key we've queued for a
      // delete subrequest, so the cap holds against the actual
      // subrequest budget regardless of how many succeed.
      if (attempted >= MAX_DELETES_PER_RUN) continue;
      toDelete.push(obj.key);
      attempted++;
    }

    if (toDelete.length >= DELETE_BATCH_SIZE) {
      // `splice(0)` hands ownership of the array contents to
      // `flushDeleteBatch`, leaving `toDelete` empty for the next
      // page. Reusing the same `toDelete` reference instead of
      // re-allocating would let the mutation race the R2 SDK's
      // capture of the argument (and confuses any test that pins
      // the call args by reference).
      const batch = toDelete.splice(0);
      const result = await flushDeleteBatch(env, batch);
      deleted += result.deleted;
      deleteFailures += result.failed;
    }

    if (!listed.truncated) break;
    cursor = listed.cursor;

    if (pagesProcessed >= MAX_PAGES_PER_RUN) {
      // List was still truncated when we hit the page cap; flag for
      // the operator log so we can size the cap if it ever bites.
      truncated = true;
      break;
    }
  }

  if (toDelete.length > 0) {
    const batch = toDelete.splice(0);
    const result = await flushDeleteBatch(env, batch);
    deleted += result.deleted;
    deleteFailures += result.failed;
  }

  const summary: OrphanedImagesCleanupResult = {
    scanned,
    candidates,
    deleted,
    deleteFailures,
    pagesProcessed,
    truncated,
  };

  log("info", "orphaned_images_cleanup_completed", { ...summary });

  return summary;
}

/**
 * Load the two sets of R2 keys that must NOT be deleted:
 *
 *   - `referencedKeys`: every `tokens.imageUrl` translated back to its
 *     R2 key. Empty / non-`/images/tokens/` paths are skipped — the
 *     registration validator already canonicalised everything else.
 *   - `pendingReviewKeys`: every `moderation_logs.imageKey` whose
 *     decision is still `pending_review`. The retention sweep in
 *     `moderation-logs-cleanup.ts` never touches these, and neither
 *     do we.
 *
 * Both sets are loaded in one round-trip each. At our scale they fit
 * comfortably in Worker memory (one row per launched token; pending
 * review is bounded by human admin throughput).
 */
async function loadProtectedKeys(
  env: AppBindings,
): Promise<{ referencedKeys: Set<string>; pendingReviewKeys: Set<string> }> {
  const db = createDb(env.HYPERDRIVE.connectionString);

  const tokenRows = await db
    .select({ imageUrl: tokens.imageUrl })
    .from(tokens);

  const referencedKeys = new Set<string>();
  for (const row of tokenRows) {
    const key = extractR2Key(row.imageUrl);
    if (key !== null) referencedKeys.add(key);
  }

  const pendingRows = await db
    .select({ imageKey: moderationLogs.imageKey })
    .from(moderationLogs)
    .where(eq(moderationLogs.decision, "pending_review"));

  const pendingReviewKeys = new Set<string>();
  for (const row of pendingRows) {
    if (typeof row.imageKey === "string" && row.imageKey.length > 0) {
      pendingReviewKeys.add(row.imageKey);
    }
  }

  return { referencedKeys, pendingReviewKeys };
}

/**
 * Extract the R2 key from a stored `tokens.imageUrl`.
 *
 * The registration validator stores either an empty string (creator
 * skipped the image) or a root-relative `/images/<key>` path — see
 * `validateImageUrl` in `token-registration.ts`. We tolerate absolute
 * URLs (`https://api.example.com/images/<key>`) as a defensive
 * measure: pre-#450 rows or any future drift in the validator should
 * still be honoured here, because *anything* matching a real R2 key
 * means the image is in use and must not be swept.
 *
 * Returns `null` for empty, malformed, or outside-our-prefix values.
 */
function extractR2Key(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;

  let pathname: string;
  if (imageUrl.startsWith("/")) {
    pathname = imageUrl;
  } else {
    try {
      pathname = new URL(imageUrl).pathname;
    } catch {
      return null;
    }
  }

  if (!pathname.startsWith(`/images/${IMAGE_KEY_PREFIX}`)) return null;

  const key = pathname.slice("/images/".length);
  if (key.length === IMAGE_KEY_PREFIX.length) return null;

  return key;
}

/**
 * Delete a batch of R2 keys with structured failure accounting.
 *
 * R2's batch `delete` is best-effort — partial failures throw on the
 * whole call. Falling back to one-by-one deletes on a thrown batch is
 * deliberate: we'd rather pay the extra subrequests on the failure
 * path than abort the entire run and have to wait until tomorrow's
 * tick.
 */
async function flushDeleteBatch(
  env: AppBindings,
  keys: string[],
): Promise<{ deleted: number; failed: number }> {
  if (keys.length === 0) return { deleted: 0, failed: 0 };

  try {
    await env.IMAGES_BUCKET.delete(keys);
    return { deleted: keys.length, failed: 0 };
  } catch (err) {
    log("warn", "orphaned_images_cleanup_batch_delete_failed", {
      batchSize: keys.length,
      ...describeError(err),
    });

    let deleted = 0;
    let failed = 0;
    for (const key of keys) {
      try {
        await env.IMAGES_BUCKET.delete(key);
        deleted++;
      } catch (perKeyErr) {
        failed++;
        log("warn", "orphaned_images_cleanup_delete_failed", {
          key,
          ...describeError(perKeyErr),
        });
      }
    }
    return { deleted, failed };
  }
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
