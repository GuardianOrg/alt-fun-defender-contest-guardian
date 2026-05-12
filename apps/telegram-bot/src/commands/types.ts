import type { Env } from "../lib/types.js";
import type { TelegramMessage } from "../lib/telegram.js";
import type { ParsedCommand } from "../lib/commands.js";

export interface CommandContext {
  env: Env;
  message: TelegramMessage;
  command: ParsedCommand;
}

export type CommandHandler = (ctx: CommandContext) => Promise<void>;
