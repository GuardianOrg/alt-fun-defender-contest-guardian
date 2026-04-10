import { Hono } from "hono";

import formatSuccess from "../utils/format-success.js";
import { queryPonder } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

interface PonderRouterTrade {
  tokenAddress: string;
  isBuy: boolean;
  usdcAmount: string;
  tokenAmount: string;
}

const portfolio = new Hono<{ Bindings: AppBindings }>();

portfolio.get("/:wallet", async (c) => {
  const wallet = c.req.param("wallet").toLowerCase();

  const data = await queryPonder<{ routerTrades: { items: PonderRouterTrade[] } }>(
    `query ($wallet: String!) {
      routerTrades(
        where: { trader: $wallet }
        limit: 1000
        orderBy: "timestamp"
        orderDirection: "asc"
      ) {
        items {
          tokenAddress
          isBuy
          usdcAmount
          tokenAmount
        }
      }
    }`,
    { wallet },
  );

  const trades = data?.routerTrades?.items ?? [];

  const holdings = new Map<string, { tokenAmount: bigint; costBasis: bigint }>();

  for (const t of trades) {
    const existing = holdings.get(t.tokenAddress) ?? { tokenAmount: 0n, costBasis: 0n };
    if (t.isBuy) {
      existing.tokenAmount += BigInt(t.tokenAmount);
      existing.costBasis += BigInt(t.usdcAmount);
    } else {
      existing.tokenAmount -= BigInt(t.tokenAmount);
      existing.costBasis -= BigInt(t.usdcAmount);
    }
    holdings.set(t.tokenAddress, existing);
  }

  const positions = Array.from(holdings.entries())
    .filter(([, h]) => h.tokenAmount > 0n)
    .map(([tokenAddress, h]) => ({
      tokenAddress,
      tokenAmount: h.tokenAmount.toString(),
      costBasisUsdc: h.costBasis.toString(),
    }));

  return c.json(formatSuccess(positions));
});

export default portfolio;
