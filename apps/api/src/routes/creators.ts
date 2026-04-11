import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { createDb } from "../db/client.js";
import { tokens, userProfiles } from "../db/schema.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { createPonderPaginatedQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const creators = new Hono<{ Bindings: AppBindings }>();

creators.get("/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);
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

  const tokenAddresses = creatorTokens.map((t) => t.address);

  let totalVolume = 0n;
  if (tokenAddresses.length > 0) {
    const queryPonderAll = createPonderPaginatedQuery(c.env.PONDER_URL);
    const { items: volumeTrades } = await queryPonderAll<{ usdcAmount: string }>(
      `query ($tokenAddresses: [String!]!, $limit: Int!, $offset: Int!) {
        routerTrades(
          where: { tokenAddress_in: $tokenAddresses }
          limit: $limit
          offset: $offset
        ) {
          items {
            usdcAmount
          }
        }
      }`,
      "routerTrades",
      { tokenAddresses },
    );

    for (const t of volumeTrades) {
      totalVolume += BigInt(t.usdcAmount);
    }
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
