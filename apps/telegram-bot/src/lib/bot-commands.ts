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
export interface BotCommandSpec {
  command: string;
  description: string;
}

export const BOT_COMMANDS: readonly BotCommandSpec[] = [
  { command: "start", description: "Open the main menu and create or import a wallet" },
  { command: "buy", description: "Buy a token by contract address" },
  { command: "sell", description: "Sell a token from your positions" },
  { command: "positions", description: "Show open and realised positions" },
  { command: "wallet", description: "Manage wallets — create, import, switch, export" },
  { command: "referral", description: "Your referral link and earned rewards" },
];
