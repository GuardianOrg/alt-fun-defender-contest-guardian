import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import { wrapWithCtxPhrase as wrap } from "../lib/anti-phishing.js";
import { backHomeMarkup } from "../lib/nav.js";
import { WITHDRAW_LOCK_DISABLE_COOLDOWN_MS } from "../lib/security-state.js";

/**
 * The PIN, anti-phishing phrase, and withdrawal-lock controls live on
 * `/wallet` (PIN + lock) and `/settings` (phrase) — see
 * `commands/wallet.ts` and `commands/settings.ts`. `/security` is kept
 * as a thin redirect so a user who types it still gets a clear pointer
 * to the new home rather than a "command not found" error.
 */
const REDIRECT_BODY = [
  "Security",
  "",
  "Security settings now live in two places:",
  "",
  "• /wallet — PIN (set, change, reset) and withdrawal lock",
  "• /settings — anti-phishing phrase",
].join("\n");

const NO_USER_REPLY =
  "Security settings require a personal Telegram account — this message has no user attached (channel post or anonymous admin).";

const NON_PRIVATE_CHAT_REPLY =
  "Security flows are private-DM only — open a direct chat with the bot.";

const isPrivateChat = (ctx: AppContext): boolean =>
  ctx.chat?.type === "private";

const sendRedirect = async (ctx: AppContext): Promise<void> => {
  await ctx.reply(wrap(ctx, REDIRECT_BODY), { reply_markup: backHomeMarkup() });
};

export const registerSecurityCommand = (bot: Bot<AppContext>): void => {
  bot.command("security", async (ctx) => {
    if (!ctx.from) {
      await ctx.reply(wrap(ctx, NO_USER_REPLY));
      return;
    }
    if (!isPrivateChat(ctx)) {
      await ctx.reply(wrap(ctx, NON_PRIVATE_CHAT_REPLY));
      return;
    }
    await sendRedirect(ctx);
  });

  bot.callbackQuery(START_CALLBACK.security, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery({ text: "Missing user." });
      return;
    }
    if (!isPrivateChat(ctx)) {
      await ctx.answerCallbackQuery({
        text: "Security actions are private-DM only.",
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    await sendRedirect(ctx);
  });
};

export const WITHDRAW_LOCK_COOLDOWN_MS = WITHDRAW_LOCK_DISABLE_COOLDOWN_MS;
