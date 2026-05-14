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
): InlineKeyboard => [
  [
    {
      text: "Buy USDC via Relay",
      url: buyUsdcUrl,
    },
    { text: "🔄 Refresh", callback_data: START_CALLBACK.refresh },
  ],
  [
    { text: "Buy", callback_data: START_CALLBACK.buy },
    { text: "Sell", callback_data: START_CALLBACK.sell },
  ],
  [
    { text: "Positions", callback_data: START_CALLBACK.positions },
    { text: "Track", callback_data: START_CALLBACK.track },
  ],
  [
    { text: "Wallet", callback_data: START_CALLBACK.wallet },
    { text: "Withdraw", callback_data: START_CALLBACK.withdraw },
  ],
  [
    { text: "Settings", callback_data: START_CALLBACK.settings },
    { text: "Referral", callback_data: START_CALLBACK.referral },
  ],
  [{ text: "Help", callback_data: START_CALLBACK.help }],
];
