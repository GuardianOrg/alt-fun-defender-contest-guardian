import { MIN_USDC_BUY_AMOUNT, MIN_USDC_SELL_AMOUNT } from "@launchpad/shared";

import type { Leverage } from "../config/constants";
import type { Direction } from "../services/types";

export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000)
    return `$${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

/** Format a nullable USD value, rendering `—` when null/undefined. */
export function formatUsdOrDash(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return formatUsd(value);
}

/** Format a nullable percent, rendering `—` when null/undefined. */
export function formatPercentOrDash(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return formatPercent(value);
}

/** Curve-filled progress (0–100, integer). Unknown renders as `—` rather than
 *  silently collapsing to 0, so a degraded indexer can't make live curves look
 *  empty. */
export function formatCurveFilled(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value)}%`;
}

export function shortenAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function formatTokenAmount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function cn(
  ...classes: (string | boolean | undefined | null)[]
): string {
  return classes.filter(Boolean).join(" ");
}

export function getLtDisplayName(
  asset: string,
  leverage: Leverage,
  direction: Direction,
): string {
  return `${asset} ${leverage}× ${direction === "long" ? "Long" : "Short"}`;
}

export function getErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();
  if (raw.includes("InsufficientBalance") || (lower.includes("insufficient") && lower.includes("balance"))) {
    return "Sell exceeds available liquidity. Try a smaller amount — buffer replenishes in ~10s.";
  }
  if (raw.includes("0x05eb05ac")) {
    return `Amount below minimum ($${MIN_USDC_BUY_AMOUNT} buy / $${MIN_USDC_SELL_AMOUNT} sell).`;
  }
  if (lower.includes("wallet timeout") || lower.includes("request timeout")) {
    return "Wallet timed out — please try again. If using a mobile wallet, make sure the app is open.";
  }
  if (lower.includes("user rejected") || lower.includes("user denied") || lower.includes("rejected the request")) {
    return "Transaction was rejected in your wallet.";
  }
  if (lower.includes("slippageexceeded") || raw.includes("SlippageExceeded")) {
    return "Price moved too much — try increasing slippage or reducing the amount.";
  }
  return e instanceof Error ? e.message : "Transaction failed";
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text).catch(() => {});
}

export function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1_000);
  if (secs < 1) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
