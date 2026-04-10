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
    return "Amount below BounceTech minimum ($10 USDC).";
  }
  return e instanceof Error ? e.message : "Transaction failed";
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text).catch(() => {});
}
