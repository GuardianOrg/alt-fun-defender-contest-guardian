import type { ApiRouterTrade } from "./api";
import type { Trade } from "./types";

const TOKEN_DECIMALS = 10n ** 18n;

function formatTenths(value: bigint, divisor: bigint, suffix: string): string {
  const tenths = (value * 10n + divisor / 2n) / divisor;
  return `${tenths / 10n}.${tenths % 10n}${suffix}`;
}

export function formatTokenBalance(raw: string): string {
  const amount = BigInt(raw);
  if (amount >= 1_000_000_000n * TOKEN_DECIMALS) return formatTenths(amount, 1_000_000_000n * TOKEN_DECIMALS, "B");
  if (amount >= 1_000_000n * TOKEN_DECIMALS) return formatTenths(amount, 1_000_000n * TOKEN_DECIMALS, "M");
  if (amount >= 1_000n * TOKEN_DECIMALS) return formatTenths(amount, 1_000n * TOKEN_DECIMALS, "K");
  return formatTenths(amount, TOKEN_DECIMALS, "");
}

/**
 * Convert an `ApiRouterTrade` (USDC-denominated, sourced from
 * `Zap.Buy/Sell`) into the client `Trade` shape. Used by the REST polling
 * path for both the global feed and per-token feed, and by the trade-feed's
 * WS path after the Zap broadcast is reshaped into `ApiRouterTrade` —
 * covers curve **and** post-graduation trades since `routerTrade` is
 * written for both phases.
 *
 * No LT exchange rate lookup is needed: the indexer records USDC-on-the-
 * wire, so `amountUsd` is a direct conversion.
 */
export function routerTradeToTrade(rt: ApiRouterTrade): Trade {
  const usdcAmountFloat = Number(BigInt(rt.usdcAmount)) / 1e6;
  return {
    id: rt.id,
    side: rt.isBuy ? "BUY" : "SELL",
    amountUsd: usdcAmountFloat,
    tokensAmount: formatTokenBalance(rt.tokenAmount),
    walletAddress: `${rt.trader.slice(0, 4)}…${rt.trader.slice(-2)}`,
    timestamp: new Date(Number(rt.timestamp) * 1000).toISOString(),
    tokenAddress: rt.tokenAddress,
    tokenName: "",
  };
}
