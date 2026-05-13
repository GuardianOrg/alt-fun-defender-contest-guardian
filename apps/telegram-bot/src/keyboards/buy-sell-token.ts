import { encodeCallback } from "../lib/callbacks.js";
import type { InlineKeyboard } from "./wallet-actions.js";

/**
 * Short callback command codes for token buy/sell actions. All commands
 * are colon-free so `encodeCallback` accepts them. Combined with a full
 * 42-char token address they stay within Telegram's 64-byte limit:
 *   e.g. "bt100:0x<40hex>" = 5+1+42 = 48 bytes.
 */
export const BUY_TOKEN_CMD = {
  refresh: "btr",
  buy20: "bt20",
  buy100: "bt100",
  buyCustom: "btbx",
} as const;

export const SELL_TOKEN_CMD = {
  refresh: "btsr",
  sell20: "bts20",
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

export const buildBuyTokenKeyboard = (tokenAddress: string): InlineKeyboard => [
  [
    {
      text: "Buy 20 USDC",
      callback_data: encodeCallback(BUY_TOKEN_CMD.buy20, tokenAddress),
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
];

export const buildSellTokenKeyboard = (tokenAddress: string): InlineKeyboard => [
  [
    {
      text: "Sell 20 USDC",
      callback_data: encodeCallback(SELL_TOKEN_CMD.sell20, tokenAddress),
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
];
