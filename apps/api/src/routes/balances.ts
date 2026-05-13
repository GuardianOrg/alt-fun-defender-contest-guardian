import { Hono } from "hono";
import { inArray } from "drizzle-orm";
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
  // Hidden tokens are intentionally NOT filtered here (issue #712): a
  // wallet that already holds a token the admin has since hidden must
  // still be able to see it in their positions so they can sell out.
  // The `isHidden` flag is surfaced on every row so the UI can mark
  // hidden positions with the policy-violation disclaimer and disable
  // buys for them. Non-holders still can't discover hidden tokens —
  // this endpoint is wallet-scoped (`Ponder { wallet, balance_gt: 0 }`),
  // so the only way to surface a row is to already hold it on-chain.
  const dbTokens = await db
    .select()
    .from(tokens)
    .where(inArray(tokens.address, tokenAddresses));

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
        isHidden: meta.isHidden,
        balance: b.balance,
      };
    })
    .filter((b) => b !== null);

  return c.json(formatSuccess(result));
});

export default balances;
