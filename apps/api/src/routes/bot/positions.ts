import { Hono } from "hono";
import { isAddress } from "viem";

import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";
import { createPonderQuery } from "../../lib/ponder-client.js";

import type { AppBindings } from "../../lib/types.js";

/**
 * Bot-namespaced positions endpoint for the Telegram bot's `/positions`
 * surface. Sourced from `walletBotPosition` on the shared Ponder
 * indexer (one row per `(wallet, token)`, written from `BotRouterTrade`
 * events). Replaces the bot's previous use of the public
 * `/api/v1/portfolio` + `/api/v1/balances` pair — the public portfolio
 * route tracks `Zap`-mediated cost basis only and misses the bot fee /
 * realised-PnL columns that `walletBotPosition` exists to provide.
 *
 * The entity depends on the BotFeeRouter contract being deployed and
 * the indexer subscribing to its events (`BotRouterTrade`). Until that
 * infra lands the indexer query falls through and the route returns
 * empty `open` / `realised` arrays — the bot renders "no open
 * positions" cleanly with no banner spam. Once the entity exists the
 * route picks it up automatically with no further changes here.
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

interface WalletBotPositionRow {
  token: string;
  ticker: string;
  tokenBalance: string;
  costBasisUsdc: string;
  currentValueUsdc: string;
  realisedPnlUsdc: string;
  totalCostUsdc: string;
  totalProceedsUsdc: string;
}

const isWalletBotPositionRow = (v: unknown): v is WalletBotPositionRow => {
  if (!v || typeof v !== "object") return false;
  const row = v as Record<string, unknown>;
  return (
    typeof row.token === "string" &&
    typeof row.ticker === "string" &&
    typeof row.tokenBalance === "string" &&
    typeof row.costBasisUsdc === "string" &&
    typeof row.currentValueUsdc === "string" &&
    typeof row.realisedPnlUsdc === "string" &&
    typeof row.totalCostUsdc === "string" &&
    typeof row.totalProceedsUsdc === "string"
  );
};

const PAGE_SIZE = 1000;

/**
 * Signed bigint diff as a decimal string. Inputs are USDC raw (6dp).
 * Returns `-` prefix for negative — keeps the formatter in the bot
 * client free of bigint-aware sign handling.
 */
const signedDiff = (a: string, b: string): string => {
  const diff = BigInt(a) - BigInt(b);
  return diff < 0n ? `-${(-diff).toString()}` : diff.toString();
};

/**
 * Floating-point percentage `(numerator / denominator) × 100`, rounded
 * to two decimals. Returns `null` when `denominator === 0` so the bot
 * renders an em-dash instead of the literal `Infinity` / `NaN`.
 *
 * Conversion through `Number` is safe at USDC 6dp scale — even a
 * trillion-USD position is comfortably inside `Number.MAX_SAFE_INTEGER`.
 */
const pctOrNull = (numerator: bigint, denominator: bigint): number | null => {
  if (denominator === 0n) return null;
  const ratio = Number(numerator) / Number(denominator);
  return Math.round(ratio * 100 * 100) / 100;
};

const fetchPositions = async (
  ponderUrl: string,
  wallet: string,
): Promise<PositionsResponse> => {
  try {
    const queryPonder = createPonderQuery(ponderUrl);
    const result = await queryPonder<{
      walletBotPositions: { items: unknown[] } | null;
    }>(
      `query ($wallet: String!, $limit: Int!) {
        walletBotPositions(where: { wallet: $wallet }, limit: $limit) {
          items {
            token
            ticker
            tokenBalance
            costBasisUsdc
            currentValueUsdc
            realisedPnlUsdc
            totalCostUsdc
            totalProceedsUsdc
          }
        }
      }`,
      { wallet, limit: PAGE_SIZE },
    );

    if (!result || !result.walletBotPositions) return EMPTY;
    const items = result.walletBotPositions.items;
    if (!Array.isArray(items)) return EMPTY;

    const open: OpenPosition[] = [];
    const realised: RealisedPosition[] = [];

    for (const item of items) {
      if (!isWalletBotPositionRow(item)) continue;
      const balance = BigInt(item.tokenBalance);
      if (balance > 0n) {
        const cost = BigInt(item.costBasisUsdc);
        const value = BigInt(item.currentValueUsdc);
        open.push({
          token: item.token,
          ticker: item.ticker,
          balance: item.tokenBalance,
          costBasisUsdc: item.costBasisUsdc,
          currentValueUsdc: item.currentValueUsdc,
          unrealisedPnlUsdc: signedDiff(
            item.currentValueUsdc,
            item.costBasisUsdc,
          ),
          unrealisedPnlPct: pctOrNull(value - cost, cost),
        });
      }
      const totalCost = BigInt(item.totalCostUsdc);
      const totalProceeds = BigInt(item.totalProceedsUsdc);
      // Only include in the *Realised* section when the wallet has at
      // least one closed-out chunk in its lifetime — pure-open
      // positions (no sells ever) would otherwise show as a redundant
      // row with `realised PnL: $0`.
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

    // Sort per AGENTS.md: open by |unrealised PnL| desc, realised by
    // realised PnL desc. Comparator returns a number derived from the
    // string serialisation so the sort survives a 1e15-cents position
    // without `Number` overflow concerns.
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
  } catch {
    return EMPTY;
  }
};

const positions = new Hono<{ Bindings: AppBindings }>();

positions.get("/:wallet", async (c) => {
  const rawWallet = c.req.param("wallet");
  if (!isAddress(rawWallet, { strict: false })) {
    return c.json(formatError("Invalid wallet address"), 400);
  }
  const wallet = rawWallet.toLowerCase();
  const data = await fetchPositions(c.env.PONDER_URL, wallet);
  // Same edge-cache window as `/portfolio` — positions are stable
  // until the next router trade fires, and a 15s cap lines up with
  // the indexer's typical lag.
  c.header(
    "Cache-Control",
    "public, s-maxage=15, stale-while-revalidate=30",
  );
  return c.json(formatSuccess(data));
});

export default positions;
