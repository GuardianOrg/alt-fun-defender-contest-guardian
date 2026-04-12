import { Hono } from "hono";
import { isAddress } from "viem";

import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { createPonderPaginatedQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";
import type { PonderRouterTrade } from "../lib/ponder-types.js";

const portfolio = new Hono<{ Bindings: AppBindings }>();

portfolio.get("/:wallet", async (c) => {
  const rawWallet = c.req.param("wallet");
  if (!isAddress(rawWallet)) {
    return c.json(formatError("Invalid wallet address"), 400);
  }
  const wallet = rawWallet.toLowerCase();
  const queryPonderAll = createPonderPaginatedQuery(c.env.PONDER_URL);

  const { items: trades } = await queryPonderAll<Pick<PonderRouterTrade, "tokenAddress" | "isBuy" | "usdcAmount" | "tokenAmount">>(
    `query ($wallet: String!, $limit: Int!, $offset: Int!) {
      routerTrades(
        where: { trader: $wallet }
        limit: $limit
        offset: $offset
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
    "routerTrades",
    { wallet },
  );

  const holdings = new Map<string, { tokenAmount: bigint; costBasis: bigint }>();

  for (const t of trades) {
    const existing = holdings.get(t.tokenAddress) ?? { tokenAmount: 0n, costBasis: 0n };
    if (t.isBuy) {
      existing.tokenAmount += BigInt(t.tokenAmount);
      existing.costBasis += BigInt(t.usdcAmount);
    } else {
      const sold = BigInt(t.tokenAmount);
      if (existing.tokenAmount > 0n && sold < existing.tokenAmount) {
        const reduction = (existing.costBasis * sold) / existing.tokenAmount;
        existing.tokenAmount -= sold;
        existing.costBasis -= reduction;
      } else {
        existing.tokenAmount -= sold;
        existing.costBasis = 0n;
      }
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
