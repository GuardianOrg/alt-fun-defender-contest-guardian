import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import {
  createPonderQuery,
  createPonderPaginatedQuery,
} from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

interface PonderBalance {
  tokenAddress: string;
  balance: string;
}

const balances = new Hono<{ Bindings: AppBindings }>();

balances.get("/:wallet", async (c) => {
  const rawWallet = c.req.param("wallet");
  if (!isAddress(rawWallet)) {
    return c.json(formatError("Invalid wallet address"), 400);
  }
  const wallet = getAddress(rawWallet).toLowerCase();

  const queryPonder = createPonderQuery(c.env.PONDER_URL);
  const healthCheck = await queryPonder<{ __typename: string }>(
    "{ __typename }",
  );
  if (healthCheck === null) {
    return c.json(formatError("Indexer unavailable"), 503);
  }

  const queryPonderAll = createPonderPaginatedQuery(c.env.PONDER_URL);
  const { items: ponderBalances } = await queryPonderAll<PonderBalance>(
    `query ($wallet: String!, $limit: Int!, $offset: Int!) {
      tokenBalances(
        where: { wallet: $wallet, balance_gt: "0" }
        limit: $limit
        offset: $offset
      ) {
        items {
          tokenAddress
          balance
        }
      }
    }`,
    "tokenBalances",
    { wallet },
  );

  if (ponderBalances.length === 0) {
    return c.json(formatSuccess([]));
  }

  const tokenAddresses = ponderBalances.map((b) => getAddress(b.tokenAddress));

  const db = createDb(c.env.DATABASE_URL);
  const dbTokens = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.isHidden, false), inArray(tokens.address, tokenAddresses)));

  const tokenMap = new Map(dbTokens.map((t) => [t.address.toLowerCase(), t]));

  const result = ponderBalances
    .map((b) => {
      const addr = getAddress(b.tokenAddress);
      const meta = tokenMap.get(addr.toLowerCase());
      if (!meta) return null;

      return {
        address: addr,
        name: meta.name,
        ticker: meta.ticker,
        imageUrl: meta.imageUrl,
        ltPair: meta.ltPair,
        leverage: meta.leverage,
        underlying: meta.underlying,
        ltDirection: meta.ltDirection,
        balance: b.balance,
      };
    })
    .filter((b) => b !== null);

  return c.json(formatSuccess(result));
});

export default balances;
