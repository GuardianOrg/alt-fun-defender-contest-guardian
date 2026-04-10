import { Hono } from "hono";
import { isAddress } from "viem";

import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { createPonderQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const referrals = new Hono<{ Bindings: AppBindings }>();

referrals.get("/:wallet", async (c) => {
  const rawWallet = c.req.param("wallet");
  if (!isAddress(rawWallet)) {
    return c.json(formatError("Invalid wallet address"), 400);
  }
  const wallet = rawWallet.toLowerCase();
  const queryPonder = createPonderQuery(c.env.PONDER_URL);

  const data = await queryPonder<{
    referrals: {
      items: {
        tokenAddress: string;
        trader: string;
        usdcAmount: string;
        timestamp: string;
      }[];
    };
  }>(
    `query ($wallet: String!) {
      referrals(
        where: { referrer: $wallet }
        limit: 1000
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
    { wallet },
  );

  const items = data?.referrals?.items ?? [];

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
