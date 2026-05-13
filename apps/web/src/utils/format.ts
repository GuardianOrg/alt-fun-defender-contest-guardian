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

/**
 * Market-cap USD formatter. Mirrors `formatUsd` for the K/M ranges, but
 * rounds sub-$1K values to whole dollars — sub-dollar precision on a
 * market cap is noise (a `$123.45` mcap is for all practical purposes a
 * `$123` mcap, and the trailing cents distract from the column rather
 * than informing it). Use this for any UI that surfaces a token's
 * market cap; keep `formatUsd` for balances / trade amounts / position
 * values where cent-level precision still matters to the user.
 *
 * Non-finite inputs (`NaN`, ±`Infinity`) collapse to `$0` rather than
 * leaking `$NaN` / `$InfinityM` into the rows on a degraded feed —
 * components that want an explicit "no data" indicator should pass
 * `null` / `undefined` to {@link formatMcapUsdOrDash} so the dash
 * sentinel is preserved. Negative inputs are similarly clamped to `0`
 * so an off-by-one upstream can never surface a `-$0` rendering.
 */
export function formatMcapUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  const safe = Math.max(0, value);
  if (safe >= 1_000_000) return `$${(safe / 1_000_000).toFixed(2)}M`;
  if (safe >= 1_000)
    return `$${(safe / 1_000).toFixed(safe >= 10_000 ? 0 : 1)}K`;
  return `$${Math.round(safe).toLocaleString()}`;
}

/**
 * Per-token USD price formatter. Used by the chart's price scale when the
 * unit toggle is set to `price`. Pump.fun-class launches sit at sub-cent
 * prices for their entire curve life (a $4K-mcap launch with 1B supply is
 * $4e-6/token), so `formatUsd`'s 2-decimal cap collapses every label to
 * `$0.00` and the chart becomes unreadable. We fall back to 4 significant
 * figures with fixed (non-scientific) notation in the sub-cent regime so
 * users can still read precise prices off the axis.
 */
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

/**
 * Signed USD price delta (e.g. trailing-24h asset move). Magnitude-aware
 * so a delta renders at granularity appropriate to the underlying price:
 *   - abs ≥ 10,000   → integer with locale separators (`+$1,234`)
 *   - abs ≥ 100      → integer (`+$150`)
 *   - abs ≥ 0.01     → 2 decimals (`+$1.50`, `+$0.50`) — handles every
 *                      mainstream crypto / equity move at sensible cent
 *                      precision
 *   - sub-cent       → 4 significant digits, fixed (non-scientific) so
 *                      kPEPE-class deltas (~$1e-6 / token) still convey
 *                      a meaningful number
 *
 * Negative values render with a leading `-`; an exact zero (or a
 * non-finite input from a degraded feed) is `$0.00` with no sign so we
 * never surface a misleading `+$0`.
 */
export function formatPriceChange(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0.00";
  const sign = value > 0 ? "+" : "-";
  const abs = Math.abs(value);
  if (abs >= 10_000) return `${sign}$${Math.round(abs).toLocaleString()}`;
  if (abs >= 100) return `${sign}$${abs.toFixed(0)}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(2)}`;
  // Sub-cent: pick decimals so we land on ~4 significant figures, never
  // collapsing to "+$0.00" on tiny but real moves. Mirrors
  // `formatPriceUsd`'s sub-cent treatment.
  const exp = Math.floor(Math.log10(abs));
  const decimals = Math.min(20, 3 - exp);
  return `${sign}$${abs.toFixed(decimals)}`;
}

/** Format a nullable USD value, rendering `—` when null/undefined. */
export function formatUsdOrDash(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return formatUsd(value);
}

/** Nullable variant of {@link formatMcapUsd}; renders `—` when null/undefined
 *  so a row whose market cap hasn't loaded yet doesn't collapse to `$0`. */
export function formatMcapUsdOrDash(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return formatMcapUsd(value);
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
  // Drop the `xyz:` namespace prefix on equity / commodity perps (e.g.
  // `xyz:SP500` → `SP500 3× Long`). The on-chain `targetAsset` keeps the
  // prefix so identifiers remain unambiguous everywhere it matters.
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
  // OpenZeppelin `Clones.FailedDeployment()` selector — thrown by
  // `Bonding._deployAndSeed` when the predicted CREATE2 address already
  // has bytecode. The `useCreateToken` pre-flight catches the common
  // case before the wallet popup, but viem still surfaces this raw
  // selector if a tx slips through (e.g. two parallel launches landing
  // in the same block, with the second tx losing the race). Surface
  // it as the same "change name/ticker, then retry" copy the
  // pre-flight uses so the recovery path is consistent.
  // Lowercase match on the named selector so we still catch RPC/wallet
  // wrappers that normalise the error string casing (e.g. some
  // providers re-emit "faileddeployment()" or wrap the revert in a
  // pre-formatted "execution reverted: faileddeployment" line). The
  // raw 4-byte selector is fixed-case hex, so a literal `includes` is
  // sufficient for that arm.
  if (raw.includes("0xb06ebf3d") || lower.includes("faileddeployment")) {
    return (
      "A token with this name and ticker already exists for your wallet. " +
      "Change the name or ticker, or click Launch again to mine a new vanity address."
    );
  }
  if (lower.includes("wallet timeout") || lower.includes("request timeout")) {
    return "Wallet timed out — please try again. If using a mobile wallet, make sure the app is open.";
  }
  if (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("rejected the request")
  ) {
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

/**
 * Default "recently deployed" window. Aligns with the 24h change semantic:
 * a token younger than this can't have a meaningful 24h price comparison
 * (it didn't exist 24h ago), and the indexer's `/market-data` snapshot may
 * not have populated its row yet either. Inside the window we treat null
 * mcap/24h-change as `0` rather than "unknown" so the home page doesn't
 * flash a wall of `—` for every fresh launch (issue #709).
 */
export const RECENTLY_DEPLOYED_WINDOW_MS = 24 * 60 * 60 * 1_000;

/**
 * `true` when `createdAt` is within the trailing `windowMs` window ending
 * at `now`. Used by the home page token list to coerce unknown mcap /
 * 24h-change to `0` for fresh launches whose data isn't in the indexer
 * snapshot yet. An invalid / unparseable / future `createdAt` returns
 * `false` (treat as "old") so we never accidentally hide real
 * degradation — or corrupted timestamps — behind a "—" that's silently
 * replaced by "0".
 */
export function isRecentlyDeployed(
  createdAt: string | null | undefined,
  windowMs: number = RECENTLY_DEPLOYED_WINDOW_MS,
): boolean {
  if (createdAt === null || createdAt === undefined) return false;
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  const age = Date.now() - created;
  // Future timestamps (negative `age`) likely indicate corrupted data
  // or significant client-clock skew, not a fresh launch. Bail rather
  // than mask the bad data with a "0" placeholder that would persist
  // until wall-clock advances past the future timestamp.
  if (age < 0) return false;
  return age < windowMs;
}
