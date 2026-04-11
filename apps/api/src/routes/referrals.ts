import { Hono } from "hono";
import { isAddress } from "viem";

import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { createPonderPaginatedQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

interface ReferralItem {
  tokenAddress: string;
  trader: string;
  usdcAmount: string;
  timestamp: string;
}

const referrals = new Hono<{ Bindings: AppBindings }>();

referrals.get("/:wallet", async (c) => {
  const rawWallet = c.req.param("wallet");
  if (!isAddress(rawWallet)) {
    return c.json(formatError("Invalid wallet address"), 400);
  }
  const wallet = rawWallet.toLowerCase();
  const queryPonderAll = createPonderPaginatedQuery(c.env.PONDER_URL);

  const { items } = await queryPonderAll<ReferralItem>(
    `query ($wallet: String!, $limit: Int!, $offset: Int!) {
      referrals(
        where: { referrer: $wallet }
        limit: $limit
        offset: $offset
        orderBy: "timestamp"
        orderDirection: "desc"
      ) {
        items {
          tokenAddress
          trader
          usdcAmount
          timestamp
        }
      }
    }`,
    "referrals",
    { wallet },
  );

  const uniqueWallets = new Set(items.map((r) => r.trader));
  let totalVolume = 0n;
  for (const r of items) {
    totalVolume += BigInt(r.usdcAmount);
  }

  return c.json(formatSuccess({
    referredWallets: uniqueWallets.size,
    referredVolume: totalVolume.toString(),
    referrals: items,
  }));
});

export default referrals;
