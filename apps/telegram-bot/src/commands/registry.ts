import { startCommand } from "./start.js";
import { walletCommand } from "./wallet.js";
import type { CommandHandler } from "./types.js";

/**
 * Single source of truth for command dispatch. New commands land here and
 * keep webhook.ts free of inline handler logic — matches the per-command
 * file layout in apps/telegram-bot/AGENTS.md.
 */
export const commandRegistry: Record<string, CommandHandler> = {
  start: startCommand,
  wallet: walletCommand,
};
