import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { createDb } from "../db/client.js";
import { tokens, userProfiles } from "../db/schema.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { createPonderQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const creators = new Hono<{ Bindings: AppBindings }>();

interface PonderTokenVolume {
  address: string;
  volumeUsd: string;
}

const VOLUME_QUERY_PAGE_SIZE = 1000;

/**
 * Creator profile + their tokens + aggregate stats. The volume aggregate now
 * sums each token's `volumeUsd` counter (maintained in lockstep with every
 * Buy/Sell on the indexer) instead of paginating up to 20K trades on every
 * request (issue #397). One indexed query, O(N tokens), no per-trade scan.
 *
 * Realistic creators have <50 tokens; the page-size cap exists only to bound
 * pathological cases where a single address has launched thousands.
 */
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

  let totalVolume = 0n;
  if (creatorTokens.length > 0) {
    const tokenAddresses = creatorTokens.map((t) => t.address.toLowerCase());

    // Single indexed lookup against the per-token `volumeUsd` counter.
    // Capped to PAGE_SIZE so a creator with thousands of tokens doesn't
    // explode the query — terminal-API callers in that situation should
    // page through `tokens` directly.
    const queryPonder = createPonderQuery(c.env.PONDER_URL);
    const volumeData = await queryPonder<{
      tokens: { items: PonderTokenVolume[] } | null;
    }>(
      `query ($addresses: [String!]!, $limit: Int!) {
        tokens(where: { address_in: $addresses }, limit: $limit) {
          items {
            address
            volumeUsd
          }
        }
      }`,
      { addresses: tokenAddresses, limit: VOLUME_QUERY_PAGE_SIZE },
    );

    for (const t of volumeData?.tokens?.items ?? []) {
      totalVolume += BigInt(t.volumeUsd ?? "0");
    }
  }

  c.header(
    "Cache-Control",
    "public, s-maxage=30, stale-while-revalidate=60",
  );
  return c.json(
    formatSuccess({
      profile: profile ?? null,
      tokens: creatorTokens,
      stats: {
        tokensCreated: creatorTokens.length,
        totalVolume: totalVolume.toString(),
      },
    }),
  );
});

export default creators;
