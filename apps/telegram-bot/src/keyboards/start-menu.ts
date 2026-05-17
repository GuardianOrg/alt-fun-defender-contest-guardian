import {
  DEFAULT_LANGUAGE,
  type Language,
  REFRESH_BUTTON_TEXT,
  START_BUY_BUTTON,
  START_BUY_USDC_VIA_RELAY_BUTTON,
  START_HELP_BUTTON,
  START_POSITIONS_BUTTON,
  START_REFERRAL_BUTTON,
  START_SELL_BUTTON,
  START_SETTINGS_BUTTON,
  START_TRACK_BUTTON,
  START_WALLET_BUTTON,
  START_WITHDRAW_BUTTON,
  t,
} from "../lib/i18n.js";
import type { InlineKeyboard } from "./wallet-actions.js";

/**
 * Short callback codes for the `/start` main menu. Prefixed `st:` so
 * they never collide with the wallet (`w*`) or positions (`pp`)
 * namespaces, and every code stays well inside Telegram's 64-byte
 * `callback_data` budget.
 */
export const START_CALLBACK = {
  refresh: "st:r",
  buy: "st:b",
  sell: "st:s",
  positions: "st:p",
  track: "st:t",
  wallet: "st:w",
  withdraw: "st:wd",
  settings: "st:set",
  referral: "st:ref",
  help: "st:h",
} as const;

/**
 * Main menu rendered under the `/start` welcome message. One row per
 * pair of related commands, mirroring BONKBot's layout. The `buyUsdcUrl`
 * URL button sits above the action rows so the funding path is the
 * most prominent CTA for first-time users.
 */
export const buildStartMenuKeyboard = (
  buyUsdcUrl: string,
  lang: Language = DEFAULT_LANGUAGE,
): InlineKeyboard => [
  [
    {
      text: t(START_BUY_USDC_VIA_RELAY_BUTTON, lang),
      url: buyUsdcUrl,
    },
    { text: t(REFRESH_BUTTON_TEXT, lang), callback_data: START_CALLBACK.refresh },
  ],
  [
    { text: t(START_BUY_BUTTON, lang), callback_data: START_CALLBACK.buy },
    { text: t(START_SELL_BUTTON, lang), callback_data: START_CALLBACK.sell },
  ],
  [
    {
      text: t(START_POSITIONS_BUTTON, lang),
      callback_data: START_CALLBACK.positions,
    },
    { text: t(START_TRACK_BUTTON, lang), callback_data: START_CALLBACK.track },
  ],
  [
    { text: t(START_WALLET_BUTTON, lang), callback_data: START_CALLBACK.wallet },
    {
      text: t(START_WITHDRAW_BUTTON, lang),
      callback_data: START_CALLBACK.withdraw,
    },
  ],
  [
    {
      text: t(START_SETTINGS_BUTTON, lang),
      callback_data: START_CALLBACK.settings,
    },
    {
      text: t(START_REFERRAL_BUTTON, lang),
      callback_data: START_CALLBACK.referral,
    },
  ],
  [{ text: t(START_HELP_BUTTON, lang), callback_data: START_CALLBACK.help }],
];
