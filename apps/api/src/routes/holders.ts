import { Hono } from "hono";

import formatSuccess from "../utils/format-success.js";
import { queryPonder } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const holders = new Hono<{ Bindings: AppBindings }>();

holders.get("/:address", async (c) => {
  const address = c.req.param("address");
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);

  const data = await queryPonder<{
    routerTrades: {
      items: {
        trader: string;
        isBuy: boolean;
        tokenAmount: string;
      }[];
    };
  }>(
    `query ($address: String!) {
      routerTrades(
        where: { tokenAddress: $address }
        limit: 1000
        orderBy: "timestamp"
        orderDirection: "asc"
      ) {
        items {
          trader
          isBuy
          tokenAmount
        }
      }
    }`,
    { address },
  );

  const trades = data?.routerTrades?.items ?? [];
  const balances = new Map<string, bigint>();

  for (const t of trades) {
    const current = balances.get(t.trader) ?? 0n;
    if (t.isBuy) {
      balances.set(t.trader, current + BigInt(t.tokenAmount));
    } else {
      balances.set(t.trader, current - BigInt(t.tokenAmount));
    }
  }

  const totalSupply = 1_000_000_000n * 10n ** 18n;
  const holderList = Array.from(balances.entries())
    .filter(([, balance]) => balance > 0n)
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .slice(0, limit)
    .map(([wallet, balance]) => ({
      wallet,
      balance: balance.toString(),
      percentage: Number((balance * 10000n) / totalSupply) / 100,
    }));

  return c.json(formatSuccess({
    holders: holderList,
    totalHolders: Array.from(balances.values()).filter((b) => b > 0n).length,
  }));
});

export default holders;
