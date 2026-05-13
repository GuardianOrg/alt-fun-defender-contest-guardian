import {
  MIN_USDC_BUY_AMOUNT,
  MIN_USDC_SELL_AMOUNT,
} from "@launchpad/shared";

import { encodeCallback } from "../lib/callbacks.js";
import { closeButtonRow } from "../lib/close.js";
import type { InlineKeyboard } from "./wallet-actions.js";

/**
 * Normalise the user's stored `session.defaultBuyUsdc` against the
 * relevant minimum-trade floor. The /settings wizard already floors
 * writes at `MIN_USDC_BUY_AMOUNT`, but routing every read through these
 * helpers means the label and the click-time handler can never drift
 * from each other — even on stale sessions written before a constant
 * bump.
 */
export const normaliseDefaultBuyUsdc = (raw: number): number =>
  Math.max(raw, MIN_USDC_BUY_AMOUNT);

export const normaliseDefaultSellUsdc = (raw: number): number =>
  Math.max(raw, MIN_USDC_SELL_AMOUNT);

/**
 * Short callback command codes for token buy/sell actions. All commands
 * are colon-free so `encodeCallback` accepts them. Combined with a full
 * 42-char token address they stay within Telegram's 64-byte limit:
 *   e.g. "bt100:0x<40hex>" = 5+1+42 = 48 bytes.
 *
 * `buyDefault` / `sellDefault` resolve their amount from
 * `ctx.session.defaultBuyUsdc` at click time — not from the callback
 * payload — so the most recent /settings value always wins on a stale
 * card.
 */
export const BUY_TOKEN_CMD = {
  refresh: "btr",
  buyDefault: "btd",
  buy100: "bt100",
  buyCustom: "btbx",
} as const;

export const SELL_TOKEN_CMD = {
  refresh: "btsr",
  sellDefault: "btsd",
  sellAll: "btsa",
  sellCustom: "btsx",
} as const;

export type BuyTokenCmd = (typeof BUY_TOKEN_CMD)[keyof typeof BUY_TOKEN_CMD];
export type SellTokenCmd = (typeof SELL_TOKEN_CMD)[keyof typeof SELL_TOKEN_CMD];

/** All buy/sell token command strings, used for prefix-matching in handlers. */
export const ALL_BUY_TOKEN_CMDS = new Set<string>(Object.values(BUY_TOKEN_CMD));
export const ALL_SELL_TOKEN_CMDS = new Set<string>(
  Object.values(SELL_TOKEN_CMD),
);

export const buildBuyTokenKeyboard = (
  tokenAddress: string,
  defaultBuyUsdc: number,
): InlineKeyboard => [
  [
    {
      text: `Buy ${defaultBuyUsdc} USDC`,
      callback_data: encodeCallback(BUY_TOKEN_CMD.buyDefault, tokenAddress),
    },
    {
      text: "Buy 100 USDC",
      callback_data: encodeCallback(BUY_TOKEN_CMD.buy100, tokenAddress),
    },
  ],
  [
    {
      text: "Buy X USDC",
      callback_data: encodeCallback(BUY_TOKEN_CMD.buyCustom, tokenAddress),
    },
    {
      text: "🔄 Refresh",
      callback_data: encodeCallback(BUY_TOKEN_CMD.refresh, tokenAddress),
    },
  ],
  closeButtonRow(),
];

export const buildSellTokenKeyboard = (
  tokenAddress: string,
  defaultBuyUsdc: number,
): InlineKeyboard => [
  [
    {
      text: `Sell ${defaultBuyUsdc} USDC`,
      callback_data: encodeCallback(SELL_TOKEN_CMD.sellDefault, tokenAddress),
    },
    {
      text: "Sell All",
      callback_data: encodeCallback(SELL_TOKEN_CMD.sellAll, tokenAddress),
    },
  ],
  [
    {
      text: "Sell X USDC",
      callback_data: encodeCallback(SELL_TOKEN_CMD.sellCustom, tokenAddress),
    },
    {
      text: "🔄 Refresh",
      callback_data: encodeCallback(SELL_TOKEN_CMD.refresh, tokenAddress),
    },
  ],
  closeButtonRow(),
];
