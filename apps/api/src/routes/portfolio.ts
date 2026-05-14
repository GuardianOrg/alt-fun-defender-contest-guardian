import { Hono } from "hono";
import { isAddress } from "viem";

import { createDb } from "../db/client.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { fetchPortfolioPositions } from "../lib/indexer-reads.js";

import type { AppBindings } from "../lib/types.js";

const portfolio = new Hono<{ Bindings: AppBindings }>();

/**
 * Wallet positions. Now sourced via a direct SQL LEFT JOIN between the
 * indexer's `ponder_views.token_balance` (one row per ERC-20 Transfer,
 * including non-Zap activity) and `ponder_views.wallet_position` (Zap-only
 * cost basis). One Postgres round-trip on the same Neon connection the API
 * already uses — replaces the legacy two-GraphQL-query Ponder hit and the
 * "paginate up to 20K trades" implementation before that (issue #397).
 *
 * - `token_balance` reflects the wallet's true on-chain holdings — direct
 *   transfers, airdrops, and Zap-mediated buys/sells all contribute.
 * - `wallet_position` is Zap-only and tracks proportional cost basis.
 *   Wallets that received tokens via direct Transfer correctly show a
 *   non-zero balance with zero cost basis.
 *
 * The route returns up to 1000 positions per request — anything beyond that
 * is a degenerate case (a wallet holding 1000+ distinct tokens) where the
 * caller should be using on-chain `balanceOf` multicall anyway.
 */
portfolio.get("/:wallet", async (c) => {
  const rawWallet = c.req.param("wallet");
  if (!isAddress(rawWallet)) {
    return c.json(formatError("Invalid wallet address"), 400);
  }
  const wallet = rawWallet.toLowerCase();

  const db = createDb(c.env.DATABASE_URL);
  const result = await fetchPortfolioPositions(db, wallet);

  if (result === null) {
    return c.json(
      formatError("Indexer unavailable — portfolio data cannot be loaded"),
      503,
    );
  }

  c.header(
    "Cache-Control",
    "public, s-maxage=15, stale-while-revalidate=30",
  );
  return c.json(
    formatSuccess({
      positions: result.positions,
      approximate: result.truncated,
    }),
  );
});

export default portfolio;
