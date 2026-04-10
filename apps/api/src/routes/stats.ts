import { Hono } from "hono";

import formatSuccess from "../utils/format-success.js";
import { createPonderQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const stats = new Hono<{ Bindings: AppBindings }>();

stats.get("/", async (c) => {
  const queryPonder = createPonderQuery(c.env.PONDER_URL);
  const data = await queryPonder<{
    tokens: { items: { graduated: boolean }[] };
  }>(
    `{
      tokens(limit: 1000) {
        items {
          graduated
        }
      }
    }`,
  );

  const allTokens = data?.tokens?.items ?? [];
  const tokensGraduated = allTokens.filter((t) => t.graduated).length;
  const tokensLive = allTokens.length - tokensGraduated;

  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 86400;

  const volumeData = await queryPonder<{
    routerTrades: { items: { usdcAmount: string }[] };
  }>(
    `query ($since: BigInt!) {
      routerTrades(
        where: { timestamp_gte: $since }
        limit: 1000
      ) {
        items {
          usdcAmount
        }
      }
    }`,
    { since: String(dayAgo) },
  );

  const trades24h = volumeData?.routerTrades?.items ?? [];
  let volume24h = 0n;
  for (const t of trades24h) {
    volume24h += BigInt(t.usdcAmount);
  }

  return c.json(formatSuccess({
    tokensLive,
    tokensGraduated,
    totalTokens: allTokens.length,
    volume24h: volume24h.toString(),
  }));
});

export default stats;
