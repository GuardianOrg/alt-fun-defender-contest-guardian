import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";

export const registerStartCommand = (bot: Bot<AppContext>): void => {
  bot.command("start", async (ctx) => {
    const name = ctx.from?.first_name ?? "there";
    await ctx.reply(`Hi ${name}! Alt Fun bot is online. End-to-end check OK.`);
  });
};
