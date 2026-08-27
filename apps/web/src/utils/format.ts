import {
  getAssetDisplayName,
  MIN_USDC_BUY_AMOUNT,
  MIN_USDC_SELL_AMOUNT,
} from "@launchpad/shared";

import type { Leverage } from "../config/constants";
import type { Direction } from "../services/types";

export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000)
    return `$${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/** Market-cap formatter: whole dollars under `$1K`, K/M above, non-finite as `$0`. */
export function formatMcapUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  const safe = Math.max(0, value);
  if (safe >= 1_000_000) return `$${(safe / 1_000_000).toFixed(2)}M`;
  if (safe >= 1_000)
    return `$${(safe / 1_000).toFixed(safe >= 10_000 ? 0 : 1)}K`;
  return `$${Math.round(safe).toLocaleString()}`;
}

/** Per-token USD price formatter that preserves sub-cent chart labels. */
export function formatPriceUsd(value: number): string {
  if (!isFinite(value) || value <= 0) return "$0";
  if (value >= 1_000) return formatUsd(value);
  if (value >= 1) return `$${value.toFixed(4)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  // Sub-cent: 4 significant digits, never scientific. `Math.log10` is safe
  // here because we've ruled out value <= 0 above.
  const exp = Math.floor(Math.log10(value));
  const decimals = Math.min(20, 3 - exp);
  return `$${value.toFixed(decimals)}`;
}

export function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

/** Signed USD price delta with magnitude-aware precision. */
export function formatPriceChange(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0.00";
  const sign = value > 0 ? "+" : "-";
  const abs = Math.abs(value);
  if (abs >= 10_000) return `${sign}$${Math.round(abs).toLocaleString()}`;
  if (abs >= 100) return `${sign}$${abs.toFixed(0)}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(2)}`;
  // Preserve tiny real moves instead of collapsing to `+$0.00`.
  const exp = Math.floor(Math.log10(abs));
  const decimals = Math.min(20, 3 - exp);
  return `${sign}$${abs.toFixed(decimals)}`;
}

/** Format a nullable USD value, rendering `—` when null/undefined. */
export function formatUsdOrDash(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return formatUsd(value);
}

/** Nullable variant of {@link formatMcapUsd}; renders `—` when unknown. */
export function formatMcapUsdOrDash(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return formatMcapUsd(value);
}

/** Format a nullable percent, rendering `—` when null/undefined. */
export function formatPercentOrDash(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return formatPercent(value);
}

/** Curve-filled progress; unknown renders as `—`, not `0%`. */
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
  // Drop the display-only `xyz:` namespace prefix.
  const display = getAssetDisplayName(asset);
  return `${display} ${leverage}× ${direction === "long" ? "Long" : "Short"}`;
}

export function getErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();
  if (
    raw.includes("InsufficientBalance") ||
    (lower.includes("insufficient") && lower.includes("balance"))
  ) {
    return "Sell exceeds available liquidity. Try a smaller amount — buffer replenishes in ~10s.";
  }
  if (raw.includes("0x05eb05ac")) {
    return `Amount below minimum ($${MIN_USDC_BUY_AMOUNT} buy / $${MIN_USDC_SELL_AMOUNT} sell).`;
  }
  // CREATE2 clone collision; retrying lets the pre-flight re-mine around it.
  if (raw.includes("0xb06ebf3d") || lower.includes("faileddeployment")) {
    return (
      "Another launch claimed that address before yours landed. " +
      "Click Launch again - we'll mine a fresh address automatically."
    );
  }
  if (lower.includes("wallet timeout") || lower.includes("request timeout")) {
    return "Wallet timed out - please try again. If using a mobile wallet, make sure the app is open.";
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("http request failed")
  ) {
    return "Could not reach HyperEVM - try again in a few seconds.";
  }
  if (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("rejected the request")
  ) {
    return "Transaction was rejected in your wallet.";
  }
  if (lower.includes("slippageexceeded") || raw.includes("SlippageExceeded")) {
    return "Price moved too much - try increasing slippage or reducing the amount.";
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

// Fresh tokens cannot have real 24h deltas yet, so null market data can render as 0.
export const RECENTLY_DEPLOYED_WINDOW_MS = 24 * 60 * 60 * 1_000;

/** Whether `createdAt` falls inside the fresh-token window. */
export function isRecentlyDeployed(
  createdAt: string | null | undefined,
  windowMs: number = RECENTLY_DEPLOYED_WINDOW_MS,
): boolean {
  if (createdAt === null || createdAt === undefined) return false;
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  const age = Date.now() - created;
  // Future timestamps likely indicate bad data or client-clock skew.
  if (age < 0) return false;
  return age < windowMs;
}
