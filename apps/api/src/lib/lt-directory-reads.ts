/**
 * Read helpers for the `lt_directory` table that the
 * `LtDirectoryPoller` Durable Object keeps fresh. These are the live
 * data path for the LT directory across the API — `lt-availability`,
 * `token-registration`, `routes/assets`, and the per-request market-data
 * lookups all read through these helpers instead of fanning out to
 * `indexing.bounce.tech`.
 *
 * Failure-mode policy: every helper returns `null` (or `undefined` for
 * `readLtByAddress`) on a DB error so callers can branch into their
 * existing fail-open paths. Every failure also emits a structured
 * `lt_directory_read_failed` log line so the degraded mode is
 * observable during incident triage.
 *
 * The poller itself owns "this LT exists in the directory" semantics —
 * if the table is empty the API behaves exactly as it does during a
 * cold start, only without the cross-cluster `indexing.bounce.tech`
 * fan-out.
 */
import { eq, desc, max } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import {
  filterSupportedLTs,
  type LiveLeveragedToken,
} from "@launchpad/shared";

import { createDb } from "../db/client.js";
import { ltDirectory } from "../db/schema.js";

/**
 * Emit a structured log line for a failed `lt_directory` read. Mirrors
 * the `console.log(JSON.stringify(...))` convention used by every other
 * Worker-side surface in `apps/api/src` so Cloudflare logs / `wrangler
 * tail` keep a consistent shape across modules.
 */
function logReadFailure(helper: string, error: unknown): void {
  console.log(
    JSON.stringify({
      level: "error",
      event: "lt_directory_read_failed",
      helper,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }),
  );
}

/** Convert a `lt_directory` row into the `LiveLeveragedToken` shape every
 *  pre-migration consumer was already typed against, so call sites can
 *  swap in the DB read without a wider refactor. */
function rowToLive(row: typeof ltDirectory.$inferSelect): LiveLeveragedToken {
  return {
    address: row.address as `0x${string}`,
    symbol: row.symbol,
    name: row.name,
    targetAsset: row.targetAsset,
    targetLeverage: row.targetLeverage,
    isLong: row.isLong,
    decimals: row.decimals,
    exchangeRate: row.exchangeRate,
    mintPaused: row.mintPaused,
    // `LiveLeveragedToken.totalSupply` was sourced from the
    // BounceTech HTTP API but never read anywhere in our code. Keeping
    // the shape compatible — set to "0" until a consumer needs it.
    totalSupply: "0",
    totalAssets: row.totalAssets,
    // Idle-USDC buffer for atomic redeems. The frontend's trade panel
    // uses this to compute `maxSellableTokens` and surface the
    // "Buffer low" warning without an extra RPC read per quote — see
    // `apps/web/src/services/tradeRouter.ts → getQuoteSell`.
    baseAssetBalance: row.baseAssetBalance,
  };
}

/**
 * Full LT directory in `LiveLeveragedToken` shape. Returns every row
 * the poller has ever seen, ordered by `lastSeenAt desc` so retired
 * LTs (still tradeable for existing holders, hidden from creation
 * surfaces — see `EXCLUDED_UNDERLYING_ASSETS`) fall to the tail.
 * `null` on DB error.
 */
export async function readLtDirectory(
  databaseUrl: string,
): Promise<LiveLeveragedToken[] | null> {
  try {
    const db = createDb(databaseUrl);
    const rows = await db
      .select()
      .from(ltDirectory)
      .orderBy(desc(ltDirectory.lastSeenAt));
    return rows.map(rowToLive);
  } catch (error) {
    logReadFailure("readLtDirectory", error);
    return null;
  }
}

/**
 * Full LT directory narrowed to LTs Alt Fun supports (passes
 * `filterSupportedLTs` and is not in `EXCLUDED_UNDERLYING_ASSETS`).
 * `null` on DB error.
 */
export async function readSupportedLtDirectory(
  databaseUrl: string,
): Promise<LiveLeveragedToken[] | null> {
  const directory = await readLtDirectory(databaseUrl);
  if (directory === null) return null;
  return filterSupportedLTs(directory);
}

/**
 * `Map<lt-address-lowercased, exchangeRate-as-f64>`. Drop-in for the
 * old `fetchLiveLtRates` shape. Reads every row's `exchangeRate` and
 * scales to a normal JS number (divide by 1e18). `null` on DB error.
 *
 * This is the helper that replaces the `POST /market-data` hot-path's
 * per-request fan-out to BounceTech.
 */
export async function readLiveLtRates(
  databaseUrl: string,
): Promise<Map<string, number> | null> {
  try {
    const db = createDb(databaseUrl);
    const rows = await db
      .select({
        address: ltDirectory.address,
        exchangeRate: ltDirectory.exchangeRate,
      })
      .from(ltDirectory);
    const map = new Map<string, number>();
    for (const row of rows) {
      // `exchange_rate` is stored as a NUMERIC(78,0) decimal string.
      // The downstream `Number(...) / 1e18` precision tradeoff is the
      // same one the legacy HTTP path made — kept identical so this
      // is a pure source swap, not a behavioural change.
      map.set(
        row.address.toLowerCase(),
        Number(BigInt(row.exchangeRate)) / 1e18,
      );
    }
    return map;
  } catch (error) {
    logReadFailure("readLiveLtRates", error);
    return null;
  }
}

/**
 * Single-LT lookup by address. Returns `null` if not present in the
 * directory and `undefined` if the DB read threw — the two states are
 * meaningfully different at every existing call site
 * (`token-registration.ts` rejects unknown LTs as "lt_unknown" vs
 * "rpc_error").
 *
 * `ltAddress` is normalised to its checksummed form (via `getAddress`)
 * before the lookup so a lowercased or mixed-case input still matches
 * the checksummed shape the poller persists. An input that doesn't
 * parse as a 20-byte hex address resolves to `null` — same as if the
 * row simply isn't in the directory.
 */
export async function readLtByAddress(
  databaseUrl: string,
  ltAddress: string,
): Promise<LiveLeveragedToken | null | undefined> {
  if (!isAddress(ltAddress)) return null;
  const checksummed = getAddress(ltAddress);
  try {
    const db = createDb(databaseUrl);
    const [row] = await db
      .select()
      .from(ltDirectory)
      .where(eq(ltDirectory.address, checksummed))
      .limit(1);
    return row ? rowToLive(row) : null;
  } catch (error) {
    logReadFailure("readLtByAddress", error);
    return undefined;
  }
}

/**
 * Most recent `lastSeenAt` across the table — i.e. the wall-clock
 * timestamp of the most recent successful poll. Used by readers that
 * want to surface a `dataSource: "degraded"` flag when the poller
 * hasn't run in a while.
 */
export async function readDirectoryLastUpdatedAt(
  databaseUrl: string,
): Promise<Date | null> {
  try {
    const db = createDb(databaseUrl);
    const [row] = await db
      .select({ value: max(ltDirectory.lastSeenAt) })
      .from(ltDirectory);
    return row?.value ?? null;
  } catch (error) {
    logReadFailure("readDirectoryLastUpdatedAt", error);
    return null;
  }
}
