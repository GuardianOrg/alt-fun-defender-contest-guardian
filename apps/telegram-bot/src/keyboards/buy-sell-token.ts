import { MIN_USDC_BUY_AMOUNT } from "@launchpad/shared";

import { encodeCallback } from "../lib/callbacks.js";
import { backHomeRow } from "../lib/nav.js";
import type { InlineKeyboard } from "./wallet-actions.js";

/** Default 5-slot buy preset amounts (USDC) — issue #818. */
export const DEFAULT_BUY_PRESETS_USDC: readonly number[] = [
  20, 40, 60, 80, 100,
] as const;

/** Default 5-slot sell preset percents — issue #818. */
export const DEFAULT_SELL_PRESETS_PCT: readonly number[] = [
  10, 25, 50, 75, 100,
] as const;

export const BUY_PRESETS_LENGTH = 5;
export const SELL_PRESETS_LENGTH = 5;

/** Max user-configurable buy preset (mirrors /settings wizard cap). */
export const MAX_BUY_PRESET_USDC = 10_000;

/**
 * Normalise a stored buy-preset array against the bot's minimum-trade
 * floor and the configurable max. Sessions written before issue #818
 * have no `buyPresetsUsdc`; readers fall back to defaults seeded from
 * the legacy `defaultBuyUsdc` (so the user's existing default lands in
 * slot 0).
 */
export const normaliseBuyPresets = (
  stored: readonly number[] | undefined,
  legacyDefaultBuyUsdc: number,
): number[] => {
  const base =
    Array.isArray(stored) && stored.length === BUY_PRESETS_LENGTH
      ? stored
      : [legacyDefaultBuyUsdc, ...DEFAULT_BUY_PRESETS_USDC.slice(1)];
  return base.map((raw) => {
    const n = Number.isFinite(raw) ? Math.round(raw) : MIN_USDC_BUY_AMOUNT;
    return Math.min(Math.max(n, MIN_USDC_BUY_AMOUNT), MAX_BUY_PRESET_USDC);
  });
};

/**
 * Normalise a stored sell-preset percent array. Each slot must be an
 * integer in [1, 100]; out-of-range slots fall back to the same-index
 * default.
 */
export const normaliseSellPresets = (
  stored: readonly number[] | undefined,
): number[] => {
  const base =
    Array.isArray(stored) && stored.length === SELL_PRESETS_LENGTH
      ? stored
      : DEFAULT_SELL_PRESETS_PCT;
  return base.map((raw, idx) => {
    const n = Number.isFinite(raw) ? Math.round(raw) : 0;
    if (n < 1 || n > 100) {
      return DEFAULT_SELL_PRESETS_PCT[idx]!;
    }
    return n;
  });
};

/**
 * Legacy normaliser kept for action-card.ts and buy.ts call sites that
 * still need a single-amount default. Returns `buyPresetsUsdc[0]`,
 * clamped to the minimum-trade floor.
 */
export const normaliseDefaultBuyUsdc = (raw: number): number =>
  Math.max(raw, MIN_USDC_BUY_AMOUNT);

/**
 * Short callback command codes for token buy/sell actions. All commands
 * are colon-free so `encodeCallback` accepts them. Combined with a full
 * 42-char token address they stay within Telegram's 64-byte limit:
 *   e.g. "btp:0x<40hex>:100" = 4+1+42+1+3 = 51 bytes.
 *
 * Buy presets encode the USDC amount in the callback payload (not a
 * slot index) so a stale card always buys the amount the user actually
 * sees on the button. Sell presets encode the percent in the same
 * pattern.
 */
export const BUY_TOKEN_CMD = {
  refresh: "btr",
  buyPreset: "btp",
  buyCustom: "btbx",
} as const;

export const SELL_TOKEN_CMD = {
  refresh: "btsr",
  sellPercent: "btsp",
  sellCustomPercent: "btspx",
} as const;

/**
 * Validates a sell-percent callback arg. Accepts any integer in
 * [1, 100] — the keyboard renders from `session.sellPresetsPct` so the
 * valid set is user-configurable. The 1–100 bound mirrors the custom
 * sell-percent wizard's input gate.
 */
export const isSellPercent = (n: number): boolean =>
  Number.isInteger(n) && n >= 1 && n <= 100;

/**
 * Validates a buy-preset callback arg. Accepts any positive integer up
 * to `MAX_BUY_PRESET_USDC` and at least `MIN_USDC_BUY_AMOUNT`.
 */
export const isBuyPresetAmount = (n: number): boolean =>
  Number.isInteger(n) && n >= MIN_USDC_BUY_AMOUNT && n <= MAX_BUY_PRESET_USDC;

export type BuyTokenCmd = (typeof BUY_TOKEN_CMD)[keyof typeof BUY_TOKEN_CMD];
export type SellTokenCmd = (typeof SELL_TOKEN_CMD)[keyof typeof SELL_TOKEN_CMD];

/** All buy/sell token command strings, used for prefix-matching in handlers. */
export const ALL_BUY_TOKEN_CMDS = new Set<string>(Object.values(BUY_TOKEN_CMD));
export const ALL_SELL_TOKEN_CMDS = new Set<string>(
  Object.values(SELL_TOKEN_CMD),
);

type Button = { text: string; callback_data: string };

/**
 * Pack preset buttons + the custom-X button into rows of three. With the
 * default 5 presets this yields `[p0 p1 p2] [p3 p4 X]`; for other counts
 * X drops onto its own row when the last preset row is already full.
 */
const packRowsOfThree = (
  presetButtons: Button[],
  customButton: Button,
): Button[][] => {
  const buttons = [...presetButtons, customButton];
  const rows: Button[][] = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  return rows;
};

const presetButtonsBuy = (
  tokenAddress: string,
  presets: readonly number[],
): Button[] =>
  presets.map((amount) => ({
    text: `Buy ${amount} USDC`,
    callback_data: encodeCallback(
      BUY_TOKEN_CMD.buyPreset,
      tokenAddress,
      String(amount),
    ),
  }));

const presetButtonsSell = (
  tokenAddress: string,
  presets: readonly number[],
): Button[] =>
  presets.map((pct) => ({
    text: `Sell ${pct}%`,
    callback_data: encodeCallback(
      SELL_TOKEN_CMD.sellPercent,
      tokenAddress,
      String(pct),
    ),
  }));

export const buildBuyTokenKeyboard = (
  tokenAddress: string,
  buyPresetsUsdc: readonly number[],
): InlineKeyboard => [
  ...packRowsOfThree(presetButtonsBuy(tokenAddress, buyPresetsUsdc), {
    text: "Buy X USDC",
    callback_data: encodeCallback(BUY_TOKEN_CMD.buyCustom, tokenAddress),
  }),
  [
    {
      text: "🔄 Refresh",
      callback_data: encodeCallback(BUY_TOKEN_CMD.refresh, tokenAddress),
    },
  ],
  backHomeRow(),
];

export const buildSellTokenKeyboard = (
  tokenAddress: string,
  sellPresetsPct: readonly number[],
): InlineKeyboard => [
  ...packRowsOfThree(presetButtonsSell(tokenAddress, sellPresetsPct), {
    text: "Sell X%",
    callback_data: encodeCallback(
      SELL_TOKEN_CMD.sellCustomPercent,
      tokenAddress,
    ),
  }),
  [
    {
      text: "🔄 Refresh",
      callback_data: encodeCallback(SELL_TOKEN_CMD.refresh, tokenAddress),
    },
  ],
  backHomeRow(),
];
