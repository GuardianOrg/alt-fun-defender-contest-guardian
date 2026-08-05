import { Hono } from "hono";
import { isAddress } from "viem";

import { createDb } from "../db/client.js";
import {
  fetchTokenAndGraduationForSecurity,
  fetchTokenBalanceById,
} from "../lib/indexer-reads.js";
import { setEdgeCacheHeaders } from "../utils/cache-control.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";

import type { AppBindings } from "../lib/types.js";

const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
const SECURITY_CACHE_TTL_SECONDS = 30;

const securityV2 = new Hono<{ Bindings: AppBindings }>();

/**
 * Additive `/api/v1/security-v2/:address`: same response shape as the
 * legacy `/api/v1/security/:address` (`lpLocked`, `creatorHoldingPct`,
 * `contractVerified`, optional `lpAmount` / `graduated` / `poolAddress`).
 *
 * Reads the indexer DB directly via `fetchTokenAndGraduationForSecurity`
 * for the metadata, then a primary-key `tokenBalance` row for the
 * creator's holding. Matches the legacy neutral-fallback semantics: a
 * missing token row or a caught error still returns 200 with zeroed
 * creator holdings — see the inline note from the v1 route for why.
 */
securityV2.get("/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = rawAddress.toLowerCase();

  const db = createDb(c.env.DATABASE_URL);

  const meta = await fetchTokenAndGraduationForSecurity(db, address);
  if (meta === null || meta === "unavailable") {
    setSecurityCacheHeader(c);
    return c.json(
      formatSuccess({
        lpLocked: false,
        creatorHoldingPct: 0,
        contractVerified: true,
      }),
    );
  }

  const creator = meta.creator.toLowerCase();
  const balanceResult = await fetchTokenBalanceById(db, creator, address);
  const creatorBalance =
    balanceResult && balanceResult !== "unavailable"
      ? BigInt(balanceResult.balance)
      : 0n;

  const creatorHoldingPct =
    Number((creatorBalance * 10000n) / TOTAL_SUPPLY) / 100;

  setSecurityCacheHeader(c);
  return c.json(
    formatSuccess({
      lpLocked: meta.graduated && meta.graduation != null,
      lpAmount: meta.graduation?.liquidity ?? null,
      creatorHoldingPct: Math.max(0, creatorHoldingPct),
      contractVerified: true,
      graduated: meta.graduated,
      poolAddress: meta.hyperswapPair,
    }),
  );
});

function setSecurityCacheHeader(c: { header: (k: string, v: string) => void }) {
  setEdgeCacheHeaders(c, SECURITY_CACHE_TTL_SECONDS);
}

export default securityV2;
