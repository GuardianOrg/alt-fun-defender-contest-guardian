/**
 * Cron-driven reconciliation of `public.tokens.creator` against the chain.
 *
 * The creator role is mutable after launch — a creator can hand it over
 * themselves (`Bonding.transferCreator`) and the protocol owner can force it
 * for a community takeover (`Bonding.adminTransferCreator`). The indexer
 * tracks both events onto `ponder_views.token.fee_recipient`, but our own
 * `public.tokens` row is written once at registration with
 * `ON CONFLICT DO NOTHING`, so nothing ever moves the column afterwards.
 *
 * Left unreconciled, the column pins every token to its launch creator and
 * the `?creator=` filter answers the wrong question: the outgoing wallet
 * keeps listing tokens it no longer controls (its transfer attempts revert
 * `NotCreator`) while the incoming wallet can't see them at all. That filter
 * backs the profile's created-token list, the rewards tab, and the
 * transfer-creator tab.
 *
 * Creator *earnings* never depended on this column — they come from the
 * indexer's `FeeAccrued` counters, which carry whichever creator was live at
 * trade time — so this sweep is about ownership display, not money.
 *
 * Note the deliberate column mismatch across the two schemas: the indexer's
 * `token.creator` is the *immutable* launch wallet (it backs `/security`'s
 * rug signal and the analytics launcher tally, neither of which may move
 * mid-life), while `public.tokens.creator` tracks the *current* steward. The
 * indexer's mutable mirror is `fee_recipient`, which is what this sweep reads.
 *
 * Idempotent and cheap: the detection query is a single indexed join whose
 * steady-state result is empty, so a normal tick issues one read and zero
 * writes.
 */

import { eq, sql } from "drizzle-orm";
import { getAddress } from "viem";

import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";
import type { AppBindings } from "./types.js";

/**
 * Cap on rows repointed per tick. Real takeovers are rare (a handful a week
 * at most), so anything approaching this bound means a backfill after a
 * prolonged indexer outage — which drains across subsequent ticks rather
 * than competing with the graduation keepers for the same tick's subrequest
 * budget.
 */
const MAX_UPDATES_PER_TICK = 100;

interface CreatorDrift {
  /** Checksummed address, as stored in `public.tokens`. */
  address: string;
  /** Lowercase, as the indexer stores it. */
  onchainCreator: string;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export async function runCreatorReconcile(env: AppBindings): Promise<void> {
  const db = createDb(env.DATABASE_URL);

  let drifted: CreatorDrift[];
  try {
    // Compare case-insensitively: `public.tokens` holds EIP-55 checksummed
    // addresses while Ponder normalises to lowercase, so a raw `<>` would
    // report every row as drifted.
    //
    // The zero-address guard skips the placeholder row `Factory:PairCreated`
    // inserts before `TokenLaunched` overwrites it. Without it a token caught
    // mid-launch would have its creator overwritten with `address(0)`, which
    // no wallet can ever claim against and which `getAddress()` accepts
    // happily rather than throwing.
    //
    // Ordered so the LIMIT window is deterministic rather than whatever the
    // planner returns. Successful rows drop out of the drift set, so the
    // window advances; a row that keeps failing holds its own slot but no
    // longer shuffles the other 99 out of view from tick to tick.
    const result = await db.execute(sql`
      SELECT t.address AS address, pt.fee_recipient AS onchain_creator
      FROM public.tokens t
      JOIN ponder_views.token pt ON pt.address = LOWER(t.address)
      WHERE LOWER(t.creator) <> LOWER(pt.fee_recipient)
        AND pt.fee_recipient <> ${ZERO_ADDRESS}
      ORDER BY t.address
      LIMIT ${MAX_UPDATES_PER_TICK}
    `);
    drifted = (
      result.rows as unknown as Array<{
        address: string;
        onchain_creator: string;
      }>
    ).map((row) => ({
      address: row.address,
      onchainCreator: row.onchain_creator,
    }));
  } catch (err) {
    log("warn", "creator_reconcile_detect_failed", describeError(err));
    return;
  }

  if (drifted.length === 0) return;

  let updated = 0;
  let failed = 0;

  for (const row of drifted) {
    try {
      // Re-checksum rather than writing the indexer's lowercase value
      // straight through: the list route filters with an exact
      // `eq(tokens.creator, getAddress(input))`, so a lowercase row would
      // be invisible to the very query this sweep exists to fix.
      await db
        .update(tokens)
        .set({ creator: getAddress(row.onchainCreator as `0x${string}`) })
        .where(eq(tokens.address, row.address));
      updated++;
    } catch (err) {
      failed++;
      log("warn", "creator_reconcile_update_failed", {
        token: row.address,
        ...describeError(err),
      });
    }
  }

  log("info", "creator_reconcile_tick", {
    updated,
    failed,
    considered: drifted.length,
  });
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

/**
 * Drizzle wraps postgres failures in a `DrizzleQueryError` whose `.message`
 * is only `"Failed query: <sql>"` — the actual reason lives on
 * `.cause.message`. Walk the chain so the cron logs carry the root cause.
 */
function describeError(err: unknown): {
  error: string;
  rootError?: string;
  errorCode?: string;
} {
  if (!(err instanceof Error)) {
    return { error: String(err) };
  }

  let root: Error = err;
  while (root.cause instanceof Error) {
    root = root.cause;
  }

  const rootCode = (root as Error & { code?: unknown }).code;
  const out: { error: string; rootError?: string; errorCode?: string } = {
    error: err.message,
  };
  if (root !== err) out.rootError = root.message;
  if (typeof rootCode === "string") out.errorCode = rootCode;
  return out;
}
