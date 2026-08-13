import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { createDb } from "../../db/client.js";
import { tokens } from "../../db/schema.js";
import { tryApiDbRead } from "../../lib/api-db-reads.js";
import { publicVisibleTokenConditions } from "../../lib/public-token-visibility.js";
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
 * to drop live trades for tokens that should not appear on public feeds.
 *
 * A token is "valid" iff it has a row in `public.tokens`, is not
 * moderation-hidden, and its BounceTech LT is not mint-paused — the same
 * gates the public catalogue uses. Direct detail by address still loads
 * paused-LT tokens so holders can sell; this endpoint backs the recent-
 * trades feed, which is a public advertising surface.
 *
 * The holder-bypass that lets a holder load their own hidden token is
 * deliberately NOT applied here: the recent-trades feed is a public
 * surface, so hidden and mint-paused tokens stay off it for everyone.
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
        .select({ address: tokens.address })
        .from(tokens)
        .where(and(eq(tokens.address, address), ...publicVisibleTokenConditions()))
        .limit(1),
    { address },
  );
  if (rows === null) {
    return c.json(formatError("Token validity unavailable"), 503);
  }

  const valid = rows.length > 0;
  // Asymmetric on purpose: a `false` usually means "not indexed yet" and
  // must expire fast. `true` is still short-lived at the edge (30s) so a
  // mint-pause flip drops the token from the live feed on the next check.
  setEdgeCacheHeaders(
    c,
    valid ? VALID_CACHE_TTL_SECONDS : INVALID_CACHE_TTL_SECONDS,
  );
  return c.json(formatSuccess({ valid }));
});

export default tokenValidRoute;
