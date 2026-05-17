import type { Conversation } from "@grammyjs/conversations";

import type { AppContext } from "../bot.js";
import { withAntiPhishing } from "./anti-phishing.js";
import {
  haltAndForward,
  isOtherSlashCommand,
} from "./conversation-commands.js";
import {
  DEFAULT_LANGUAGE,
  type Language,
  PIN_DO_NOT_MATCH_REPLY,
  PIN_FLOW_CONFIRM_PROMPT,
  PIN_INVALID_FORMAT_REPLY,
  PIN_LOCKED_REPLY,
  PIN_NO_PIN_ON_FILE_REPLY,
  PIN_VERIFY_PROMPT,
  PIN_WRONG_RETRY_REPLY,
  t,
} from "./i18n.js";
import { backHomeMarkup, type MessageRef, safeEditMessageById } from "./nav.js";
import { PinManager } from "./pin.js";
import {
  sweepWorkflow,
  trackWorkflowMessage,
} from "./workflow-stack-conversation.js";

/**
 * Read the live session's language + anti-phishing phrase off the
 * outside ctx via `conversation.external`. The replay-time `ctx`
 * passed into conversation bodies has no session backing, so both
 * `getCtxLanguage(ctx)` and `ctxAntiPhishingPhrase(ctx)` silently
 * fall back to English when called from within a conversation —
 * the original i18n + anti-phishing regression behind this file.
 */
export const readConvLocale = async (
  conversation: Conversation<AppContext, AppContext>,
): Promise<{ lang: Language; phrase: string | null }> =>
  conversation.external((outside) => ({
    lang: outside.session?.language ?? DEFAULT_LANGUAGE,
    phrase: outside.session?.antiPhishingPhrase ?? null,
  }));

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
  origin: MessageRef,
  prompt: string,
  lang: Language,
  phrase: string | null,
): Promise<boolean> =>
  // `lang` + `phrase` are threaded in from the outside ctx by the
  // caller. Reading them off the captured replay-time `ctx` here would
  // collapse to English even for users who picked Simplified Chinese
  // and would also drop the user's anti-phishing phrase.
  conversation.external((outside) =>
    safeEditMessageById(
      outside,
      origin,
      withAntiPhishing(prompt, phrase, lang),
      { reply_markup: backHomeMarkup(lang) },
    ),
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
  const { lang, phrase } = await readConvLocale(conversation);
  let editedOrigin = false;
  if (origin) {
    editedOrigin = await tryEditOriginPrompt(
      conversation,
      origin,
      prompt,
      lang,
      phrase,
    );
  }
  if (!editedOrigin) {
    const askMsg = await ctx.reply(withAntiPhishing(prompt, phrase, lang), {
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
        withAntiPhishing(t(PIN_INVALID_FORMAT_REPLY, lang), phrase, lang),
        { reply_markup: backHomeMarkup(lang) },
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    candidate = text;
  }

  const confirmAsk = await ctx.reply(
    withAntiPhishing(t(PIN_FLOW_CONFIRM_PROMPT, lang), phrase, lang),
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
        withAntiPhishing(t(PIN_DO_NOT_MATCH_REPLY, lang), phrase, lang),
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
  const { lang, phrase } = await readConvLocale(conversation);
  let editedOrigin = false;
  const prompt = t(PIN_VERIFY_PROMPT, lang)(actionLabel);
  if (origin) {
    editedOrigin = await tryEditOriginPrompt(
      conversation,
      origin,
      prompt,
      lang,
      phrase,
    );
  }
  if (!editedOrigin) {
    const askMsg = await ctx.reply(withAntiPhishing(prompt, phrase, lang), {
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
        withAntiPhishing(
          t(PIN_LOCKED_REPLY, lang)(mins, actionLabel),
          phrase,
          lang,
        ),
      );
      return false;
    }
    if (result.reason === "unset") {
      await ctx.reply(
        withAntiPhishing(t(PIN_NO_PIN_ON_FILE_REPLY, lang), phrase, lang),
      );
      return false;
    }
    const retry = await ctx.reply(
      withAntiPhishing(
        t(PIN_WRONG_RETRY_REPLY, lang)(result.attemptsRemaining),
        phrase,
        lang,
      ),
      { reply_markup: backHomeMarkup(lang) },
    );
    await trackWorkflowMessage(conversation, retry.message_id);
  }
};

export const sweepConversation = sweepWorkflow;
