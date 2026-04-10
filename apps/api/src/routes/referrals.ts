import { Hono } from "hono";

import formatSuccess from "../utils/format-success.js";
import { queryPonder } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const referrals = new Hono<{ Bindings: AppBindings }>();

referrals.get("/:wallet", async (c) => {
  const wallet = c.req.param("wallet").toLowerCase();

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
