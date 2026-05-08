import { Hono } from "hono";
import { isAddress } from "viem";

import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { createPonderQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const portfolio = new Hono<{ Bindings: AppBindings }>();

interface PonderTokenBalance {
  tokenAddress: string;
  balance: string;
}

interface PonderWalletPosition {
  tokenAddress: string;
  costBasisUsdc: string;
}

const PORTFOLIO_PAGE_SIZE = 1000;

/**
 * Wallet positions. Sourced from the indexer's `tokenBalance` index (one row
 * per ERC-20 Transfer, including non-Zap activity) joined against the
 * `walletPosition` table for cost basis. Replaces the previous implementation
 * which paginated up to 20K trades per request to recompute both fields in
 * memory (issue #397).
 *
 * - `tokenBalance` reflects the wallet's true on-chain holdings — direct
 *   transfers, airdrops, and Zap-mediated buys/sells all contribute.
 * - `walletPosition` is Zap-only and tracks proportional cost basis.
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

  const queryPonder = createPonderQuery(c.env.PONDER_URL);

  const data = await queryPonder<{
    tokenBalances: { items: PonderTokenBalance[] } | null;
    walletPositions: { items: PonderWalletPosition[] } | null;
  }>(
    `query ($wallet: String!, $limit: Int!) {
      tokenBalances(
        where: { wallet: $wallet, balance_gt: "0" }
        limit: $limit
      ) {
        items {
          tokenAddress
          balance
        }
      }
      walletPositions(where: { wallet: $wallet }, limit: $limit) {
        items {
          tokenAddress
          costBasisUsdc
        }
      }
    }`,
    { wallet, limit: PORTFOLIO_PAGE_SIZE },
  );

  if (data === null) {
    return c.json(
      formatError("Indexer unavailable — portfolio data cannot be loaded"),
      503,
    );
  }

  const balances = data.tokenBalances?.items ?? [];
  const positionRows = data.walletPositions?.items ?? [];

  // Index cost basis by token address so the join below is O(1).
  const costBasisByToken = new Map<string, string>();
  for (const p of positionRows) {
    costBasisByToken.set(p.tokenAddress.toLowerCase(), p.costBasisUsdc);
  }

  const positions = balances
    .filter((b) => BigInt(b.balance) > 0n)
    .map((b) => ({
      tokenAddress: b.tokenAddress,
      tokenAmount: b.balance,
      costBasisUsdc: costBasisByToken.get(b.tokenAddress.toLowerCase()) ?? "0",
    }));

  // Truncated only when we hit the page-size ceiling. Positions are tied to
  // unique tokens, so this caps at "wallet holds 1000+ distinct tokens" — a
  // degenerate case the indexer can serve fully but isn't worth fanning out
  // for in the API layer.
  const truncated =
    balances.length === PORTFOLIO_PAGE_SIZE ||
    positionRows.length === PORTFOLIO_PAGE_SIZE;

  c.header(
    "Cache-Control",
    "public, s-maxage=15, stale-while-revalidate=30",
  );
  return c.json(formatSuccess({ positions, approximate: truncated }));
});

export default portfolio;
