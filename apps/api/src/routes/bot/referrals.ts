import { Hono } from "hono";
import { isAddress } from "viem";

import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";
import { createPonderQuery } from "../../lib/ponder-client.js";

import type { AppBindings } from "../../lib/types.js";

/**
 * Bot-namespaced referral endpoint for the Telegram bot's `/referral`
 * surface. Owns the `rewardsWallet` KV mapping (shared `WALLET_KV`
 * namespace with `apps/telegram-bot`) and reports `referrerStats`
 * sourced from the shared indexer plus a count of failed-payout
 * (bad-rewards-wallet) trades and dropped-deeplink (attribution-loss)
 * events that the bot surfaces as banners on `/referral`.
 *
 * Both the `referrerStats` GraphQL entity and the bad-payment /
 * attribution-loss counters depend on the BotFeeRouter contract being
 * deployed and the indexer subscribing to its events
 * (`BotRouterTrade`, `ReferralPaid`). Until that infra lands the
 * indexer query falls through and the route returns zeroed stats —
 * the bot renders the bare /referral view and no banner appears.
 * Once the entities exist the route picks them up automatically with
 * no further changes here.
 */

interface ReferrerStats {
  referredCount: number;
  lifetimeEarnedUsdc: string;
  badPaymentCount: number;
  attributionLossCount: number;
}

const ZERO_STATS: ReferrerStats = {
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
  const raw = await kv.get(rewardsKey(wallet));
  if (!raw) return wallet;
  try {
    const parsed = JSON.parse(raw) as RewardsRecord;
    if (
      typeof parsed.rewardsWallet === "string" &&
      isAddress(parsed.rewardsWallet, { strict: false })
    ) {
      return parsed.rewardsWallet;
    }
    return wallet;
  } catch {
    return wallet;
  }
};

interface ReferrerStatsRow {
  referredCount: number;
  lifetimeEarnedUsdc: string;
  badPaymentCount: number;
  attributionLossCount: number;
}

const isReferrerStatsRow = (v: unknown): v is ReferrerStatsRow => {
  if (!v || typeof v !== "object") return false;
  const row = v as Record<string, unknown>;
  return (
    typeof row.referredCount === "number" &&
    typeof row.lifetimeEarnedUsdc === "string" &&
    typeof row.badPaymentCount === "number" &&
    typeof row.attributionLossCount === "number"
  );
};

/**
 * Read referrer stats from the indexer. Returns zeroed stats when the
 * indexer entity is missing (BotFeeRouter not deployed yet) or
 * returns no row for this rewards wallet. Network / GraphQL failures
 * also collapse to zeros — the bot renders a clean /referral view
 * rather than surfacing a transient outage as a banner that implies
 * lost referral payments.
 */
const fetchReferrerStats = async (
  ponderUrl: string,
  rewardsWallet: string,
): Promise<ReferrerStats> => {
  // `createPonderQuery` already returns null on network / GraphQL
  // failure, but a synchronous throw inside this wrapper (e.g. a
  // future logger call, JSON validator change, or upstream regression)
  // would otherwise surface as a 500. The route documents zeroed
  // stats as the indexer-unavailable fallback, so collapse every
  // failure mode to the same shape.
  try {
    const queryPonder = createPonderQuery(ponderUrl);
    const result = await queryPonder<{
      referrerStats: ReferrerStatsRow | null;
    }>(
      `query ($rewardsWallet: String!) {
        referrerStats(id: $rewardsWallet) {
          referredCount
          lifetimeEarnedUsdc
          badPaymentCount
          attributionLossCount
        }
      }`,
      { rewardsWallet: rewardsWallet.toLowerCase() },
    );
    if (!result || !isReferrerStatsRow(result.referrerStats)) return ZERO_STATS;
    return {
      referredCount: result.referrerStats.referredCount,
      lifetimeEarnedUsdc: result.referrerStats.lifetimeEarnedUsdc,
      badPaymentCount: result.referrerStats.badPaymentCount,
      attributionLossCount: result.referrerStats.attributionLossCount,
    };
  } catch {
    return ZERO_STATS;
  }
};

const referrals = new Hono<{ Bindings: AppBindings }>();

referrals.get("/:wallet", async (c) => {
  const rawWallet = c.req.param("wallet");
  if (!isAddress(rawWallet, { strict: false })) {
    return c.json(formatError("Invalid wallet address"), 400);
  }
  if (!c.env.WALLET_KV) {
    return c.json(formatError("Bot referrals binding missing"), 503);
  }
  const wallet = rawWallet.toLowerCase();

  const rewardsWallet = await readRewardsWallet(c.env.WALLET_KV, wallet);
  const stats = await fetchReferrerStats(c.env.PONDER_URL, rewardsWallet);

  return c.json(
    formatSuccess({
      rewardsWallet,
      ...stats,
    }),
  );
});

referrals.post("/:wallet/rewards-wallet", async (c) => {
  const rawWallet = c.req.param("wallet");
  if (!isAddress(rawWallet, { strict: false })) {
    return c.json(formatError("Invalid wallet address"), 400);
  }
  const wallet = rawWallet.toLowerCase();

  let body: { rewardsWallet?: unknown };
  try {
    body = (await c.req.json()) as { rewardsWallet?: unknown };
  } catch {
    return c.json(formatError("Invalid JSON body"), 400);
  }

  if (
    typeof body.rewardsWallet !== "string" ||
    !isAddress(body.rewardsWallet, { strict: false })
  ) {
    return c.json(formatError("Invalid rewardsWallet"), 400);
  }
  if (!c.env.WALLET_KV) {
    return c.json(formatError("Bot referrals binding missing"), 503);
  }
  const rewardsWallet = body.rewardsWallet.toLowerCase();

  const record: RewardsRecord = {
    rewardsWallet,
    setAt: Date.now(),
  };
  await c.env.WALLET_KV.put(rewardsKey(wallet), JSON.stringify(record));

  return c.json(formatSuccess({ rewardsWallet }));
});

export default referrals;
