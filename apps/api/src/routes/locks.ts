import { Hono } from "hono";

import { createDb } from "../db/client.js";
import { fetchActiveTokenLocks } from "../lib/indexer-reads.js";
import { summariseTokenLocks } from "../lib/token-locks.js";
import { setEdgeCacheHeaders } from "../utils/cache-control.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";

import type { AppBindings } from "../lib/types.js";

/**
 * Locks change only when a creator creates one or a cliff passes, so a
 * minute of staleness is invisible. The window matters more here than on
 * most routes: this is a catalogue-wide read that every home-page load
 * wants, and the whole point of serving it globally is that one body
 * satisfies all of them.
 */
const LOCKS_CACHE_TTL_SECONDS = 60;
/**
 * Bound on rows pulled from `token_lock` per request. Well past anything
 * realistic — locking supply costs a creator their own tokens, so the table
 * grows with genuine launches, not with spam. If a request ever truncates,
 * some tokens silently miss their badge, which is the same conservative
 * failure this whole feature is built around.
 */
const MAX_LOCK_ROWS = 2_000;

const locks = new Hono<{ Bindings: AppBindings }>();

/**
 * Every token with a currently-active supply lock.
 *
 * Returned for the whole catalogue rather than per token: the locked set is
 * tiny, and one shared response lets the home-page list and every token page
 * render the badge off a single edge-cached body. Clients index it by
 * `tokenAddress` (lowercased) and treat an absent entry as "no lock".
 *
 * A lock counts only when it is a non-cancelable Sablier pure timelock with
 * more than `MIN_LOCK_DURATION_SECONDS` still to run, and only once a token's
 * locks clear `MIN_LOCK_PERCENT` of supply — see `apps/indexer/src/sablier.ts`
 * for what that excludes and why the exclusions always under-report rather
 * than over-report.
 */
locks.get("/", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const nowSec = Math.floor(Date.now() / 1000);

  const rows = await fetchActiveTokenLocks(db, nowSec, MAX_LOCK_ROWS);
  if (rows === null) {
    return c.json(
      formatError("Indexer unavailable — lock data cannot be loaded"),
      503,
    );
  }

  setEdgeCacheHeaders(c, LOCKS_CACHE_TTL_SECONDS);
  return c.json(formatSuccess({ locks: summariseTokenLocks(rows, nowSec) }));
});

export default locks;
