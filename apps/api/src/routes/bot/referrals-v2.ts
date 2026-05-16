import { Hono } from "hono";
import { isAddress } from "viem";

import { createDb } from "../../db/client.js";
import { fetchReferrerStatsById } from "../../lib/indexer-reads.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";

import type { AppBindings } from "../../lib/types.js";

/**
 * Additive `/api/v1/bot/referrals-v2/:wallet`: same response shape as
 * the legacy `/api/v1/bot/referrals/:wallet` GET route. Sourced from
 * `ponder_views.referrer_stats` via a primary-key read on the
 * lowercased rewards-wallet id. The POST route for setting the rewards
 * wallet is unchanged and stays on the v1 mount — only the GET path is
 * mirrored here so the v2 surface stays single-purpose.
 */

interface ReferrerStatsResponse {
  referredCount: number;
  lifetimeEarnedUsdc: string;
  badPaymentCount: number;
  attributionLossCount: number;
}

const ZERO_STATS: ReferrerStatsResponse = {
  referredCount: 0,
  lifetimeEarnedUsdc: "0",
  badPaymentCount: 0,
  attributionLossCount: 0,
};

const rewardsKey = (wallet: string): string =>
  `rewards-wallet:${wallet.toLowerCase()}`;

interface RewardsRecord {
  rewardsWallet: string;
  setAt: number;
}

const readRewardsWallet = async (
  kv: KVNamespace,
  wallet: string,
): Promise<string> => {
  // `wallet` is already lowercased by the caller. The KV write path
  // (`POST /:wallet/rewards-wallet` in the v1 route) also lowercases
  // before storing, but defensively normalise on read so a legacy or
  // out-of-band mixed-case record still produces a canonical lowercase
  // value — keeps the response and `fetchReferrerStatsById` lookup
  // aligned. CodeRabbit feedback on PR #991.
  const raw = await kv.get(rewardsKey(wallet));
  if (!raw) return wallet;
  try {
    const parsed = JSON.parse(raw) as RewardsRecord;
    if (
      typeof parsed.rewardsWallet === "string" &&
      isAddress(parsed.rewardsWallet, { strict: false })
    ) {
      return parsed.rewardsWallet.toLowerCase();
    }
    return wallet;
  } catch {
    return wallet;
  }
};

const referralsV2 = new Hono<{ Bindings: AppBindings }>();

referralsV2.get("/:wallet", async (c) => {
  const rawWallet = c.req.param("wallet");
  if (!isAddress(rawWallet, { strict: false })) {
    return c.json(formatError("Invalid wallet address"), 400);
  }
  if (!c.env.WALLET_KV) {
    return c.json(formatError("Bot referrals binding missing"), 503);
  }
  const wallet = rawWallet.toLowerCase();

  const rewardsWallet = await readRewardsWallet(c.env.WALLET_KV, wallet);

  const db = createDb(c.env.DATABASE_URL);
  const stats = await fetchReferrerStatsById(db, rewardsWallet);
  // The v1 route collapses indexer unavailability AND missing rows to
  // the same zeroed-stats fallback — preserve that here so the bot's
  // /referral panel doesn't surface a transient outage as a banner
  // implying lost referral payments.
  const resolvedStats: ReferrerStatsResponse =
    stats && stats !== "unavailable"
      ? {
          referredCount: stats.referredCount,
          lifetimeEarnedUsdc: stats.lifetimeEarnedUsdc,
          badPaymentCount: stats.badPaymentCount,
          attributionLossCount: stats.attributionLossCount,
        }
      : ZERO_STATS;

  return c.json(
    formatSuccess({
      rewardsWallet,
      ...resolvedStats,
    }),
  );
});

export default referralsV2;
