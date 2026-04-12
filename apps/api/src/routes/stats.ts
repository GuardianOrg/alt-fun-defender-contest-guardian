import { Hono } from "hono";

import formatSuccess from "../utils/format-success.js";
import { createPonderPaginatedQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const stats = new Hono<{ Bindings: AppBindings }>();

stats.get("/", async (c) => {
  const queryPonderAll = createPonderPaginatedQuery(c.env.PONDER_URL);

  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 86400;

  const [tokenResult, tradeResult] = await Promise.all([
    queryPonderAll<{ graduated: boolean }>(
      `query ($limit: Int!, $offset: Int!) {
        tokens(limit: $limit, offset: $offset) {
          items {
            graduated
          }
        }
      }`,
      "tokens",
    ),
    queryPonderAll<{ usdcAmount: string }>(
      `query ($since: BigInt!, $limit: Int!, $offset: Int!) {
        routerTrades(
          where: { timestamp_gte: $since }
          limit: $limit
          offset: $offset
        ) {
          items {
            usdcAmount
          }
        }
      }`,
      "routerTrades",
      { since: String(dayAgo) },
    ),
  ]);

  const ponderAvailable = tokenResult.items.length > 0 || tradeResult.items.length > 0;
  const allTokens = tokenResult.items;
  const trades24h = tradeResult.items;

  const tokensGraduated = allTokens.filter((t) => t.graduated).length;
  const tokensLive = allTokens.length - tokensGraduated;

  let volume24h = 0n;
  for (const t of trades24h) {
    volume24h += BigInt(t.usdcAmount);
  }

  return c.json(formatSuccess({
    tokensLive,
    tokensGraduated,
    totalTokens: allTokens.length,
    volume24h: volume24h.toString(),
  }, ponderAvailable ? "live" : "degraded"));
});

export default stats;
