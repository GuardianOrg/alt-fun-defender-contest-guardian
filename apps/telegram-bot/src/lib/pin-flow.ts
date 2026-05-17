import type { Conversation } from "@grammyjs/conversations";

import type { AppContext } from "../bot.js";
import { wrapWithCtxPhrase as wrap } from "./anti-phishing.js";
import {
  haltAndForward,
  isOtherSlashCommand,
} from "./conversation-commands.js";
import {
  PIN_DO_NOT_MATCH_REPLY,
  PIN_FLOW_CONFIRM_PROMPT,
  PIN_INVALID_FORMAT_REPLY,
  PIN_LOCKED_REPLY,
  PIN_NO_PIN_ON_FILE_REPLY,
  PIN_VERIFY_PROMPT,
  PIN_WRONG_RETRY_REPLY,
  getCtxLanguage,
  t,
} from "./i18n.js";
import { backHomeMarkup, type MessageRef, safeEditMessageById } from "./nav.js";
import { PinManager } from "./pin.js";
import {
  sweepWorkflow,
  trackWorkflowMessage,
} from "./workflow-stack-conversation.js";

/**
 * PIN-flow helpers shared by `/wallet` and the legacy `/security`
 * panel. Centralising them keeps the PIN-set / PIN-verify ladders
 * (and the chat-history hygiene that goes with them) in one place
 * so a future security audit only has one PIN-handling path to
 * review.
 */

export const buildPinManager = (env: AppContext["env"]): PinManager =>
  new PinManager(env.WALLET_KV, { saltRounds: env.PIN_SALT_ROUNDS });

/**
 * Delete a user-sent PIN message from the chat the instant we've
 * read it. The hygiene goal is "no PIN in chat history"; a 400
 * (message already deleted, > 48h window) means the goal is met
 * or unattainable either way — swallow.
 */
export const sweepPinMessage = async (
  ctx: AppContext,
  chatId: number,
  messageId: number,
): Promise<void> => {
  try {
    await ctx.api.deleteMessage(chatId, messageId);
  } catch {
    // Intentional swallow — see comment above.
  }
};

export const formatHoursRemaining = (
  readyAt: number,
  now: number,
): string => {
  const ms = Math.max(0, readyAt - now);
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  return `${hours}h`;
};

/**
 * Edit `origin` in place to the given prompt with the standard
 * back/home keyboard. Returns true when the edit landed (or the
 * bubble already showed exactly that copy), false when the bubble is
 * gone / unsendable and the caller should fall back to a fresh reply.
 * The fallback is shared across every wallet wizard so the
 * "tap-fires-fresh-prompt-below-the-panel" regression doesn't return
 * piecemeal.
 */
const tryEditOriginPrompt = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  origin: MessageRef,
  prompt: string,
): Promise<boolean> =>
  conversation.external((outside) =>
    safeEditMessageById(outside, origin, wrap(ctx, prompt), {
      reply_markup: backHomeMarkup(getCtxLanguage(ctx)),
    }),
  );

/**
 * Ask + confirm a new 6-digit PIN. Returns the validated PIN string
 * on success. Each PIN message the user sends is swept out of chat
 * history immediately; bot prompts are tracked on the workflow stack
 * so the conversation can sweep them on exit.
 *
 * When `origin` is supplied (a /wallet panel bubble the user tapped
 * to enter the wizard), the first prompt edits that bubble in place
 * instead of dropping a fresh message below it. Subsequent retries
 * remain as fresh tracked prompts — they're cleaned up by the
 * conversation's exit sweep alongside the user's deleted PIN replies.
 */
export const askNewPin = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  chatId: number,
  prompt: string,
  origin?: MessageRef,
): Promise<string> => {
  const lang = getCtxLanguage(ctx);
  let editedOrigin = false;
  if (origin) {
    editedOrigin = await tryEditOriginPrompt(conversation, ctx, origin, prompt);
  }
  if (!editedOrigin) {
    const askMsg = await ctx.reply(wrap(ctx, prompt), {
      reply_markup: backHomeMarkup(lang),
    });
    await trackWorkflowMessage(conversation, askMsg.message_id);
  }

  let candidate: string | null = null;
  while (candidate === null) {
    const msg = await conversation.waitFor("message:text");
    const text = msg.message.text.trim();
    await conversation.external((outside) =>
      sweepPinMessage(outside, chatId, msg.message.message_id),
    );
    if (isOtherSlashCommand(text)) await haltAndForward(conversation);
    if (!PinManager.isValidPinFormat(text)) {
      const retry = await ctx.reply(
        wrap(ctx, t(PIN_INVALID_FORMAT_REPLY, lang)),
        { reply_markup: backHomeMarkup(lang) },
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    candidate = text;
  }

  const confirmAsk = await ctx.reply(
    wrap(ctx, t(PIN_FLOW_CONFIRM_PROMPT, lang)),
    { reply_markup: backHomeMarkup(lang) },
  );
  await trackWorkflowMessage(conversation, confirmAsk.message_id);
  while (true) {
    const msg = await conversation.waitFor("message:text");
    const text = msg.message.text.trim();
    await conversation.external((outside) =>
      sweepPinMessage(outside, chatId, msg.message.message_id),
    );
    if (isOtherSlashCommand(text)) await haltAndForward(conversation);
    if (text !== candidate) {
      const retry = await ctx.reply(
        wrap(ctx, t(PIN_DO_NOT_MATCH_REPLY, lang)),
        { reply_markup: backHomeMarkup(lang) },
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    return candidate;
  }
};

/**
 * Verify the user's current PIN. Returns true on success, false on
 * lockout / unset / explicit abort. Mirrors the security-side flow
 * so a change-PIN gate in /wallet behaves identically to the old
 * /security gate.
 */
export const verifyExistingPin = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  userId: number,
  chatId: number,
  actionLabel: string,
  origin?: MessageRef,
): Promise<boolean> => {
  const lang = getCtxLanguage(ctx);
  let editedOrigin = false;
  const prompt = t(PIN_VERIFY_PROMPT, lang)(actionLabel);
  if (origin) {
    editedOrigin = await tryEditOriginPrompt(conversation, ctx, origin, prompt);
  }
  if (!editedOrigin) {
    const askMsg = await ctx.reply(wrap(ctx, prompt), {
      reply_markup: backHomeMarkup(lang),
    });
    await trackWorkflowMessage(conversation, askMsg.message_id);
  }
  while (true) {
    const msg = await conversation.waitFor("message:text");
    const text = msg.message.text.trim();
    await conversation.external((outside) =>
      sweepPinMessage(outside, chatId, msg.message.message_id),
    );
    if (isOtherSlashCommand(text)) await haltAndForward(conversation);
    const result = await conversation.external((outside) =>
      buildPinManager(outside.env).verifyPin(userId, text),
    );
    if (result.ok) return true;
    if (result.reason === "locked" || result.reason === "locked-now") {
      const mins = Math.max(
        1,
        Math.ceil((result.retryAt - Date.now()) / 60_000),
      );
      await ctx.reply(
        wrap(ctx, t(PIN_LOCKED_REPLY, lang)(mins, actionLabel)),
      );
      return false;
    }
    if (result.reason === "unset") {
      await ctx.reply(
        wrap(ctx, t(PIN_NO_PIN_ON_FILE_REPLY, lang)),
      );
      return false;
    }
    const retry = await ctx.reply(
      wrap(ctx, t(PIN_WRONG_RETRY_REPLY, lang)(result.attemptsRemaining)),
      { reply_markup: backHomeMarkup(lang) },
    );
    await trackWorkflowMessage(conversation, retry.message_id);
  }
};

export const sweepConversation = sweepWorkflow;
