import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import { logger } from "./logger.js";

interface InlineCallbackButton {
  text: string;
  callback_data: string;
}

/**
 * Shared `Close` button. Tapping it deletes the message that owns the
 * keyboard so the in-chat prompt visually disappears. Used on every
 * command panel that surfaces inline buttons EXCEPT `/start` — the
 * start menu is the user's entry point and never deserves a Close.
 *
 * Code kept short (`cls`) so the 64-byte `callback_data` budget stays
 * roomy for handlers that prefix-match on action codes.
 */
export const CLOSE_CALLBACK = "cls";

/** A single-button row to append at the bottom of any keyboard. */
export const closeButtonRow = (): InlineCallbackButton[] => [
  { text: "Close", callback_data: CLOSE_CALLBACK },
];

/**
 * Register the global Close handler. The handler tries `deleteMessage`
 * first (the user-visible promise — the prompt disappears). If
 * Telegram refuses (>48h old, or the user already deleted it locally)
 * we fall back to clearing the inline keyboard so subsequent taps on
 * the same surface are no-ops.
 */
export const registerCloseCallback = (bot: Bot<AppContext>): void => {
  bot.callbackQuery(CLOSE_CALLBACK, async (ctx) => {
    try {
      await ctx.deleteMessage();
    } catch (err) {
      const e = err as {
        error_code?: number;
        description?: string;
        message?: string;
      };
      const desc = (e.description ?? e.message ?? "").toLowerCase();
      const benignDelete =
        e.error_code === 400 &&
        (desc.includes("message to delete not found") ||
          desc.includes("message can't be deleted"));
      if (!benignDelete) {
        logger.warn("close: deleteMessage failed", {
          queryId: ctx.callbackQuery.id,
          description: e.description,
        });
      }
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      } catch {
        // Both delete + edit failing means the message is gone — the
        // user goal (prompt disappears) is satisfied either way.
      }
    }
    await ctx.answerCallbackQuery();
  });
};
