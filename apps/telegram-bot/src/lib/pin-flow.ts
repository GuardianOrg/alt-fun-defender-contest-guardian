import type { Conversation } from "@grammyjs/conversations";

import type { AppContext } from "../bot.js";
import { wrapWithCtxPhrase as wrap } from "./anti-phishing.js";
import {
  haltAndForward,
  isOtherSlashCommand,
} from "./conversation-commands.js";
import { backHomeMarkup } from "./nav.js";
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
 * Ask + confirm a new 6-digit PIN. Returns the validated PIN string
 * on success. Each PIN message the user sends is swept out of chat
 * history immediately; bot prompts are tracked on the workflow stack
 * so the conversation can sweep them on exit.
 */
export const askNewPin = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  chatId: number,
  prompt: string,
): Promise<string> => {
  const askMsg = await ctx.reply(wrap(ctx, prompt), {
    reply_markup: backHomeMarkup(),
  });
  await trackWorkflowMessage(conversation, askMsg.message_id);

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
        wrap(ctx, "PIN must be exactly 6 digits. Send again."),
        { reply_markup: backHomeMarkup() },
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    candidate = text;
  }

  const confirmAsk = await ctx.reply(
    wrap(ctx, "Confirm — send the same 6 digits again."),
    { reply_markup: backHomeMarkup() },
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
        wrap(ctx, "PINs do not match. Send the confirmation PIN again."),
        { reply_markup: backHomeMarkup() },
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
): Promise<boolean> => {
  const askMsg = await ctx.reply(
    wrap(
      ctx,
      `Send your current 6-digit PIN to authorise ${actionLabel}.`,
    ),
    { reply_markup: backHomeMarkup() },
  );
  await trackWorkflowMessage(conversation, askMsg.message_id);
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
        wrap(
          ctx,
          `Too many wrong PIN attempts — locked for ~${mins} min. ${actionLabel} cancelled.`,
        ),
      );
      return false;
    }
    if (result.reason === "unset") {
      await ctx.reply(
        wrap(ctx, "No PIN on file — re-run /wallet to set one."),
      );
      return false;
    }
    const retry = await ctx.reply(
      wrap(
        ctx,
        `Wrong PIN. ${result.attemptsRemaining} attempts remaining. Try again.`,
      ),
      { reply_markup: backHomeMarkup() },
    );
    await trackWorkflowMessage(conversation, retry.message_id);
  }
};

export const sweepConversation = sweepWorkflow;
