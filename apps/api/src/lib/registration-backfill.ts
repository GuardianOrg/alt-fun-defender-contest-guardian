/**
 * Cron-driven safety net for the address-only token registration flow.
 *
 * The frontend awaits `POST /api/v1/tokens` synchronously after the launch
 * tx, but the user could close their tab, lose network, or hit a transient
 * 5xx between tx confirmation and our API write. Without a back-up, the
 * token would exist on-chain (`Bonding.allTokens()`) but never appear in
 * the home-page list — which is sourced exclusively from PostgreSQL.
 *
 * This sweep runs every cron tick (1 min cadence per `wrangler.json`),
 * queries Ponder for the most recently launched tokens that the indexer
 * has seen, and registers any that are missing from our DB. The
 * registration logic is the same code path the synchronous POST uses, so
 * cron-driven and frontend-driven inserts produce identical rows.
 *
 * Idempotent end-to-end: `ON CONFLICT DO NOTHING` in the helper means a
 * race between this cron and the frontend's POST is harmless — whoever
 * inserts first wins, the loser's call returns "exists".
 */

import { createPonderQuery } from "./ponder-client.js";
import {
  RegistrationError,
  broadcastNewToken,
  registerTokenFromChain,
} from "./token-registration.js";
import type { AppBindings } from "./types.js";

/**
 * Cap on registrations per tick. The actual workload (RPC + R2 + LT
 * lookup) is bounded by the idle subrequest budget on Workers; we also
 * don't want a sudden flood of legit launches to starve the LT-ticker
 * kickstart that runs in the same `scheduled()` handler.
 */
const MAX_REGISTRATIONS_PER_TICK = 10;

/**
 * Pull this many freshest tokens from Ponder's GraphQL layer. The diff
 * against PostgreSQL is then computed in JS — cheap because the cap is
 * small and the typical case is "everything's already registered, nothing
 * to do". When we outgrow this number per minute, we should switch to a
 * cursor-based sweep keyed on `block_number`.
 */
const PONDER_FETCH_LIMIT = 50;

interface PonderTokenRow {
  address: string;
}

export async function runRegistrationBackfill(env: AppBindings): Promise<void> {
  const recent = await fetchRecentLaunches(env.PONDER_URL);
  if (recent === null) {
    log("warn", "registration_backfill_ponder_unreachable", {});
    return;
  }
  if (recent.length === 0) return;

  let registered = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of recent) {
    if (registered >= MAX_REGISTRATIONS_PER_TICK) break;
    try {
      const result = await registerTokenFromChain(env, row.address, env.IMAGES_PUBLIC_URL);
      if (result.kind === "registered") {
        registered++;
        // Fire-and-forget; if the WS broadcast hangs we'd still log the
        // success and move on. The next user-driven `GET /tokens` will
        // surface the row regardless.
        void broadcastNewToken(env, result.token);
      } else {
        skipped++;
      }
    } catch (err) {
      failed++;
      // Most expected-error paths are RegistrationError instances:
      //   - `not_launched`: token reorg'd out (shouldn't happen with
      //     Ponder's indexed depth) — quiet info.
      //   - `image_invalid`: someone bypassed our frontend with a non-R2
      //     image URL. Token is permanently invisible until they relaunch.
      //     Log loudly so admins notice abuse but don't retry.
      //   - `lt_unknown`: BounceTech directory drift. Will retry next tick.
      //   - `rpc_error` / `db_error`: transient. Retried next tick.
      const code = err instanceof RegistrationError ? err.code : "unknown";
      const level = code === "image_invalid" ? "warn" : "info";
      log(level, "registration_backfill_skip", {
        token: row.address,
        code,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (registered > 0 || failed > 0) {
    log("info", "registration_backfill_tick", {
      registered,
      skipped,
      failed,
      considered: recent.length,
    });
  }
}

async function fetchRecentLaunches(
  ponderUrl: string | undefined,
): Promise<PonderTokenRow[] | null> {
  const queryPonder = createPonderQuery(ponderUrl);
  const data = await queryPonder<{ tokens: { items: PonderTokenRow[] } }>(
    `query {
      tokens(
        limit: ${PONDER_FETCH_LIMIT}
        orderBy: "blockNumber"
        orderDirection: "desc"
      ) {
        items { address }
      }
    }`,
  );
  if (data === null) return null;
  return data.tokens.items;
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
