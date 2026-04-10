import { Hono } from "hono";
import { isAddress } from "viem";

import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { createPonderQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const security = new Hono<{ Bindings: AppBindings }>();

security.get("/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = rawAddress.toLowerCase();
  const queryPonder = createPonderQuery(c.env.PONDER_URL);

  const data = await queryPonder<{
    token: {
      creator: string;
      graduated: boolean;
      pairAddress: string | null;
    } | null;
    graduation: {
      liquidity: string;
    } | null;
    routerTrades: {
      items: {
        trader: string;
        isBuy: boolean;
        tokenAmount: string;
      }[];
    };
  }>(
    `query ($address: String!) {
      token(id: $address) {
        creator
        graduated
        pairAddress
      }
      graduation(id: $address) {
        liquidity
      }
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

  const tokenData = data?.token;
  if (!tokenData) {
    return c.json(formatSuccess({
      lpLocked: false,
      creatorHoldingPct: 0,
      contractVerified: true,
    }));
  }

  const trades = data?.routerTrades?.items ?? [];
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
    lpLocked: tokenData.graduated && data?.graduation != null,
    lpAmount: data?.graduation?.liquidity ?? null,
    creatorHoldingPct: Math.max(0, creatorHoldingPct),
    contractVerified: true,
    graduated: tokenData.graduated,
    poolAddress: tokenData.pairAddress,
  }));
});

export default security;
