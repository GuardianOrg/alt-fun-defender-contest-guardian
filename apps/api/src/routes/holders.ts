import { Hono } from "hono";
import { isAddress } from "viem";

import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { createPonderPaginatedQuery, createPonderQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";
import type { PonderRouterTrade } from "../lib/ponder-types.js";

function parseNonNegativeInt(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

const holders = new Hono<{ Bindings: AppBindings }>();

holders.get("/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = rawAddress.toLowerCase();

  // Pre-check Ponder availability with a lightweight query
  const queryPonder = createPonderQuery(c.env.PONDER_URL);
  const healthCheck = await queryPonder<{ __typename: string }>("{ __typename }");
  if (healthCheck === null) {
    return c.json(formatError("Indexer unavailable — holder data cannot be loaded"), 503);
  }

  const queryPonderAll = createPonderPaginatedQuery(c.env.PONDER_URL);

  const limitParam = parseNonNegativeInt(c.req.query("limit"));
  if (limitParam === null) {
    return c.json(formatError("Invalid pagination parameters"), 400);
  }
  const limit = Math.min(limitParam ?? 20, 100);

  const { items: trades, truncated } = await queryPonderAll<Pick<PonderRouterTrade, "trader" | "isBuy" | "tokenAmount">>(
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
  );
  const balances = new Map<string, bigint>();

  for (const t of trades) {
    const current = balances.get(t.trader) ?? 0n;
    if (t.isBuy) {
      balances.set(t.trader, current + BigInt(t.tokenAmount));
    } else {
      balances.set(t.trader, current - BigInt(t.tokenAmount));
    }
  }

  const totalSupply = 1_000_000_000n * 10n ** 18n;
  const holderList = Array.from(balances.entries())
    .filter(([, balance]) => balance > 0n)
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .slice(0, limit)
    .map(([wallet, balance]) => ({
      wallet,
      balance: balance.toString(),
      percentage: Number((balance * 10000n) / totalSupply) / 100,
    }));

  return c.json(formatSuccess({
    holders: holderList,
    totalHolders: Array.from(balances.values()).filter((b) => b > 0n).length,
    approximate: truncated,
  }));
});

export default holders;
