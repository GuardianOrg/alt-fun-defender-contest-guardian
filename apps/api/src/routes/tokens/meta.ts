import { Hono } from "hono";
import { isAddress } from "viem";

import { createDb } from "../../db/client.js";
import { fetchTokenMeta } from "../../lib/indexer-reads.js";
import { setEdgeCacheHeaders } from "../../utils/cache-control.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";

import type { AppBindings } from "../../lib/types.js";

// Labels flip once per token, so the stale window is deliberately much
// wider than the usual 2× convention.
const META_CACHE_TTL_SECONDS = 300;
const META_CACHE_SWR_SECONDS = 3600;

const tokenMetaRoute = new Hono<{ Bindings: AppBindings }>();

/**
 * `GET /api/v1/tokens/:address/meta` — minimal `{ address, name, symbol }`
 * read on the indexer for the web's `tokenNames` cache. Added so the
 * browser can stop POSTing directly to the Ponder GraphQL endpoint
 * (currently the only remaining direct-from-browser indexer call —
 * `apps/web/src/services/tokenNames.ts:131`). The web migration to
 * this endpoint is a follow-up PR; this route ships first so the
 * server side is ready.
 *
 * 404 returns `data: null` rather than `error` so the caller can treat
 * "indexed but not found" the same as "no data yet" without branching
 * on status codes.
 */
tokenMetaRoute.get("/:address/meta", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress, { strict: false })) {
    return c.json(formatError("Invalid address"), 400);
  }
  const db = createDb(c.env.DATABASE_URL);
  const meta = await fetchTokenMeta(db, rawAddress);
  if (meta === "unavailable") {
    return c.json(formatError("Indexer unavailable"), 503);
  }
  // `name` / `symbol` flip exactly once per token (at `TokenLaunched`),
  // so callers can absorb minutes of staleness without consequence.
  // The web's `tokenNames` cache is the dominant caller and re-keys
  // its in-memory cache on the resolved value, so a stale read still
  // produces the right label. CodeRabbit feedback on PR #991.
  setEdgeCacheHeaders(c, META_CACHE_TTL_SECONDS, META_CACHE_SWR_SECONDS);
  return c.json(formatSuccess(meta));
});

export default tokenMetaRoute;
