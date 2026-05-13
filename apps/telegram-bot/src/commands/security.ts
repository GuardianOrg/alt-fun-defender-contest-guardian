import {
  type Conversation,
  createConversation,
} from "@grammyjs/conversations";
import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import {
  SECURITY_CALLBACK,
  buildSecurityKeyboard,
  type SecurityStatus,
} from "../keyboards/security-actions.js";
import { withAntiPhishing } from "../lib/anti-phishing.js";
import {
  PIN_RESET_DELAY_MS,
  PinManager,
  type ResetStatus,
} from "../lib/pin.js";
import {
  SecurityState,
  WITHDRAW_LOCK_DISABLE_COOLDOWN_MS,
} from "../lib/security-state.js";

const NO_USER_REPLY =
  "Security settings require a personal Telegram account — this message has no user attached (channel post or anonymous admin).";

const NON_PRIVATE_CHAT_REPLY =
  "Security flows are private-DM only — your PIN and lock state must not surface in groups. Open a direct chat with the bot to manage security.";

/**
 * Cap to keep the phrase from blowing past Telegram's 4096-char message
 * budget once it's prefixed to every reply. 64 chars is more than enough
 * for a recognisable token without dominating bot output.
 */
const MAX_PHRASE_LEN = 64;

const isPrivateChat = (ctx: AppContext): boolean =>
  ctx.chat?.type === "private";

const ensurePrivate = async (ctx: AppContext): Promise<boolean> => {
  if (isPrivateChat(ctx)) return true;
  await ctx.answerCallbackQuery({
    text: "Security actions are private-DM only.",
    show_alert: true,
  });
  return false;
};

const isCancel = (text: string): boolean => text.trim() === "/cancel";

const buildPinManager = (env: AppContext["env"]): PinManager =>
  new PinManager(env.WALLET_KV, { saltRounds: env.PIN_SALT_ROUNDS });

const buildSecurityState = (env: AppContext["env"]): SecurityState =>
  new SecurityState(env.WALLET_KV);

/**
 * Mirrors `commands/wallet.ts :: safeEditMessageText`. Telegram returns
 * 400 when the source message has been deleted or is unchanged; both
 * are benign (user moved on / no-op edit) and would otherwise surface
 * as unhandled grammY errors.
 */
const safeEditMessageText = async (
  ctx: AppContext,
  text: string,
  extra: Parameters<AppContext["editMessageText"]>[1] = {},
): Promise<void> => {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    const e = err as {
      error_code?: number;
      description?: string;
      message?: string;
    };
    const desc = (e.description ?? e.message ?? "").toLowerCase();
    const isBenign =
      e.error_code === 400 &&
      (desc.includes("message to edit not found") ||
        desc.includes("message not found") ||
        desc.includes("message is not modified"));
    if (!isBenign) throw err;
  }
};

const sweepPinMessage = async (
  ctx: AppContext,
  chatId: number,
  messageId: number,
): Promise<void> => {
  try {
    await ctx.api.deleteMessage(chatId, messageId);
  } catch {
    // Already deleted or out of 48h window — hygiene goal satisfied.
  }
};

const formatHoursRemaining = (readyAt: number, now: number): string => {
  const ms = Math.max(0, readyAt - now);
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  return `${hours}h`;
};

const renderStatus = (status: SecurityStatus, now: number, resetReadyAt: number | null): string => {
  const lines: string[] = ["Security"];
  lines.push("");
  if (!status.pinSet) {
    lines.push("• PIN: not set");
  } else if (status.pinResetReady) {
    lines.push("• PIN: reset ready — tap [Complete PIN reset] to set a new PIN");
  } else if (status.pinResetPending && resetReadyAt !== null) {
    lines.push(
      `• PIN: reset requested, available in ~${formatHoursRemaining(resetReadyAt, now)} — tap [Cancel PIN reset] if you didn't request this`,
    );
  } else {
    lines.push("• PIN: set");
  }
  lines.push(
    status.antiPhishingPhrase === null
      ? "• Anti-phishing phrase: not set"
      : `• Anti-phishing phrase: "${status.antiPhishingPhrase}"`,
  );
  if (!status.withdrawLockEnabled) {
    lines.push("• Withdrawal lock: off");
  } else if (status.withdrawDisablePending) {
    lines.push(
      "• Withdrawal lock: on (disable pending — 24h cooldown in progress)",
    );
  } else {
    lines.push("• Withdrawal lock: on");
  }
  return lines.join("\n");
};

interface RenderedState {
  text: string;
  reply_markup: { inline_keyboard: ReturnType<typeof buildSecurityKeyboard> };
}

const buildStatus = async (
  ctx: AppContext,
  userId: number,
): Promise<{ status: SecurityStatus; resetReadyAt: number | null }> => {
  const pin = buildPinManager(ctx.env);
  const sec = buildSecurityState(ctx.env);
  const [pinSet, reset, lock] = await Promise.all([
    pin.isPinSet(userId),
    pin.getResetStatus(userId),
    sec.getWithdrawLock(userId),
  ]);
  const status: SecurityStatus = {
    pinSet,
    pinResetPending: reset.kind === "pending",
    pinResetReady: reset.kind === "ready",
    withdrawLockEnabled: lock.enabled,
    withdrawDisablePending: lock.disableRequestedAt !== null,
    antiPhishingPhrase: ctx.session.antiPhishingPhrase ?? null,
  };
  const resetReadyAt =
    reset.kind === "pending" || reset.kind === "ready"
      ? reset.requestedAt + PIN_RESET_DELAY_MS
      : null;
  return { status, resetReadyAt };
};

const renderState = async (
  ctx: AppContext,
  userId: number,
): Promise<RenderedState> => {
  const { status, resetReadyAt } = await buildStatus(ctx, userId);
  return {
    text: renderStatus(status, Date.now(), resetReadyAt),
    reply_markup: { inline_keyboard: buildSecurityKeyboard(status) },
  };
};

const editToMain = async (ctx: AppContext): Promise<void> => {
  if (!ctx.from) return;
  const state = await renderState(ctx, ctx.from.id);
  await safeEditMessageText(ctx, withAntiPhishing(state.text), {
    reply_markup: state.reply_markup,
  });
};

/**
 * Set-or-change PIN conversation. Used both for the first-time set
 * (no PIN yet) and for change-PIN (PIN already set — caller must
 * verify the old PIN first via the change wrapper below).
 */
const askNewPin = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  chatId: number,
  prompt: string,
): Promise<string | null> => {
  await ctx.reply(withAntiPhishing(prompt));
  let candidate: string | null = null;
  while (candidate === null) {
    const msg = await conversation.waitFor("message:text");
    const text = msg.message.text.trim();
    await conversation.external((outside) =>
      sweepPinMessage(outside, chatId, msg.message.message_id),
    );
    if (isCancel(text)) {
      await ctx.reply(withAntiPhishing("Cancelled."));
      return null;
    }
    if (!PinManager.isValidPinFormat(text)) {
      await ctx.reply(
        withAntiPhishing("PIN must be exactly 6 digits. Send again or /cancel."),
      );
      continue;
    }
    candidate = text;
  }

  await ctx.reply(withAntiPhishing("Confirm — send the same 6 digits again."));
  while (true) {
    const msg = await conversation.waitFor("message:text");
    const text = msg.message.text.trim();
    await conversation.external((outside) =>
      sweepPinMessage(outside, chatId, msg.message.message_id),
    );
    if (isCancel(text)) {
      await ctx.reply(withAntiPhishing("Cancelled."));
      return null;
    }
    if (text !== candidate) {
      await ctx.reply(
        withAntiPhishing(
          "PINs do not match. Send the confirmation PIN again or /cancel.",
        ),
      );
      continue;
    }
    return candidate;
  }
};

const verifyExistingPin = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  userId: number,
  chatId: number,
  actionLabel: string,
): Promise<boolean> => {
  await ctx.reply(
    withAntiPhishing(
      `Send your current 6-digit PIN to authorise ${actionLabel}, or /cancel.`,
    ),
  );
  while (true) {
    const msg = await conversation.waitFor("message:text");
    const text = msg.message.text.trim();
    await conversation.external((outside) =>
      sweepPinMessage(outside, chatId, msg.message.message_id),
    );
    if (isCancel(text)) {
      await ctx.reply(withAntiPhishing(`${actionLabel} cancelled.`));
      return false;
    }
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
          `Too many wrong PIN attempts — locked for ~${mins} min. ${actionLabel} cancelled.`,
        ),
      );
      return false;
    }
    if (result.reason === "unset") {
      await ctx.reply(
        withAntiPhishing("No PIN on file — re-run /security to set one."),
      );
      return false;
    }
    await ctx.reply(
      withAntiPhishing(
        `Wrong PIN. ${result.attemptsRemaining} attempts remaining. Try again or /cancel.`,
      ),
    );
  }
};

const setPinConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const newPin = await askNewPin(
    conversation,
    ctx,
    chatId,
    "Send a new 6-digit PIN (digits only) to protect wallet exports, withdrawals, and deletions. Send /cancel to abort.",
  );
  if (newPin === null) return;
  await conversation.external((outside) =>
    buildPinManager(outside.env).setPin(userId, newPin),
  );
  const state = await conversation.external((outside) =>
    renderState(outside, userId),
  );
  await ctx.reply(
    withAntiPhishing(`PIN set.\n\n${state.text}`),
    { reply_markup: state.reply_markup },
  );
};

const changePinConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const ok = await verifyExistingPin(
    conversation,
    ctx,
    userId,
    chatId,
    "PIN change",
  );
  if (!ok) return;
  const newPin = await askNewPin(
    conversation,
    ctx,
    chatId,
    "Send the new 6-digit PIN (digits only), or /cancel.",
  );
  if (newPin === null) return;
  await conversation.external((outside) =>
    buildPinManager(outside.env).setPin(userId, newPin),
  );
  const state = await conversation.external((outside) =>
    renderState(outside, userId),
  );
  await ctx.reply(
    withAntiPhishing(`PIN changed.\n\n${state.text}`),
    { reply_markup: state.reply_markup },
  );
};

const completeResetConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const reset: ResetStatus = await conversation.external((outside) =>
    buildPinManager(outside.env).getResetStatus(userId),
  );
  if (reset.kind === "none") {
    await ctx.reply(withAntiPhishing("No PIN reset in progress."));
    return;
  }
  if (reset.kind === "pending") {
    const hours = formatHoursRemaining(
      reset.requestedAt + PIN_RESET_DELAY_MS,
      Date.now(),
    );
    await ctx.reply(
      withAntiPhishing(
        `PIN reset not yet available — ~${hours} remaining. Tap [Cancel PIN reset] if you didn't request this.`,
      ),
    );
    return;
  }
  const newPin = await askNewPin(
    conversation,
    ctx,
    chatId,
    "Send your new 6-digit PIN (digits only), or /cancel.",
  );
  if (newPin === null) return;
  const result = await conversation.external((outside) =>
    buildPinManager(outside.env).completeReset(userId, newPin),
  );
  if (result.kind === "pending") {
    // Race-condition catch: cooldown re-checked at write time so a
    // stray callback in the last few seconds before `readyAt` can't
    // bypass the gate.
    const hours = formatHoursRemaining(result.readyAt, Date.now());
    await ctx.reply(
      withAntiPhishing(`Reset not yet available — ~${hours} remaining.`),
    );
    return;
  }
  if (result.kind === "not-requested") {
    await ctx.reply(withAntiPhishing("No PIN reset in progress."));
    return;
  }
  const state = await conversation.external((outside) =>
    renderState(outside, userId),
  );
  await ctx.reply(
    withAntiPhishing(`PIN reset complete.\n\n${state.text}`),
    { reply_markup: state.reply_markup },
  );
};

const setPhraseConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  await ctx.reply(
    withAntiPhishing(
      [
        "Send your anti-phishing phrase — it will appear at the top of every bot message so you can recognise messages from this bot vs. a copycat.",
        "",
        `Max ${MAX_PHRASE_LEN} characters. Send /cancel to abort.`,
      ].join("\n"),
    ),
  );
  while (true) {
    const reply = await conversation.waitFor("message:text");
    const text = reply.message.text;
    if (isCancel(text.trim())) {
      await ctx.reply(withAntiPhishing("Cancelled."));
      return;
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      await ctx.reply(
        withAntiPhishing("Phrase cannot be empty. Send again or /cancel."),
      );
      continue;
    }
    if (trimmed.length > MAX_PHRASE_LEN) {
      await ctx.reply(
        withAntiPhishing(
          `Phrase too long (${trimmed.length}/${MAX_PHRASE_LEN}). Send a shorter one or /cancel.`,
        ),
      );
      continue;
    }
    await conversation.external((outside) => {
      outside.session.antiPhishingPhrase = trimmed;
    });
    const state = await conversation.external((outside) =>
      renderState(outside, userId),
    );
    await ctx.reply(
      withAntiPhishing(`Phrase saved.\n\n${state.text}`),
      { reply_markup: state.reply_markup },
    );
    return;
  }
};

export const registerSecurityCommand = (bot: Bot<AppContext>): void => {
  bot.use(createConversation(setPinConversation, "security-set-pin"));
  bot.use(createConversation(changePinConversation, "security-change-pin"));
  bot.use(
    createConversation(completeResetConversation, "security-complete-reset"),
  );
  bot.use(createConversation(setPhraseConversation, "security-set-phrase"));

  bot.command("security", async (ctx) => {
    if (!ctx.from) {
      await ctx.reply(withAntiPhishing(NO_USER_REPLY));
      return;
    }
    if (!isPrivateChat(ctx)) {
      await ctx.reply(withAntiPhishing(NON_PRIVATE_CHAT_REPLY));
      return;
    }
    const state = await renderState(ctx, ctx.from.id);
    await ctx.reply(withAntiPhishing(state.text), {
      reply_markup: state.reply_markup,
    });
  });

  bot.callbackQuery(SECURITY_CALLBACK.setPin, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("security-set-pin");
  });

  bot.callbackQuery(SECURITY_CALLBACK.changePin, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("security-change-pin");
  });

  bot.callbackQuery(SECURITY_CALLBACK.resetPin, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const result = await buildPinManager(ctx.env).requestReset(ctx.from.id);
    await editToMain(ctx);
    if (result.kind === "ready") {
      await ctx.answerCallbackQuery({
        text: "Reset already ready — tap Complete PIN reset.",
        show_alert: true,
      });
      return;
    }
    if (result.kind === "pending") {
      const hours = formatHoursRemaining(result.readyAt, Date.now());
      await ctx.answerCallbackQuery({
        text: `PIN reset requested. Complete in ~${hours}. The old PIN still works during the cooldown.`,
        show_alert: true,
      });
      return;
    }
    // `requestReset` never returns "none" — it always either schedules a
    // new request or surfaces an existing one. Acknowledge defensively so
    // a future signature change doesn't leave the callback hanging.
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(SECURITY_CALLBACK.cancelReset, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    await buildPinManager(ctx.env).cancelReset(ctx.from.id);
    await editToMain(ctx);
    await ctx.answerCallbackQuery({ text: "Reset cancelled." });
  });

  bot.callbackQuery(SECURITY_CALLBACK.completeReset, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("security-complete-reset");
  });

  bot.callbackQuery(SECURITY_CALLBACK.setPhrase, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("security-set-phrase");
  });

  bot.callbackQuery(SECURITY_CALLBACK.clearPhrase, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    ctx.session.antiPhishingPhrase = undefined;
    await editToMain(ctx);
    await ctx.answerCallbackQuery({ text: "Phrase cleared." });
  });

  bot.callbackQuery(SECURITY_CALLBACK.enableLock, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    await buildSecurityState(ctx.env).enableWithdrawLock(ctx.from.id);
    await editToMain(ctx);
    await ctx.answerCallbackQuery({ text: "Withdrawal lock enabled." });
  });

  bot.callbackQuery(SECURITY_CALLBACK.disableLock, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const result = await buildSecurityState(ctx.env).requestDisableWithdrawLock(
      ctx.from.id,
    );
    await editToMain(ctx);
    if (result.kind === "not-enabled") {
      await ctx.answerCallbackQuery({
        text: "Lock is not enabled.",
        show_alert: true,
      });
      return;
    }
    if (result.kind === "disabled") {
      await ctx.answerCallbackQuery({ text: "Withdrawal lock disabled." });
      return;
    }
    const hours = formatHoursRemaining(result.readyAt, Date.now());
    await ctx.answerCallbackQuery({
      text: `Disable requested — completes in ~${hours}. Tap [Cancel disable] to revoke.`,
      show_alert: true,
    });
  });

  bot.callbackQuery(SECURITY_CALLBACK.cancelDisable, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    await buildSecurityState(ctx.env).cancelDisableWithdrawLock(ctx.from.id);
    await editToMain(ctx);
    await ctx.answerCallbackQuery({ text: "Disable cancelled." });
  });
};

export const WITHDRAW_LOCK_COOLDOWN_MS = WITHDRAW_LOCK_DISABLE_COOLDOWN_MS;
