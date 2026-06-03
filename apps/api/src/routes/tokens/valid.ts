import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { createDb } from "../../db/client.js";
import { tokens } from "../../db/schema.js";
import { tryApiDbRead } from "../../lib/api-db-reads.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";

import type { AppBindings } from "../../lib/types.js";

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
  // Registration / hidden state flips rarely (cron backfill lands ~60s
  // after launch; manual moderation is uncommon). A short edge TTL absorbs
  // the WS-path burst without pinning a stale negative for long.
  c.header("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
  return c.json(formatSuccess({ valid }));
});

export default tokenValidRoute;
