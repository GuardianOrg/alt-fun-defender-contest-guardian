import type { TelegramMessage } from "./telegram.js";

export interface ParsedCommand {
  name: string;
  args: string;
}

/**
 * Telegram bot commands are `/cmd@botname args` in groups, `/cmd args` in DMs.
 * Use the `bot_command` entity at offset 0 — anything else isn't a command.
 */
export const parseCommand = (msg: TelegramMessage): ParsedCommand | null => {
  if (!msg.text || !msg.entities) return null;
  const cmd = msg.entities.find(
    (e) => e.type === "bot_command" && e.offset === 0,
  );
  if (!cmd) return null;
  const raw = msg.text.slice(cmd.offset, cmd.offset + cmd.length);
  const name = raw.split("@")[0]!.slice(1).toLowerCase();
  const args = msg.text.slice(cmd.offset + cmd.length).trim();
  return { name, args };
};
