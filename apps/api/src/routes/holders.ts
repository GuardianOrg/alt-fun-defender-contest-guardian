import { Hono } from "hono";
import { isAddress } from "viem";

import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { createPonderPaginatedQuery, createPonderQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;

interface PonderTokenInfo {
  bondingPair: string | null;
  hyperswapPair: string | null;
}

interface PonderTokenBalance {
  wallet: string;
  balance: string;
}

function parseNonNegativeInt(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

const holders = new Hono<{ Bindings: AppBindings }>();

/**
 * Holder list for a given token. Sourced from Ponder's `tokenBalances` index
 * (updated on every `Transfer`) so direct ERC-20 transfers, post-graduation
 * HyperSwap swaps that don't go through Zap, and any future protocol
 * integrators are all reflected — the previous implementation reconstructed
 * balances from `routerTrades` only and silently undercounted holders +
 * mis-totalled balances as soon as a token saw any off-Zap movement.
 *
 * The bonding curve pair, HyperSwap LP pair, and zero address are excluded:
 * they're protocol contracts (curve reserve / locked LP / burned), not
 * user-facing holders.
 */
holders.get("/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = rawAddress.toLowerCase();

  const limitParam = parseNonNegativeInt(c.req.query("limit"));
  if (limitParam === null) {
    return c.json(formatError("Invalid pagination parameters"), 400);
  }
  const limit = Math.min(limitParam ?? 20, 100);

  // Doubles as the indexer health check — a healthy Ponder always answers
  // this; a degraded Ponder returns `null`.
  const queryPonder = createPonderQuery(c.env.PONDER_URL);
  const tokenInfoResult = await queryPonder<{ token: PonderTokenInfo | null }>(
    `query ($address: String!) {
      token(address: $address) {
        bondingPair
        hyperswapPair
      }
    }`,
    { address },
  );
  if (tokenInfoResult === null) {
    return c.json(formatError("Indexer unavailable — holder data cannot be loaded"), 503);
  }

  const excludedWallets = [
    ZERO_ADDRESS,
    tokenInfoResult.token?.bondingPair,
    tokenInfoResult.token?.hyperswapPair,
  ]
    .filter((w): w is string => typeof w === "string" && w.length > 0)
    .map((w) => w.toLowerCase());

  const queryPonderAll = createPonderPaginatedQuery(c.env.PONDER_URL);
  const { items: balances, truncated } = await queryPonderAll<PonderTokenBalance>(
    `query ($address: String!, $excluded: [String!]!, $limit: Int!, $offset: Int!) {
      tokenBalances(
        where: { tokenAddress: $address, balance_gt: "0", wallet_not_in: $excluded }
        limit: $limit
        offset: $offset
        orderBy: "balance"
        orderDirection: "desc"
      ) {
        items {
          wallet
          balance
        }
      }
    }`,
    "tokenBalances",
    { address, excluded: excludedWallets },
  );

  const holderList = balances.slice(0, limit).map((b) => {
    const balance = BigInt(b.balance);
    return {
      wallet: b.wallet,
      balance: b.balance,
      percentage: Number((balance * 10000n) / TOTAL_SUPPLY) / 100,
    };
  });

  // Edge cache the holder list — it changes on every Transfer but a few
  // seconds of staleness is invisible on the UI, and the cache absorbs the
  // thundering-herd pattern (100 users opening the same viral token) that
  // would otherwise serialise into the indexer's PG pool.
  c.header(
    "Cache-Control",
    "public, s-maxage=15, stale-while-revalidate=30",
  );
  return c.json(formatSuccess({
    holders: holderList,
    totalHolders: balances.length,
    approximate: truncated,
  }));
});

export default holders;
