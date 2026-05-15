import { Hono } from "hono";
import { isAddress } from "viem";
import { computeTokenPrice } from "@launchpad/shared";

import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";
import { createPonderQuery } from "../../lib/ponder-client.js";
import {
  fetchLiveLtRates,
  fetchTokensOnchainByAddresses,
} from "../../lib/market-data.js";

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

/**
 * Live USDC-per-whole-token price for each address, scaled to 18dp.
 * Sourced from the indexer's current `(curveSupply, ltReserve)` (which mirrors
 * HyperSwap reserves post-grad — see `apps/indexer/AGENTS.md → Post-graduation
 * reserve mirror`) and the live LT exchange rate. Replaces the
 * `walletBotPosition.currentValueUsdc` snapshot, which freezes at the user's
 * own last trade and renders new positions as PnL = 0 / 0% until they trade
 * again — see the AGENTS.md spec for /positions, which calls for the current
 * curve / pool quote here. Tokens absent from either source are omitted from
 * the map; the caller falls back to the indexer-stored value for those.
 *
 * Scaled to 18dp (not 6dp) so prices below $1e-6 per whole token survive the
 * bigint conversion. Bonding curves with billions-of-tokens supply routinely
 * price a single token at sub-microcent levels (e.g. a 35M-token position with
 * $20 cost basis ⇒ ~$5.6e-7/token); flooring those to 6dp collapses the price
 * to 0 raw and silently zeroes the position's value, rendering -100% PnL on
 * what is actually a healthy position.
 */
const fetchCurrentPricesUsdc18dp = async (
  ponderUrl: string,
  addresses: string[],
): Promise<Map<string, bigint>> => {
  if (addresses.length === 0) return new Map();
  const [tokens, ltRates] = await Promise.all([
    fetchTokensOnchainByAddresses(ponderUrl, addresses),
    fetchLiveLtRates(),
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

// `value (USDC 6dp) = balance (token 18dp) × priceUsdc18dp / 1e30`.
const PRICE_VALUE_SCALE = 10n ** 30n;

interface PonderTokenBalance {
  tokenAddress: string;
  balance: string;
}

const fetchPositions = async (
  ponderUrl: string,
  wallet: string,
): Promise<PositionsResponse> => {
  try {
    const queryPonder = createPonderQuery(ponderUrl);
    const positionsResult = await queryPonder<{
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

    if (!positionsResult || !positionsResult.walletBotPositions) return EMPTY;
    const items = positionsResult.walletBotPositions.items;
    if (!Array.isArray(items)) return EMPTY;

    // True on-chain balance per token, indexed off every ERC-20 Transfer
    // (`tokenBalance` index in the indexer schema). `walletBotPosition.tokenBalance`
    // only tracks BotFeeRouter activity — a user who buys via the bot and
    // later disposes tokens any other way (direct ERC-20 Transfer, web-app
    // Zap sell, HyperSwap swap) leaves the router counter stale at the last
    // bot-trade state. We drop phantom rows (router balance > 0, chain
    // balance = 0) and clamp displayed balance to `min(routerBalance,
    // chainBalance)` for partial-disposal cases. The cost basis and stored
    // value snapshot are rescaled by the same `chainBalance / routerBalance`
    // ratio in the open-position loop below, so a position partially
    // disposed off-router keeps a meaningful per-token PnL instead of
    // surfacing the displaced cost as a phantom loss on the remainder.
    //
    // The lookup is scoped to the token addresses we actually have positions
    // for — a wallet that holds many non-bot tokens would otherwise crowd the
    // bot-relevant rows out of a global limit and surface them as phantom 0n
    // entries.
    const openTokenAddresses = Array.from(
      new Set(
        items
          .filter(isWalletBotPositionRow)
          .filter((row) => BigInt(row.tokenBalance) > 0n)
          .map((row) => row.token.toLowerCase()),
      ),
    );
    const chainBalanceByToken = new Map<string, bigint>();
    if (openTokenAddresses.length > 0) {
      const balancesResult = await queryPonder<{
        tokenBalances: { items: PonderTokenBalance[] } | null;
      }>(
        `query ($wallet: String!, $tokens: [String!]!, $limit: Int!) {
          tokenBalances(
            where: { wallet: $wallet, tokenAddress_in: $tokens, balance_gt: "0" }
            limit: $limit
          ) {
            items {
              tokenAddress
              balance
            }
          }
        }`,
        { wallet, tokens: openTokenAddresses, limit: PAGE_SIZE },
      );
      for (const tb of balancesResult?.tokenBalances?.items ?? []) {
        // Validate the row before BigInt-converting — a single malformed
        // balance (non-digit characters, missing field) would otherwise throw
        // and the outer catch would wipe both `open` and `realised` to empty
        // arrays.
        if (
          !tb ||
          typeof tb.tokenAddress !== "string" ||
          typeof tb.balance !== "string" ||
          !/^[0-9]+$/.test(tb.balance)
        ) {
          continue;
        }
        chainBalanceByToken.set(
          tb.tokenAddress.toLowerCase(),
          BigInt(tb.balance),
        );
      }
    }

    const open: OpenPosition[] = [];
    const realised: RealisedPosition[] = [];

    for (const item of items) {
      if (!isWalletBotPositionRow(item)) continue;
      const routerBalance = BigInt(item.tokenBalance);
      if (routerBalance > 0n) {
        const chainBalance =
          chainBalanceByToken.get(item.token.toLowerCase()) ?? 0n;
        if (chainBalance > 0n) {
          const balance =
            chainBalance < routerBalance ? chainBalance : routerBalance;
          // Rescale the indexer's stored snapshot value AND the cost basis
          // to the clamped balance so PnL stays meaningful when the user
          // disposed some of the position off-router (direct ERC-20
          // Transfer, web-app Zap sell, HyperSwap swap). Without rescaling
          // the cost basis, a user who bought N tokens via the bot and
          // sold N/2 elsewhere would see the remaining N/2 quoted against
          // the original full cost — surfacing a phantom -50% PnL on a
          // position whose per-token cost is actually unchanged. Under
          // the same average-cost convention the indexer's own sell
          // handler already uses (`walletBotPosition.costBasisUsdc *=
          // remaining / prevBalance`), rescaling here is the read-side
          // equivalent for disposals that bypassed the router. The
          // sibling rescale on value keeps the value/PnL self-consistent
          // when the live-mark refresh below fails.
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
            // Placeholders — overridden below with a live mark when the
            // current price is known. Falls back to the rescaled
            // indexer-stored value when the price lookup fails.
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

    // Refresh `currentValueUsdc` to the live bonding curve / HyperSwap
    // mark. `walletBotPosition.currentValueUsdc` is written by the
    // indexer from the wallet's own last router trade and stays frozen
    // between trades, so a new buy renders as PnL $0 / 0% until the
    // next router trade for this (wallet, token). The /positions spec
    // (`apps/telegram-bot/AGENTS.md → /positions`) calls for the
    // current bonding curve quote pre-grad / HyperSwap quote post-grad
    // — both of which fall out of the indexer's `(curveSupply,
    // ltReserve)` columns since `HyperSwapPair:Sync` mirrors HyperSwap
    // reserves onto them. The refresh is wrapped in its own try/catch
    // so a thrown error (e.g. BounceTech socket error pre-internal-
    // catch, indexer GraphQL malformed response) fails *open*: the
    // open / realised arrays already built from the indexer are
    // returned with their snapshot values intact rather than collapsed
    // to EMPTY by the outer catch.
    try {
      const openTokens = Array.from(
        new Set(open.map((p) => p.token.toLowerCase())),
      );
      const liveMark = await fetchCurrentPricesUsdc18dp(ponderUrl, openTokens);
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
      console.warn(
        "[bot-positions] live mark refresh failed, falling back to indexer snapshot",
        err,
      );
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
  c.header("Cache-Control", "public, s-maxage=15, stale-while-revalidate=30");
  return c.json(formatSuccess(data));
});

export default positions;
