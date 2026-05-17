import type { TokenInfo } from "./api.js";
import {
  TOKEN_CARD_BALANCE_UNAVAILABLE,
  TOKEN_CARD_CHANGE_24H_HTML,
  TOKEN_CARD_CURVE_FILLED_HTML,
  TOKEN_CARD_MARKET_CAP_HTML,
  TOKEN_CARD_PRICE_HTML,
  TOKEN_CARD_VIEW_ON_ALT_FUN_HTML,
  TOKEN_CARD_VIEW_ON_EXPLORER_HTML,
  TOKEN_CARD_VOLUME_24H_HTML,
  TOKEN_CARD_YOUR_BALANCE_HTML,
  TOKEN_CARD_YOUR_USDC_BALANCE_HTML,
  TOKEN_LIFECYCLE_BONDING_CURVE,
  TOKEN_LIFECYCLE_GRADUATED,
  TOKEN_LIFECYCLE_GRADUATING,
} from "./i18n.js";

const HYPEREVMSCAN_BASE = "https://hyperevmscan.io";
const ALTFUN_TOKEN_BASE = "https://alt.fun/token";

/** 6-decimal USDC raw → "$X.XX" string. */
export const formatUsdc6 = (raw: bigint | null): string => {
  if (raw === null) return "—";
  if (raw === 0n) return "$0.00";
  const whole = raw / 1_000_000n;
  const frac = Number(raw % 1_000_000n) / 1_000_000;
  return `$${(Number(whole) + frac).toFixed(2)}`;
};

/**
 * 18-decimal native HYPE raw → human-readable balance string.
 * Returns "—" on null (RPC failure) so callers can render a degraded
 * state without crashing. Native HYPE is the gas asset on HyperEVM —
 * every tx the bot signs spends a small amount, so the /start panel
 * surfaces this alongside USDC.
 */
export const formatHype18 = (raw: bigint | null): string => {
  if (raw === null) return "—";
  if (raw === 0n) return "0";
  const whole = raw / 10n ** 18n;
  const fracRaw = raw % 10n ** 18n;
  const frac = Number(fracRaw) / 1e18;
  const total = Number(whole) + frac;
  if (total >= 1) return total.toFixed(4).replace(/\.?0+$/, "");
  return total.toFixed(6).replace(/\.?0+$/, "") || "0";
};

/** 18-decimal token raw → human-readable string (no "$"). */
export const formatToken18 = (raw: bigint | null): string => {
  if (raw === null) return "—";
  if (raw === 0n) return "0";
  const whole = raw / 10n ** 18n;
  const frac = Number(raw % 10n ** 18n) / 1e18;
  const total = Number(whole) + frac;
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(2)}M`;
  if (total >= 1_000) return `${Math.floor(total).toLocaleString("en-US")}.${total.toFixed(4).split(".")[1] ?? "0000"}`;
  return total.toFixed(4).replace(/\.?0+$/, "") || "0";
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const formatPct = (v: number | null): string => {
  if (v === null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
};

const formatUsdPrice = (v: number | null): string => {
  if (v === null) return "—";
  if (v === 0) return "$0.00";
  if (v < 0.000001) return `$${v.toExponential(3)}`;
  if (v < 0.001) return `$${v.toFixed(6)}`;
  if (v < 1) return `$${v.toFixed(4)}`;
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
};

const formatMcap = (v: number | null): string => {
  if (v === null) return "—";
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};

const formatVolume = (v: number | null): string => {
  if (v === null) return "—";
  if (v === 0) return "$0";
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
};

/**
 * Build the LT symbol from the underlying / leverage / direction fields
 * (e.g. `HYPE` + `5` + `long` → `HYPE5L`). Returns `null` when any
 * component is missing so the card falls back to the bare ticker —
 * older API builds that don't yet expose these fields keep working.
 *
 * Direction comes from the api DB row as `"long"` | `"short"` (lower
 * case); the LT symbol convention uses `L` / `S` so we collapse with
 * a first-letter uppercase. Any unrecognised direction is dropped
 * rather than guessed.
 */
const buildLtSymbol = (token: TokenInfo): string | null => {
  if (!token.underlying || token.leverage === null || !token.ltDirection) {
    return null;
  }
  const direction = token.ltDirection.toLowerCase();
  if (direction !== "long" && direction !== "short") return null;
  const suffix = direction === "long" ? "L" : "S";
  return `${token.underlying}${token.leverage}${suffix}`;
};

/**
 * Token card header — "<b>Name</b> (<code>TICKER</code> / <code>HYPE5L</code>)".
 * Falls back to just `(TICKER)` when the LT symbol can't be assembled
 * (older API build missing underlying/leverage/ltDirection). Issue #820.
 */
const renderHeader = (token: TokenInfo): string => {
  const ltSymbol = buildLtSymbol(token);
  const ticker = `<code>${escapeHtml(token.ticker)}</code>`;
  const suffix = ltSymbol ? ` / <code>${escapeHtml(ltSymbol)}</code>` : "";
  return `<b>${escapeHtml(token.name)}</b> (${ticker}${suffix})`;
};

const statusLabel = (status: string): string => {
  if (status === "graduated") return TOKEN_LIFECYCLE_GRADUATED.English;
  if (status === "graduating") return TOKEN_LIFECYCLE_GRADUATING.English;
  return TOKEN_LIFECYCLE_BONDING_CURVE.English;
};

/**
 * Render the HTML token card for the buy flow. Shows USDC balance so the
 * user knows how much they can spend before choosing an amount.
 */
export const renderBuyTokenCardText = (
  token: TokenInfo,
  usdcBalance: bigint | null,
): string => {
  const explorerUrl = `${HYPEREVMSCAN_BASE}/token/${token.address}`;
  const altFunUrl = `${ALTFUN_TOKEN_BASE}/${token.address}`;
  const curvePct =
    token.curveFilled !== null ? `${token.curveFilled.toFixed(1)}%` : "—";
  const lines: string[] = [
    renderHeader(token),
    `<i>${statusLabel(token.status)}</i>`,
    "",
    TOKEN_CARD_MARKET_CAP_HTML.English(formatMcap(token.mcapUsd)),
    TOKEN_CARD_PRICE_HTML.English(formatUsdPrice(token.priceUsd)),
    TOKEN_CARD_CHANGE_24H_HTML.English(formatPct(token.change24h)),
    TOKEN_CARD_VOLUME_24H_HTML.English(formatVolume(token.volume24hUsd)),
  ];
  if (token.status !== "graduated") {
    lines.push(TOKEN_CARD_CURVE_FILLED_HTML.English(curvePct));
  }
  lines.push(
    "",
    TOKEN_CARD_YOUR_USDC_BALANCE_HTML.English(formatUsdc6(usdcBalance)),
    "",
    TOKEN_CARD_VIEW_ON_EXPLORER_HTML.English(explorerUrl),
    TOKEN_CARD_VIEW_ON_ALT_FUN_HTML.English(altFunUrl),
  );
  return lines.join("\n");
};

/**
 * Render the HTML token card for the sell flow. Shows the user's token
 * holding so they know how much they can sell.
 */
export const renderSellTokenCardText = (
  token: TokenInfo,
  tokenBalance: bigint | null,
): string => {
  const explorerUrl = `${HYPEREVMSCAN_BASE}/token/${token.address}`;
  const altFunUrl = `${ALTFUN_TOKEN_BASE}/${token.address}`;

  let holdingText: string;
  if (tokenBalance === null) {
    holdingText = TOKEN_CARD_BALANCE_UNAVAILABLE.English;
  } else if (tokenBalance > 0n) {
    const formattedBal = formatToken18(tokenBalance);
    let usdEquiv = "";
    if (token.priceUsd !== null) {
      const totalEth = Number(tokenBalance) / 1e18;
      usdEquiv = ` (≈${formatUsdPrice(totalEth * token.priceUsd)})`;
    }
    holdingText = `${formattedBal} ${escapeHtml(token.ticker)}${usdEquiv}`;
  } else {
    holdingText = `0 ${escapeHtml(token.ticker)}`;
  }

  const lines: string[] = [
    renderHeader(token),
    `<i>${statusLabel(token.status)}</i>`,
    "",
    TOKEN_CARD_MARKET_CAP_HTML.English(formatMcap(token.mcapUsd)),
    TOKEN_CARD_PRICE_HTML.English(formatUsdPrice(token.priceUsd)),
    TOKEN_CARD_CHANGE_24H_HTML.English(formatPct(token.change24h)),
    TOKEN_CARD_VOLUME_24H_HTML.English(formatVolume(token.volume24hUsd)),
  ];
  lines.push(
    "",
    TOKEN_CARD_YOUR_BALANCE_HTML.English(holdingText),
    "",
    TOKEN_CARD_VIEW_ON_EXPLORER_HTML.English(explorerUrl),
    TOKEN_CARD_VIEW_ON_ALT_FUN_HTML.English(altFunUrl),
  );
  return lines.join("\n");
};

/**
 * Render the HTML token card for the /track flow. Info-only — no
 * USDC or token balance line because /track does not require an
 * active wallet (the user may be researching before funding).
 */
export const renderTrackTokenCardText = (token: TokenInfo): string => {
  const explorerUrl = `${HYPEREVMSCAN_BASE}/token/${token.address}`;
  const altFunUrl = `${ALTFUN_TOKEN_BASE}/${token.address}`;
  const curvePct =
    token.curveFilled !== null ? `${token.curveFilled.toFixed(1)}%` : "—";
  const lines: string[] = [
    renderHeader(token),
    `<i>${statusLabel(token.status)}</i>`,
    "",
    TOKEN_CARD_MARKET_CAP_HTML.English(formatMcap(token.mcapUsd)),
    TOKEN_CARD_PRICE_HTML.English(formatUsdPrice(token.priceUsd)),
    TOKEN_CARD_CHANGE_24H_HTML.English(formatPct(token.change24h)),
    TOKEN_CARD_VOLUME_24H_HTML.English(formatVolume(token.volume24hUsd)),
  ];
  if (token.status !== "graduated") {
    lines.push(TOKEN_CARD_CURVE_FILLED_HTML.English(curvePct));
  }
  lines.push(
    "",
    TOKEN_CARD_VIEW_ON_EXPLORER_HTML.English(explorerUrl),
    TOKEN_CARD_VIEW_ON_ALT_FUN_HTML.English(altFunUrl),
  );
  return lines.join("\n");
};

/** Estimate the USDC value of a token holding using the current priceUsd. */
export const estimateHoldingUsdc = (
  tokenBalance: bigint,
  priceUsd: number,
): number => (Number(tokenBalance) / 1e18) * priceUsd;
