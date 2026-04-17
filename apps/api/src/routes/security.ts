import { Hono } from "hono";
import { isAddress } from "viem";

import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { createPonderQuery, createPonderPaginatedQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";
import type { PonderRouterTrade } from "../lib/ponder-types.js";

const security = new Hono<{ Bindings: AppBindings }>();

security.get("/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = rawAddress.toLowerCase();
  const queryPonder = createPonderQuery(c.env.PONDER_URL);
  const queryPonderAll = createPonderPaginatedQuery(c.env.PONDER_URL);

  const [metaData, tradeResult] = await Promise.all([
    queryPonder<{
      token: {
        creator: string;
        graduated: boolean;
        hyperswapPair: string | null;
      } | null;
      graduation: {
        liquidity: string;
      } | null;
    }>(
      `query ($address: String!) {
        token(id: $address) {
          creator
          graduated
          hyperswapPair
        }
        graduation(id: $address) {
          liquidity
        }
      }`,
      { address },
    ),
    queryPonderAll<Pick<PonderRouterTrade, "trader" | "isBuy" | "tokenAmount">>(
      `query ($address: String!, $limit: Int!, $offset: Int!) {
        routerTrades(
          where: { tokenAddress: $address }
          limit: $limit
          offset: $offset
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
      "routerTrades",
      { address },
    ),
  ]);

  const trades = tradeResult.items;
  const truncated = tradeResult.truncated;
  const tokenData = metaData?.token;
  if (!tokenData) {
    return c.json(formatSuccess({
      lpLocked: false,
      creatorHoldingPct: 0,
      contractVerified: true,
    }));
  }

  let creatorBalance = 0n;
  const totalSupply = 1_000_000_000n * 10n ** 18n;

  for (const t of trades) {
    if (t.trader.toLowerCase() === tokenData.creator.toLowerCase()) {
      if (t.isBuy) {
        creatorBalance += BigInt(t.tokenAmount);
      } else {
        creatorBalance -= BigInt(t.tokenAmount);
      }
    }
  }

  const creatorHoldingPct = Number((creatorBalance * 10000n) / totalSupply) / 100;

  return c.json(formatSuccess({
    lpLocked: tokenData.graduated && metaData?.graduation != null,
    lpAmount: metaData?.graduation?.liquidity ?? null,
    creatorHoldingPct: Math.max(0, creatorHoldingPct),
    contractVerified: true,
    graduated: tokenData.graduated,
    poolAddress: tokenData.hyperswapPair,
    approximate: truncated,
  }));
});

export default security;
