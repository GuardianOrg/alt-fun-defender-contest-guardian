import { Hono } from "hono";
import { isAddress } from "viem";
import { CONTRACT_ADDRESSES } from "@launchpad/shared";

import { createDb } from "../db/client.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import {
  fetchHolders,
  fetchTokenPairAddresses,
} from "../lib/indexer-reads.js";

import type { AppBindings } from "../lib/types.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BONDING_ADDRESS = CONTRACT_ADDRESSES.bonding.toLowerCase();
const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;

function parseNonNegativeInt(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

const holders = new Hono<{ Bindings: AppBindings }>();

/**
 * Holder list for a given token. Sourced from the indexer's
 * `ponder_views.token_balance` table (updated on every `Transfer`) so direct
 * ERC-20 transfers, post-graduation HyperSwap swaps that don't go through
 * Zap, and any future protocol integrators are all reflected — the previous
 * implementation reconstructed balances from `routerTrades` only and
 * silently undercounted holders + mis-totalled balances as soon as a token
 * saw any off-Zap movement.
 *
 * The bonding proxy (holds the 25% LP reserve until graduation), bonding
 * curve pair, HyperSwap LP pair, and zero address are excluded: they're
 * protocol contracts (LP reserve / curve reserve / locked LP / burned), not
 * user-facing holders.
 *
 * As of the GraphQL → direct-SQL migration the route does **two** Postgres
 * round-trips on the same Neon connection: one to resolve the per-token
 * exclusion pair addresses, one to fetch the top-N holders + the precise
 * total count. Replaces a `token(...)` GraphQL call + a paginated
 * `tokenBalances(...)` sweep (up to 20×1000 sequential pages) — same data,
 * one to two orders of magnitude less work on the upstream.
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

  const db = createDb(c.env.HYPERDRIVE.connectionString);

  // Resolve `bondingPair` / `hyperswapPair` so we can exclude protocol
  // wallets from the holders. A `"missing"` token is treated the same as
  // the legacy GraphQL path's `token: null` — fall back to excluding only
  // the zero address + bonding proxy. A `"error"` propagates as a 503.
  const pairs = await fetchTokenPairAddresses(db, address);
  if (pairs === "error") {
    return c.json(
      formatError("Indexer unavailable — holder data cannot be loaded"),
      503,
    );
  }

  const excludedWallets = [ZERO_ADDRESS, BONDING_ADDRESS];
  if (pairs !== "missing") {
    if (pairs.bondingPair) excludedWallets.push(pairs.bondingPair.toLowerCase());
    if (pairs.hyperswapPair) {
      excludedWallets.push(pairs.hyperswapPair.toLowerCase());
    }
  }

  const result = await fetchHolders(db, {
    tokenAddress: address,
    limit,
    excludedWallets,
  });
  if (result === null) {
    return c.json(
      formatError("Indexer unavailable — holder data cannot be loaded"),
      503,
    );
  }

  // Defense-in-depth: drop zero-balance rows + skip rows with malformed
  // balance strings. The SQL `balance > 0` filter already handles the
  // former, but a misbehaving indexer (or a future schema change) could
  // surface a non-numeric `balance` value — `BigInt(...)` throws on those,
  // and the holders tab is a best-effort read where one bad row shouldn't
  // black-hole the whole list. See issue #421 for the historical context.
  const holderList: {
    wallet: string;
    balance: string;
    percentage: number;
  }[] = [];
  for (const row of result.holders) {
    let parsed: bigint;
    try {
      parsed = BigInt(row.balance);
    } catch {
      continue;
    }
    if (parsed <= 0n) continue;
    holderList.push({
      wallet: row.wallet,
      balance: row.balance,
      percentage: Number((parsed * 10000n) / TOTAL_SUPPLY) / 100,
    });
  }

  // Edge cache the holder list — it changes on every Transfer but a few
  // seconds of staleness is invisible on the UI, and the cache absorbs the
  // thundering-herd pattern (100 users opening the same viral token) that
  // would otherwise serialise into the indexer's PG pool.
  c.header("Cache-Control", "public, s-maxage=15, stale-while-revalidate=30");
  return c.json(
    formatSuccess({
      holders: holderList,
      totalHolders: result.totalHolders,
      // The SQL aggregation has no truncation case (Postgres COUNT(*) returns
      // the exact total regardless of how many holders exist), so this field
      // is always false now. Kept on the response envelope for the legacy
      // GraphQL paginator contract — once we're confident no client is
      // surfacing a "showing top N of 20K+" banner from this flag, we can
      // drop it in a follow-up.
      approximate: false,
    }),
  );
});

export default holders;
