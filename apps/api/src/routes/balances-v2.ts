import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";
import {
  checkIndexerHealth,
  fetchTokenBalancesByWallet,
} from "../lib/indexer-reads.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";

import type { AppBindings } from "../lib/types.js";

const balancesV2 = new Hono<{ Bindings: AppBindings }>();

/**
 * Additive `/api/v1/balances-v2/:wallet`: same response shape as the
 * Ponder-backed `/api/v1/balances/:wallet` route, sourced from the
 * indexer DB via `fetchTokenBalancesByWallet`. The legacy route stays
 * mounted so callers can A/B compare during the migration window.
 *
 * The off-chain `tokens` row join (image / leverage / underlying / etc.)
 * is unchanged — only the on-chain balance lookup moved off GraphQL.
 */
balancesV2.get("/:wallet", async (c) => {
  const rawWallet = c.req.param("wallet");
  if (!isAddress(rawWallet)) {
    return c.json(formatError("Invalid wallet address"), 400);
  }
  const wallet = getAddress(rawWallet).toLowerCase();

  const db = createDb(c.env.HYPERDRIVE.connectionString);

  const healthy = await checkIndexerHealth(db);
  if (!healthy) {
    return c.json(formatError("Indexer unavailable"), 503);
  }

  const indexerBalances = await fetchTokenBalancesByWallet(db, wallet);
  if (indexerBalances === null) {
    return c.json(formatError("Indexer unavailable"), 503);
  }
  if (indexerBalances.length === 0) {
    return c.json(formatSuccess([]));
  }

  const tokenAddresses = indexerBalances.map((b) => getAddress(b.tokenAddress));

  // Hidden tokens are intentionally NOT filtered here (issue #712): a
  // wallet that already holds a token the admin has since hidden must
  // still be able to see it in their positions so they can sell out.
  const dbTokens = await db
    .select()
    .from(tokens)
    .where(inArray(tokens.address, tokenAddresses));

  const tokenMap = new Map(dbTokens.map((t) => [t.address.toLowerCase(), t]));

  const result = indexerBalances
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

export default balancesV2;
