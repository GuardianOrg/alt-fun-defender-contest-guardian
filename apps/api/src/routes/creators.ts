import { Hono } from "hono";
import { eq } from "drizzle-orm";

import { createDb } from "../db/client.js";
import { tokens, userProfiles } from "../db/schema.js";
import formatSuccess from "../utils/format-success.js";
import { queryPonder } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const creators = new Hono<{ Bindings: AppBindings }>();

creators.get("/:address", async (c) => {
  const address = c.req.param("address");
  const db = createDb(c.env.DATABASE_URL);

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.address, address))
    .limit(1);

  const creatorTokens = await db
    .select()
    .from(tokens)
    .where(eq(tokens.creator, address));

  const volumeData = await queryPonder<{
    routerTrades: {
      items: { usdcAmount: string }[];
    };
  }>(
    `query ($creator: String!) {
      routerTrades(
        where: { trader: $creator }
        limit: 1000
      ) {
        items {
          usdcAmount
        }
      }
    }`,
    { creator: address },
  );

  let totalVolume = 0n;
  for (const t of volumeData?.routerTrades?.items ?? []) {
    totalVolume += BigInt(t.usdcAmount);
  }

  return c.json(formatSuccess({
    profile: profile ?? null,
    tokens: creatorTokens,
    stats: {
      tokensCreated: creatorTokens.length,
      totalVolume: totalVolume.toString(),
    },
  }));
});

export default creators;
