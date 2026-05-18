import { Hono } from "hono";
import { isAddress } from "viem";

import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";

import type { AppBindings } from "../../lib/types.js";

/**
 * Bot-namespaced `rewardsWallet` KV writer for the Telegram bot's
 * `/referral` surface. Owns the `rewards-wallet:<wallet>` mapping in the
 * shared `WALLET_KV` namespace (read side lives in `bot/referrals-v2.ts`).
 *
 * The companion `GET /:wallet` read route lives in `bot/referrals-v2.ts`
 * (sourced from the indexer DB rather than Ponder GraphQL). This file
 * exists for the POST only — no v2 sibling because it's a KV writer,
 * not a GraphQL read.
 */

const rewardsKey = (wallet: string): string =>
  `rewards-wallet:${wallet.toLowerCase()}`;

interface RewardsRecord {
  rewardsWallet: string;
  setAt: number;
}

const referrals = new Hono<{ Bindings: AppBindings }>();

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
