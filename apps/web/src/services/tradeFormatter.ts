import { formatUnits } from "viem";

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

export interface PonderTradeInput {
  id: string;
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  ltAmount: string;
  tokenAmount: string;
  timestamp: string;
}

export function ponderTradeToTrade(pt: PonderTradeInput, exchangeRate: number): Trade {
  const ltAmountFloat = parseFloat(formatUnits(BigInt(pt.ltAmount), 18));

  return {
    id: pt.id,
    side: pt.isBuy ? "BUY" : "SELL",
    amountUsd: ltAmountFloat * exchangeRate,
    tokensAmount: formatTokenBalance(pt.tokenAmount),
    walletAddress: `${pt.trader.slice(0, 4)}…${pt.trader.slice(-2)}`,
    timestamp: new Date(Number(pt.timestamp) * 1000).toISOString(),
    tokenAddress: pt.tokenAddress,
    tokenName: "",
  };
}
