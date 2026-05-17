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
} from "./i18n.js";

export interface BotCommandSpec {
  command: string;
  description: string;
}

export const BOT_COMMANDS: readonly BotCommandSpec[] = [
  { command: "start", description: BOT_COMMAND_START_DESCRIPTION.English },
  { command: "help", description: BOT_COMMAND_HELP_DESCRIPTION.English },
  { command: "buy", description: BOT_COMMAND_BUY_DESCRIPTION.English },
  { command: "sell", description: BOT_COMMAND_SELL_DESCRIPTION.English },
  { command: "positions", description: BOT_COMMAND_POSITIONS_DESCRIPTION.English },
  { command: "track", description: BOT_COMMAND_TRACK_DESCRIPTION.English },
  { command: "wallet", description: BOT_COMMAND_WALLET_DESCRIPTION.English },
  { command: "withdraw", description: BOT_COMMAND_WITHDRAW_DESCRIPTION.English },
  { command: "settings", description: BOT_COMMAND_SETTINGS_DESCRIPTION.English },
  { command: "referral", description: BOT_COMMAND_REFERRAL_DESCRIPTION.English },
];
