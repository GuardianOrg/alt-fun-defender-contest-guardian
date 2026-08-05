import { Hono } from "hono";
import { isAddress } from "viem";
import { computeTokenPrice } from "@launchpad/shared";

import { createDb } from "../../db/client.js";
import {
  fetchTokenBalancesByWalletAndTokens,
  fetchWalletBotPositions,
} from "../../lib/indexer-reads.js";
import {
  fetchLiveLtRates,
  fetchTokensOnchainByAddresses,
} from "../../lib/market-data.js";
import { setEdgeCacheHeaders } from "../../utils/cache-control.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";

import type { AppBindings } from "../../lib/types.js";

// Shareable at the edge only because the wallet sits in the URL path,
// which is what the cache key is built from.
const POSITIONS_CACHE_TTL_SECONDS = 15;

/**
 * Additive `/api/v1/bot/positions-v2/:wallet`: same `PositionsResponse`
 * shape as the legacy `/api/v1/bot/positions/:wallet` route, sourced
 * from `ponder_views.wallet_bot_position` + `ponder_views.token_balance`
 * via direct DB queries instead of two sequential GraphQL calls.
 *
 * All the per-row PnL math, off-router-disposal rescaling, and the live
 * mark-refresh against the bonding curve / HyperSwap pool are preserved
 * verbatim — only the indexer reads moved off GraphQL.
 */

interface OpenPosition {
  token: string;
  ticker: string;
  balance: string;
  costBasisUsdc: string;
  currentValueUsdc: string;
  unrealisedPnlUsdc: string;
  unrealisedPnlPct: number | null;
}

interface RealisedPosition {
  token: string;
  ticker: string;
  totalCostUsdc: string;
  totalProceedsUsdc: string;
  realisedPnlUsdc: string;
  realisedPnlPct: number | null;
}

interface PositionsResponse {
  open: OpenPosition[];
  realised: RealisedPosition[];
}

const EMPTY: PositionsResponse = { open: [], realised: [] };

const signedDiff = (a: string, b: string): string => {
  const diff = BigInt(a) - BigInt(b);
  return diff < 0n ? `-${(-diff).toString()}` : diff.toString();
};

const pctOrNull = (numerator: bigint, denominator: bigint): number | null => {
  if (denominator === 0n) return null;
  const ratio = Number(numerator) / Number(denominator);
  return Math.round(ratio * 100 * 100) / 100;
};

// `value (USDC 6dp) = balance (token 18dp) × priceUsdc18dp / 1e30`.
const PRICE_VALUE_SCALE = 10n ** 30n;

const fetchCurrentPricesUsdc18dp = async (
  databaseUrl: string,
  addresses: string[],
): Promise<Map<string, bigint>> => {
  if (addresses.length === 0) return new Map();
  const [tokens, ltRates] = await Promise.all([
    fetchTokensOnchainByAddresses(databaseUrl, addresses),
    fetchLiveLtRates(databaseUrl),
  ]);
  const out = new Map<string, bigint>();
  if (!tokens || !ltRates) return out;
  for (const t of tokens) {
    const ltRate = ltRates.get(t.ltToken.toLowerCase()) ?? 0;
    if (ltRate <= 0) continue;
    const price = computeTokenPrice(
      BigInt(t.curveSupply),
      BigInt(t.ltReserve),
      ltRate,
    );
    if (price <= 0 || !Number.isFinite(price)) continue;
    const priceUsdc18dp = BigInt(Math.floor(price * 1e18));
    if (priceUsdc18dp <= 0n) continue;
    out.set(t.address.toLowerCase(), priceUsdc18dp);
  }
  return out;
};

const fetchPositions = async (
  databaseUrl: string,
  wallet: string,
): Promise<PositionsResponse> => {
  try {
    const db = createDb(databaseUrl);
    const items = await fetchWalletBotPositions(db, wallet);
    if (items === null || items.length === 0) return EMPTY;

    const openTokenAddresses = Array.from(
      new Set(
        items
          .filter((row) => BigInt(row.tokenBalance) > 0n)
          .map((row) => row.token.toLowerCase()),
      ),
    );

    const chainBalanceByToken = new Map<string, bigint>();
    if (openTokenAddresses.length > 0) {
      const balances = await fetchTokenBalancesByWalletAndTokens(
        db,
        wallet,
        openTokenAddresses,
      );
      for (const tb of balances ?? []) {
        if (
          typeof tb.tokenAddress !== "string" ||
          typeof tb.balance !== "string" ||
          !/^[0-9]+$/.test(tb.balance)
        ) {
          continue;
        }
        chainBalanceByToken.set(tb.tokenAddress.toLowerCase(), BigInt(tb.balance));
      }
    }

    const open: OpenPosition[] = [];
    const realised: RealisedPosition[] = [];

    for (const item of items) {
      const routerBalance = BigInt(item.tokenBalance);
      if (routerBalance > 0n) {
        const chainBalance =
          chainBalanceByToken.get(item.token.toLowerCase()) ?? 0n;
        if (chainBalance > 0n) {
          const balance =
            chainBalance < routerBalance ? chainBalance : routerBalance;
          const snapshotValue = BigInt(item.currentValueUsdc);
          const snapshotCost = BigInt(item.costBasisUsdc);
          const rescaledValue =
            balance === routerBalance
              ? snapshotValue
              : (snapshotValue * balance) / routerBalance;
          const rescaledCost =
            balance === routerBalance
              ? snapshotCost
              : (snapshotCost * balance) / routerBalance;
          open.push({
            token: item.token,
            ticker: item.ticker,
            balance: balance.toString(),
            costBasisUsdc: rescaledCost.toString(),
            currentValueUsdc: rescaledValue.toString(),
            unrealisedPnlUsdc: signedDiff(
              rescaledValue.toString(),
              rescaledCost.toString(),
            ),
            unrealisedPnlPct: pctOrNull(
              rescaledValue - rescaledCost,
              rescaledCost,
            ),
          });
        }
      }
      const totalCost = BigInt(item.totalCostUsdc);
      const totalProceeds = BigInt(item.totalProceedsUsdc);
      if (totalProceeds > 0n) {
        realised.push({
          token: item.token,
          ticker: item.ticker,
          totalCostUsdc: item.totalCostUsdc,
          totalProceedsUsdc: item.totalProceedsUsdc,
          realisedPnlUsdc: item.realisedPnlUsdc,
          realisedPnlPct: pctOrNull(BigInt(item.realisedPnlUsdc), totalCost),
        });
      }
    }

    // Live-mark refresh. Wrapped so a thrown error doesn't collapse the
    // already-built arrays back to EMPTY (matches v1 behaviour).
    try {
      const openTokens = Array.from(
        new Set(open.map((p) => p.token.toLowerCase())),
      );
      const liveMark = await fetchCurrentPricesUsdc18dp(databaseUrl, openTokens);
      for (const p of open) {
        const priceUsdc18dp = liveMark.get(p.token.toLowerCase());
        if (priceUsdc18dp === undefined) continue;
        const balance = BigInt(p.balance);
        const value = (balance * priceUsdc18dp) / PRICE_VALUE_SCALE;
        const cost = BigInt(p.costBasisUsdc);
        p.currentValueUsdc = value.toString();
        p.unrealisedPnlUsdc = signedDiff(p.currentValueUsdc, p.costBasisUsdc);
        p.unrealisedPnlPct = pctOrNull(value - cost, cost);
      }
    } catch (err) {
      console.log(
        JSON.stringify({
          level: "warn",
          event: "bot_positions_v2_live_mark_refresh_failed",
          wallet,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    const absStr = (s: string): bigint => {
      const b = BigInt(s);
      return b < 0n ? -b : b;
    };
    open.sort((a, b) => {
      const av = absStr(a.unrealisedPnlUsdc);
      const bv = absStr(b.unrealisedPnlUsdc);
      if (av === bv) return 0;
      return av > bv ? -1 : 1;
    });
    realised.sort((a, b) => {
      const av = BigInt(a.realisedPnlUsdc);
      const bv = BigInt(b.realisedPnlUsdc);
      if (av === bv) return 0;
      return av > bv ? -1 : 1;
    });

    return { open, realised };
  } catch (err) {
    console.log(
      JSON.stringify({
        level: "error",
        event: "bot_positions_v2_fetch_positions_failed",
        wallet,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return EMPTY;
  }
};

const positionsV2 = new Hono<{ Bindings: AppBindings }>();

positionsV2.get("/:wallet", async (c) => {
  const rawWallet = c.req.param("wallet");
  if (!isAddress(rawWallet, { strict: false })) {
    return c.json(formatError("Invalid wallet address"), 400);
  }
  const wallet = rawWallet.toLowerCase();
  const data = await fetchPositions(c.env.DATABASE_URL, wallet);
  setEdgeCacheHeaders(c, POSITIONS_CACHE_TTL_SECONDS);
  return c.json(formatSuccess(data));
});

export default positionsV2;
