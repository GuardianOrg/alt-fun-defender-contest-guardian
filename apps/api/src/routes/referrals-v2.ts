import { Hono } from "hono";
import { isAddress } from "viem";

import { createDb } from "../db/client.js";
import { fetchReferralsByReferrer } from "../lib/indexer-reads.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";

import type { AppBindings } from "../lib/types.js";

const referralsV2 = new Hono<{ Bindings: AppBindings }>();

/**
 * Additive `/api/v1/referrals-v2/:wallet`: identical response shape to
 * the legacy `/api/v1/referrals/:wallet` (referred-wallet count, total
 * volume, raw items), sourced from `ponder_views.referral` instead of
 * a paginated GraphQL sweep.
 */
referralsV2.get("/:wallet", async (c) => {
  const rawWallet = c.req.param("wallet");
  if (!isAddress(rawWallet)) {
    return c.json(formatError("Invalid wallet address"), 400);
  }
  const wallet = rawWallet.toLowerCase();

  const db = createDb(c.env.DATABASE_URL);
  const items = await fetchReferralsByReferrer(db, wallet);
  if (items === null) {
    return c.json(formatError("Indexer unavailable"), 503);
  }

  const uniqueWallets = new Set(items.map((r) => r.trader));
  let totalVolume = 0n;
  for (const r of items) {
    totalVolume += BigInt(r.usdcAmount);
  }

  return c.json(
    formatSuccess({
      referredWallets: uniqueWallets.size,
      referredVolume: totalVolume.toString(),
      referrals: items,
    }),
  );
});

export default referralsV2;
