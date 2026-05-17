/**
 * Canonical slash-menu list shown by Telegram clients when the user
 * types "/" in chat. Pushed to Telegram via `POST /admin/set-commands`
 * (Telegram caches per bot, so this is a one-shot per deploy, not a
 * per-request publish).
 *
 * Keep this list in sync with the `bot.command("<name>", …)` registrations
 * in `commands/*.ts` — listing a command here that isn't wired up shows
 * an entry in the slash menu that silently does nothing, which is worse
 * than not surfacing it at all.
 *
 * Telegram constraints (BotCommand):
 *   - `command`: 1–32 chars, lowercase letters / digits / underscores
 *   - `description`: 1–256 chars, plain text (no Markdown / HTML)
 */

import {
  BOT_COMMAND_BUY_DESCRIPTION,
  BOT_COMMAND_HELP_DESCRIPTION,
  BOT_COMMAND_POSITIONS_DESCRIPTION,
  BOT_COMMAND_REFERRAL_DESCRIPTION,
  BOT_COMMAND_SELL_DESCRIPTION,
  BOT_COMMAND_SETTINGS_DESCRIPTION,
  BOT_COMMAND_START_DESCRIPTION,
  BOT_COMMAND_TRACK_DESCRIPTION,
  BOT_COMMAND_WALLET_DESCRIPTION,
  BOT_COMMAND_WITHDRAW_DESCRIPTION,
  DEFAULT_LANGUAGE,
  type Language,
  t,
} from "./i18n.js";

export interface BotCommandSpec {
  command: string;
  description: string;
}

export const buildBotCommands = (
  lang: Language = DEFAULT_LANGUAGE,
): readonly BotCommandSpec[] => [
  { command: "start", description: t(BOT_COMMAND_START_DESCRIPTION, lang) },
  { command: "help", description: t(BOT_COMMAND_HELP_DESCRIPTION, lang) },
  { command: "buy", description: t(BOT_COMMAND_BUY_DESCRIPTION, lang) },
  { command: "sell", description: t(BOT_COMMAND_SELL_DESCRIPTION, lang) },
  {
    command: "positions",
    description: t(BOT_COMMAND_POSITIONS_DESCRIPTION, lang),
  },
  { command: "track", description: t(BOT_COMMAND_TRACK_DESCRIPTION, lang) },
  { command: "wallet", description: t(BOT_COMMAND_WALLET_DESCRIPTION, lang) },
  {
    command: "withdraw",
    description: t(BOT_COMMAND_WITHDRAW_DESCRIPTION, lang),
  },
  {
    command: "settings",
    description: t(BOT_COMMAND_SETTINGS_DESCRIPTION, lang),
  },
  {
    command: "referral",
    description: t(BOT_COMMAND_REFERRAL_DESCRIPTION, lang),
  },
];

/** Default-locale (English) slash menu. */
export const BOT_COMMANDS: readonly BotCommandSpec[] = buildBotCommands(
  DEFAULT_LANGUAGE,
);
