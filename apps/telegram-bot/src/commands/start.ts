import { sendMessage } from "../lib/telegram.js";
import type { CommandContext, CommandHandler } from "./types.js";

export const startCommand: CommandHandler = async (
  ctx: CommandContext,
): Promise<void> => {
  const name = ctx.message.from?.first_name ?? "there";
  await sendMessage(
    ctx.env.TELEGRAM_BOT_TOKEN,
    ctx.message.chat.id,
    `Hi ${name}! Alt Fun bot is online. End-to-end check OK.`,
  );
};
