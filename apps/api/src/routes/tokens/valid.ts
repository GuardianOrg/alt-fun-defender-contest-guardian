import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { createDb } from "../../db/client.js";
import { tokens } from "../../db/schema.js";
import { tryApiDbRead } from "../../lib/api-db-reads.js";
import { setEdgeCacheHeaders } from "../../utils/cache-control.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";

import type { AppBindings } from "../../lib/types.js";

const VALID_CACHE_TTL_SECONDS = 30;
/**
 * `valid: false` is the transient answer — a token launched seconds ago
 * has no row until the backfill lands (~60s), so a negative is a "not
 * yet", not a fact. The web caches a definitive `false` for the whole
 * page lifetime (`apps/web/src/services/tokenValidity.ts`), so an
 * over-held negative drops that token's trades from the live feed for
 * the rest of the session. Cache it briefly — enough to absorb a burst
 * of concurrent checks on one address, short enough that the flip to
 * registered is picked up on the next check.
 */
const INVALID_CACHE_TTL_SECONDS = 5;

const tokenValidRoute = new Hono<{ Bindings: AppBindings }>();

/**
 * `GET /api/v1/tokens/:address/valid` — lightweight `{ valid: boolean }`
 * check backing the home-page recent-trades WebSocket path, which uses it
 * to drop live trades for tokens that would 404 on the detail page.
 *
 * A token is "valid" iff it has a row in `public.tokens` (registered) AND
 * `is_hidden = false` (not moderation-hidden) — the same two gates the
 * public detail lens enforces in `detail.ts`. The holder-bypass that lets
 * a holder load their own hidden token is deliberately NOT applied here:
 * the recent-trades feed is a public surface, so hidden tokens stay hidden
 * for everyone.
 */
tokenValidRoute.get("/:address/valid", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);

  const db = createDb(c.env.DATABASE_URL);
  const rows = await tryApiDbRead(
    "api_db.tokens_valid_lookup",
    () =>
      db
        .select({ isHidden: tokens.isHidden })
        .from(tokens)
        .where(eq(tokens.address, address))
        .limit(1),
    { address },
  );
  if (rows === null) {
    return c.json(formatError("Token validity unavailable"), 503);
  }

  const valid = rows.length > 0 && rows[0].isHidden === false;
  // Asymmetric on purpose: a `true` is stable (registration doesn't
  // un-happen, moderation is rare), a `false` usually means "not indexed
  // yet" and must expire fast.
  setEdgeCacheHeaders(
    c,
    valid ? VALID_CACHE_TTL_SECONDS : INVALID_CACHE_TTL_SECONDS,
  );
  return c.json(formatSuccess({ valid }));
});

export default tokenValidRoute;
