import {
  type Conversation,
  createConversation,
} from "@grammyjs/conversations";
import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import { buildStartSnapshot } from "./start.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import {
  WALLET_CALLBACK,
  buildWalletMainKeyboard,
  buildWalletSwitchKeyboard,
  type WalletSecurityStatus,
} from "../keyboards/wallet-actions.js";
import {
  wrapWithCtxPhrase as wrap,
  resolveAntiPhishingHeader,
  withAntiPhishing,
} from "../lib/anti-phishing.js";
import { escapeHtml } from "../lib/format.js";
import {
  haltAndForward,
  isOtherSlashCommand,
  tryAddressBuyIntercept,
} from "../lib/conversation-commands.js";
import {
  PIN_AUTHORISE_THE_PROMPT,
  PIN_DO_NOT_MATCH_REPLY,
  PIN_INVALID_FORMAT_REPLY,
  PIN_LOCKED_REPLY,
  PIN_STATE_LOST_REPLY,
  PIN_WRONG_RETRY_REPLY,
  TOAST_DELETE_CANCELLED,
  TOAST_LOCK_DISABLE_REQUESTED,
  TOAST_PIN_RESET_REQUESTED,
  TOAST_RETURNED_HOME,
  TOAST_WALLET_CAP_REACHED,
  TOAST_WALLET_CREATED,
  TOAST_WALLET_SWITCHED,
  TOAST_WALLET_SWITCHED_TO,
  WALLET_CHANGE_PIN_PROMPT,
  WALLET_CONFIRM_PIN_PROMPT,
  WALLET_DELETE_CONFIRM_PROMPT,
  WALLET_DELETE_NO_LONGER_EXISTS_REPLY,
  WALLET_EXPORT_NO_LONGER_EXISTS_REPLY,
  WALLET_EXPORT_PRIVATE_KEY_WARNING_REPLY,
  WALLET_IMPORT_ALREADY_EXISTS_REPLY,
  WALLET_IMPORT_INVALID_KEY_REPLY,
  WALLET_IMPORT_PASTE_KEY_PROMPT,
  WALLET_IMPORT_PRIVATE_KEY_INVALID_REPLY,
  PIN_ACTION_LABEL_DELETE,
  PIN_ACTION_LABEL_EXPORT,
  PIN_ACTION_LABEL_PIN_CHANGE,
  PIN_SET_NOW_SEND_ONCE_MORE_PROMPT,
  TAP_TO_COPY_HINT,
  WALLET_ACTIVE_LEGEND,
  WALLET_DELETED_HEADER,
  WALLET_EMPTY_CREATE_HINT,
  WALLET_EMPTY_IMPORT_HINT,
  WALLET_EXPORT_REVEAL_ADDRESS_LABEL,
  WALLET_EXPORT_REVEAL_PRIVATE_KEY_LABEL,
  WALLET_IMPORT_CAP_REACHED_REPLY,
  WALLET_IMPORTED_HEADER,
  WALLET_LIST_HEADER,
  WALLET_NO_WALLETS_YET_REPLY,
  WALLET_PICK_ACTIVE_PROMPT,
  WALLET_STATUS_PIN_NOT_SET,
  WALLET_STATUS_PIN_RESET_PENDING,
  WALLET_STATUS_PIN_RESET_READY,
  WALLET_STATUS_PIN_SET,
  WALLET_STATUS_WITHDRAW_LOCK_DISABLE_PENDING,
  WALLET_STATUS_WITHDRAW_LOCK_DISABLE_READY,
  WALLET_STATUS_WITHDRAW_LOCK_OFF,
  WALLET_STATUS_WITHDRAW_LOCK_ON,
  WALLET_UNLABELED_PLACEHOLDER,
  WALLET_PIN_CHANGED_HEADER,
  WALLET_PIN_RESET_COMPLETE_HEADER,
  WALLET_PIN_SET_HEADER,
  WALLET_RENAME_LENGTH_INVALID_REPLY,
  WALLET_RENAME_NO_LONGER_EXISTS_REPLY,
  WALLET_RENAME_PROMPT,
  WALLET_RESET_NOT_READY_REPLY,
  WALLET_RESET_NOT_READY_WITH_CANCEL_HINT_REPLY,
  WALLET_RESET_PIN_PROMPT,
  WALLET_SET_NEW_PIN_PROMPT,
  WALLET_SET_PIN_PROMPT,
  WALLET_UNLABELED,
  TOAST_DISABLE_CANCELLED,
  TOAST_NO_PIN_RESET_IN_PROGRESS,
  TOAST_INVALID_SWITCH_TARGET,
  TOAST_LOCK_NOT_ENABLED,
  TOAST_MISSING_USER,
  TOAST_NO_ACTIVE_WALLET_TO_DELETE,
  TOAST_NO_ACTIVE_WALLET_TO_EXPORT,
  TOAST_NO_ACTIVE_WALLET_TO_RENAME,
  TOAST_NO_WALLETS_TO_SWITCH,
  TOAST_PIN_ALREADY_SET,
  TOAST_RESET_ALREADY_READY,
  TOAST_RESET_CANCELLED,
  TOAST_WALLET_NO_LONGER_EXISTS,
  TOAST_WITHDRAWAL_LOCK_DISABLED,
  TOAST_WITHDRAWAL_LOCK_ENABLED,
  WALLET_EXPORT_DONE_BUTTON,
  WALLET_NO_USER_REPLY,
  WALLET_NON_PRIVATE_CHAT_REPLY,
  WALLET_PRIVATE_DM_ONLY_REPLY,
  DEFAULT_LANGUAGE,
  type Language,
  getCtxLanguage,
  t,
} from "../lib/i18n.js";
import { PIN_RESET_DELAY_MS, PinManager, type ResetStatus } from "../lib/pin.js";
import {
  askNewPin,
  formatHoursRemaining,
  verifyExistingPin,
} from "../lib/pin-flow.js";
import {
  SecurityState,
  WITHDRAW_LOCK_DISABLE_COOLDOWN_MS,
} from "../lib/security-state.js";
import {
  DuplicateWalletError,
  InvalidPrivateKeyError,
  MAX_WALLETS_PER_USER,
  TooManyWalletsError,
  WalletManager,
  WalletNotFoundError,
  parsePrivateKey,
  type StoredWallet,
} from "../lib/wallet.js";
import {
  backHomeMarkup,
  editToSubmenu,
  pushNavSnapshot,
  snapshotFromCallback,
  safeEditMessageById,
  type MessageRef,
} from "../lib/nav.js";
import {
  sweepWorkflow,
  trackWorkflowMessage,
} from "../lib/workflow-stack-conversation.js";

const ctxLang = (ctx: AppContext): Language => getCtxLanguage(ctx);

const convLang = async (
  conversation: Conversation<AppContext, AppContext>,
): Promise<Language> =>
  conversation.external((outside) =>
    outside.session?.language ?? DEFAULT_LANGUAGE,
  );

/**
 * Read the user's anti-phishing phrase off the live outside session.
 * Like `convLang`, the captured replay-time `ctx` has no `session`, so
 * the only reliable read is through `conversation.external` against the
 * outside ctx. Returns `null` for users who haven't set a phrase —
 * `withAntiPhishing` then falls back to the localised static header.
 */
const convPhrase = async (
  conversation: Conversation<AppContext, AppContext>,
): Promise<string | null> =>
  conversation.external((outside) =>
    outside.session?.antiPhishingPhrase ?? null,
  );

const RENAME_MAX_LEN = 32;

/**
 * Plaintext-key reveal lives in the chat for 30 seconds before the
 * bot edits it back into the /start home view. Editing rather than
 * deleting keeps the bubble in place as a live home affordance so
 * the user is never left in nav-less limbo — pressing Done on the
 * reveal triggers the same edit-to-start path. Falls back to a
 * delete if the start snapshot can't be built (no active wallet),
 * since a stale "Private key:" bubble is the worst outcome.
 */
const EXPORT_REVEAL_AUTO_RETURN_MS = 30_000;

const isPrivateChat = (ctx: AppContext): boolean =>
  ctx.chat?.type === "private";

/**
 * Defense-in-depth: every wallet callback handler funnels through this
 * before reading or mutating KV. The `/wallet` command itself is also
 * private-only, so in practice inline buttons should only ever exist
 * in private chats — but a forwarded message or future code path
 * could still surface a button in a group. Silent toast + return is
 * safer than answering with wallet state.
 */
const ensurePrivate = async (ctx: AppContext): Promise<boolean> => {
  if (isPrivateChat(ctx)) return true;
  await ctx.answerCallbackQuery({
    text: t(WALLET_PRIVATE_DM_ONLY_REPLY, ctxLang(ctx)),
    show_alert: true,
  });
  return false;
};

/**
 * Same benign-400 contract as `commands/positions.ts`. Swallow the
 * two Telegram error_codes (`message to edit not found`,
 * `message is not modified`) that mean "user already moved on" —
 * rethrow anything else so real failures (network, auth, runtime)
 * don't disappear into silent edits. Without this, every stale-button
 * tap after a chat-clear surfaces as an unhandled callback error.
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

const truncateAddress = (addr: string): string =>
  `${addr.slice(0, 6)}…${addr.slice(-4)}`;

/**
 * Edit `origin` to the wizard's first prompt and return true on
 * success, false when the bubble is unsendable so the caller can fall
 * back to a fresh `ctx.reply` + workflow-stack tracking. Keeps every
 * /wallet conversation entry on the same "edit panel in place, never
 * drop a fresh prompt below it" path the buy / track / withdraw
 * wizards already use.
 */
const tryEditOriginToPrompt = async (
  conversation: Conversation<AppContext, AppContext>,
  origin: MessageRef,
  text: string,
  lang: Language,
  phrase: string | null,
): Promise<boolean> =>
  // Inside conversation replay the captured `ctx` has no session, so
  // both the anti-phishing phrase and the language must come from the
  // outside ctx (threaded in by the caller via `convLang` / `convPhrase`)
  // — using `getCtxLanguage(ctx)` here silently rendered the [← Back]
  // and [🏠 Home] buttons in English even for users on Simplified
  // Chinese, and dropped the user-set anti-phishing phrase back to the
  // English static fallback.
  conversation.external((outside) =>
    safeEditMessageById(
      outside,
      origin,
      withAntiPhishing(text, phrase, lang),
      { reply_markup: backHomeMarkup(lang) },
    ),
  );

/**
 * PIN + withdrawal-lock status lines live on the `/wallet` panel
 * after the wallet list — the same surface that hosts the PIN and
 * lock action buttons. The text is the same shape the legacy
 * `/security` panel used; we just moved its home.
 */
const renderSecurityStatusLines = (
  security: WalletSecurityStatus,
  now: number,
  pinResetReadyAt: number | null,
  lang: Language,
): string[] => {
  const lines: string[] = [];
  if (!security.pinSet) {
    lines.push(t(WALLET_STATUS_PIN_NOT_SET, lang));
  } else if (security.pinResetReady) {
    lines.push(t(WALLET_STATUS_PIN_RESET_READY, lang));
  } else if (security.pinResetPending && pinResetReadyAt !== null) {
    lines.push(
      t(WALLET_STATUS_PIN_RESET_PENDING, lang)(
        formatHoursRemaining(pinResetReadyAt, now),
      ),
    );
  } else {
    lines.push(t(WALLET_STATUS_PIN_SET, lang));
  }
  if (!security.withdrawLockEnabled) {
    lines.push(t(WALLET_STATUS_WITHDRAW_LOCK_OFF, lang));
  } else if (security.withdrawDisableReady) {
    lines.push(t(WALLET_STATUS_WITHDRAW_LOCK_DISABLE_READY, lang));
  } else if (security.withdrawDisablePending) {
    lines.push(t(WALLET_STATUS_WITHDRAW_LOCK_DISABLE_PENDING, lang));
  } else {
    lines.push(t(WALLET_STATUS_WITHDRAW_LOCK_ON, lang));
  }
  return lines;
};

const renderMainText = (
  wallets: StoredWallet[],
  active: StoredWallet | null,
  security: WalletSecurityStatus,
  now: number,
  pinResetReadyAt: number | null,
  lang: Language,
): string => {
  const statusLines = renderSecurityStatusLines(
    security,
    now,
    pinResetReadyAt,
    lang,
  );
  if (wallets.length === 0) {
    // "Import from Web App" stays first-class per AGENTS.md "Key
    // Constraints" so users who already have a Privy wallet see the
    // bridge path. Both Create and Import are now wired.
    return [
      t(WALLET_NO_WALLETS_YET_REPLY, lang),
      "",
      t(WALLET_EMPTY_CREATE_HINT, lang),
      t(WALLET_EMPTY_IMPORT_HINT, lang),
      "",
      ...statusLines,
    ].join("\n");
  }
  const lines = [
    t(WALLET_LIST_HEADER, lang)(wallets.length, MAX_WALLETS_PER_USER),
    "",
  ];
  const unlabeled = t(WALLET_UNLABELED_PLACEHOLDER, lang);
  for (const w of wallets) {
    const marker = w.id === active?.id ? "*" : " ";
    lines.push(
      `${marker} ${w.label ?? unlabeled} — ${truncateAddress(w.address)}`,
    );
  }
  if (active) {
    lines.push("", t(WALLET_ACTIVE_LEGEND, lang));
  }
  lines.push("", ...statusLines);
  return lines.join("\n");
};

const buildManager = (env: AppContext["env"]): WalletManager =>
  new WalletManager(env.WALLET_KV, env.MASTER_KEY);

const buildPinManager = (env: AppContext["env"]): PinManager =>
  new PinManager(env.WALLET_KV, { saltRounds: env.PIN_SALT_ROUNDS });

const buildSecurityState = (env: AppContext["env"]): SecurityState =>
  new SecurityState(env.WALLET_KV);

interface PinResetSummary {
  status: WalletSecurityStatus;
  resetReadyAt: number | null;
}

const readSecurityStatus = async (
  env: AppContext["env"],
  userId: number,
): Promise<PinResetSummary> => {
  const pin = buildPinManager(env);
  const sec = buildSecurityState(env);
  const [pinSet, reset, lock] = await Promise.all([
    pin.isPinSet(userId),
    pin.getResetStatus(userId),
    sec.getWithdrawLock(userId),
  ]);
  // The 24h cooldown is re-checked at write time inside SecurityState,
  // so this view-time split is purely about which button the panel
  // surfaces — the action it triggers stays atomic against the clock.
  const cooldownElapsed =
    lock.disableRequestedAt !== null &&
    Date.now() >= lock.disableRequestedAt + WITHDRAW_LOCK_DISABLE_COOLDOWN_MS;
  const status: WalletSecurityStatus = {
    pinSet,
    pinResetPending: reset.kind === "pending",
    pinResetReady: reset.kind === "ready",
    withdrawLockEnabled: lock.enabled,
    withdrawDisablePending:
      lock.disableRequestedAt !== null && !cooldownElapsed,
    withdrawDisableReady: cooldownElapsed,
  };
  const resetReadyAt =
    reset.kind === "pending" || reset.kind === "ready"
      ? reset.requestedAt + PIN_RESET_DELAY_MS
      : null;
  return { status, resetReadyAt };
};

const renderMainState = async (
  env: AppContext["env"],
  userId: number,
  lang: Language,
): Promise<{
  text: string;
  reply_markup: {
    inline_keyboard: ReturnType<typeof buildWalletMainKeyboard>;
  };
}> => {
  const wm = new WalletManager(env.WALLET_KV, env.MASTER_KEY);
  const wallets = await wm.listWallets(userId);
  const active = await wm.getActive(userId);
  const { status, resetReadyAt } = await readSecurityStatus(env, userId);
  return {
    text: renderMainText(
      wallets,
      active,
      status,
      Date.now(),
      resetReadyAt,
      lang,
    ),
    reply_markup: {
      inline_keyboard: buildWalletMainKeyboard(
        wallets.length > 0,
        active !== null,
        status,
        lang,
      ),
    },
  };
};

const editToMain = async (ctx: AppContext): Promise<void> => {
  if (!ctx.from || !ctx.callbackQuery?.message) return;
  const state = await renderMainState(ctx.env, ctx.from.id, ctxLang(ctx));
  await safeEditMessageText(ctx, wrap(ctx, state.text), {
    reply_markup: state.reply_markup,
  });
};

/**
 * Rename conversation: bot prompts for the new label, user replies
 * with text, we validate + apply + edit the wallet card back to the
 * main view. The conversation pattern is the canonical use case the
 * grammY plugin is built for — single wait point, no side-effected
 * replay surface.
 *
 * `conversation.waitFor("message:text")` blocks until the user sends a
 * plain text message in this chat. The replay engine re-runs the
 * function body up to this point on every incoming update; everything
 * before the wait must be idempotent. We pass `walletId` in as an arg
 * rather than reading it from KV inside the conversation, so the
 * replay doesn't re-fetch.
 */
const renameWalletConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  walletId: string,
  origin?: MessageRef,
): Promise<void> => {
  const lang = await convLang(conversation);
  const phrase = await convPhrase(conversation);
  await sweepWorkflow(conversation);
  let editedOrigin = false;
  if (origin) {
    editedOrigin = await tryEditOriginToPrompt(
      conversation,
      origin,
      t(WALLET_RENAME_PROMPT, lang),
      lang,
      phrase,
    );
  }
  if (!editedOrigin) {
    const promptMsg = await ctx.reply(
      withAntiPhishing(t(WALLET_RENAME_PROMPT, lang), phrase, lang),
      { reply_markup: backHomeMarkup(lang) },
    );
    await trackWorkflowMessage(conversation, promptMsg.message_id);
  }
  const reply = await conversation.waitFor("message:text");
  const label = reply.message.text.trim();
  if (isOtherSlashCommand(label)) await haltAndForward(conversation);
  if (await tryAddressBuyIntercept(conversation, label)) return;
  await trackWorkflowMessage(conversation, reply.message.message_id);
  if (label === "" || label.length > RENAME_MAX_LEN) {
    await reply.reply(
      withAntiPhishing(
        t(WALLET_RENAME_LENGTH_INVALID_REPLY, lang)(RENAME_MAX_LEN),
        phrase,
        lang,
      ),
    );
    await sweepWorkflow(conversation);
    return;
  }
  if (!reply.from) {
    await sweepWorkflow(conversation);
    return;
  }
  // The `ctx` captured in this closure is a *replay-time* context on
  // every resume, not the one that originally entered the conversation
  // — the outer `ctx.env = env` middleware never ran for it. Pull
  // `env` off the live outside context via `conversation.external`,
  // which is exactly what that escape hatch is for. `external` round-
  // trips its return value through JSON, so we build a fresh
  // `WalletManager` *inside* each `external` rather than capturing one
  // — methods don't survive serialization.
  const fromId = reply.from.id;
  try {
    await conversation.external((outerCtx) =>
      buildManager(outerCtx.env).renameWallet(fromId, walletId, label),
    );
  } catch (err) {
    if (err instanceof WalletNotFoundError) {
      await reply.reply(
        withAntiPhishing(
          t(WALLET_RENAME_NO_LONGER_EXISTS_REPLY, lang),
          phrase,
          lang,
        ),
      );
      await sweepWorkflow(conversation);
      return;
    }
    throw err;
  }
  const state = await conversation.external((outerCtx) =>
    renderMainState(outerCtx.env, fromId, lang),
  );
  await reply.reply(withAntiPhishing(state.text, phrase, lang), {
    reply_markup: state.reply_markup,
  });
  await sweepWorkflow(conversation);
};

/**
 * Delete a user-sent PIN message from the chat. The user's chat
 * history would otherwise show their PIN forever; sweeping it the
 * instant we read it is the minimum hygiene the AGENTS.md security
 * model expects. Best-effort — a benign 400 (already gone, outside
 * 48h window) is swallowed so the conversation flow continues.
 */
const sweepPinMessage = async (
  ctx: AppContext,
  chatId: number,
  messageId: number,
): Promise<void> => {
  try {
    await ctx.api.deleteMessage(chatId, messageId);
  } catch {
    // Telegram returns 400 when the message is already deleted or
    // out of window. Either way, our hygiene goal (PIN no longer in
    // chat history) is met or unattainable. Other failures here are
    // not worth aborting the whole flow.
  }
};

/**
 * Edit a reveal bubble back into the /start home view. Used by both
 * the 30s auto-expiry timer and the user-pressed Done button so the
 * private key disappears from chat while the same message remains
 * usable as the home menu — no nav-less limbo, no fresh bubble below.
 *
 * Best-effort: if the snapshot can't be built (no active wallet,
 * degraded RPC) or the bubble is gone (48h window closed) we fall
 * back to deleting the reveal so the plaintext key never lingers.
 */
const editRevealToStart = async (
  ctx: AppContext,
  chatId: number,
  messageId: number,
): Promise<void> => {
  try {
    const snap = await buildStartSnapshot(ctx);
    if (!snap) {
      await ctx.api.deleteMessage(chatId, messageId);
      return;
    }
    await ctx.api.editMessageText(chatId, messageId, snap.text, {
      parse_mode: snap.parseMode,
      reply_markup: { inline_keyboard: snap.keyboard },
      link_preview_options: snap.linkPreviewDisabled
        ? { is_disabled: true }
        : undefined,
    });
  } catch {
    // Edit failed — try a delete as a hygiene fallback. If that also
    // fails the bubble is already gone or out of window, which is
    // exactly the state we wanted anyway.
    try {
      await ctx.api.deleteMessage(chatId, messageId);
    } catch {
      // Swallow — see above.
    }
  }
};

/**
 * Fire-and-forget 30s auto-return of the plaintext-key bubble.
 *
 * Cloudflare DOs don't expose `executionCtx.waitUntil` from the
 * `fetch` handler, so the timer is genuinely best-effort: if the DO
 * is evicted before 30s elapse the rewrite misses. The reveal
 * message ships with a "Done" inline button as the user-side safety
 * net.
 */
const scheduleRevealAutoReturn = (
  ctx: AppContext,
  chatId: number,
  messageId: number,
): void => {
  setTimeout(() => {
    void editRevealToStart(ctx, chatId, messageId);
  }, EXPORT_REVEAL_AUTO_RETURN_MS);
};

/**
 * First-time PIN set wizard: ask, validate format, ask again to
 * confirm, persist. Returns true on success, false if the user typed a
 * slash command to bail out. Each PIN message is swept out of chat
 * history the instant we've read it.
 */
const capitalize = (s: string): string =>
  s.charAt(0).toUpperCase() + s.slice(1);

const runPinSetFlow = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  userId: number,
  chatId: number,
  actionLabel: string,
  origin: MessageRef | undefined,
  lang: Language,
  phrase: string | null,
): Promise<boolean> => {
  // Track the bot's prompt messages so a sweep on exit removes them.
  // User-side PIN replies are NOT tracked: `sweepPinMessage` deletes
  // them individually for security (PIN must not survive in chat any
  // longer than necessary) — pushing already-deleted ids would just
  // burn `deleteMessage` calls on the eventual clear.
  let editedOrigin = false;
  if (origin) {
    editedOrigin = await tryEditOriginToPrompt(
      conversation,
      origin,
      t(WALLET_SET_PIN_PROMPT, lang),
      lang,
      phrase,
    );
  }
  if (!editedOrigin) {
    const askMsg = await ctx.reply(
      withAntiPhishing(t(WALLET_SET_PIN_PROMPT, lang), phrase, lang),
      { reply_markup: backHomeMarkup(lang) },
    );
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
    withAntiPhishing(t(WALLET_CONFIRM_PIN_PROMPT, lang), phrase, lang),
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
    break;
  }

  await conversation.external((outside) =>
    buildPinManager(outside.env).setPin(userId, candidate!),
  );
  const finalAsk = await ctx.reply(
    withAntiPhishing(
      t(PIN_SET_NOW_SEND_ONCE_MORE_PROMPT, lang)(actionLabel),
      phrase,
      lang,
    ),
    { reply_markup: backHomeMarkup(lang) },
  );
  await trackWorkflowMessage(conversation, finalAsk.message_id);
  return true;
};

/**
 * PIN verify loop. Bails out on lockout or /cancel; otherwise loops
 * the user back through retries. The PinManager owns the attempt
 * counter and lockout state; we only render its result.
 */
/**
 * Outcome of `runPinVerifyFlow`. Differentiated so callers can branch
 * on lockout (replace the prompt bubble with the start view, since the
 * user is now wedged for 30 minutes and "Export key" is no longer
 * meaningful) versus a clean abort.
 */
type PinVerifyOutcome = "ok" | "locked" | "unset";

const runPinVerifyFlow = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  userId: number,
  chatId: number,
  pinAlreadySet: boolean,
  actionLabel: string,
  retryHint: string,
  origin: MessageRef | undefined,
  lang: Language,
  phrase: string | null,
): Promise<PinVerifyOutcome> => {
  if (pinAlreadySet) {
    let editedOrigin = false;
    const prompt = t(PIN_AUTHORISE_THE_PROMPT, lang)(actionLabel);
    if (origin) {
      editedOrigin = await tryEditOriginToPrompt(
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
    if (result.ok) return "ok";
    if (result.reason === "locked" || result.reason === "locked-now") {
      const mins = Math.max(
        1,
        Math.ceil((result.retryAt - Date.now()) / 60_000),
      );
      await ctx.reply(
        withAntiPhishing(
          t(PIN_LOCKED_REPLY, lang)(mins, capitalize(actionLabel)),
          phrase,
          lang,
        ),
      );
      return "locked";
    }
    if (result.reason === "unset") {
      // Shouldn't happen — we either just set the PIN above or
      // confirmed `isPinSet` at entry. Surface a clean abort rather
      // than looping forever if the KV state somehow vanished.
      await ctx.reply(
        withAntiPhishing(
          t(PIN_STATE_LOST_REPLY, lang)(retryHint),
          phrase,
          lang,
        ),
      );
      return "unset";
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

/**
 * Export-key conversation. PIN-gates the reveal of a wallet's
 * plaintext private key; first-time users are walked through a PIN
 * set + confirm before the verify step.
 *
 * Replay-safety: every KV read, crypto op, and PIN verify happens
 * inside `conversation.external` so the conversations plugin replays
 * the recorded result instead of re-executing the side effect on
 * every incoming update. The wallet record is fetched at decrypt
 * time rather than at conversation entry — if the user deletes the
 * wallet from another client between entering the PIN and finishing
 * verification, we surface a clean "wallet no longer exists" rather
 * than leaking a stale key.
 */
const exportKeyConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  walletId: string,
  origin?: MessageRef,
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const lang = await convLang(conversation);
  const phrase = await convPhrase(conversation);
  await sweepWorkflow(conversation);

  // Conversation bodies replay across waitFor boundaries; on replay
  // the hydrated `ctx` does NOT carry `env` (that's set by an outer
  // middleware which only runs on the active update, not on replayed
  // entry contexts). Per the conversations plugin docs, `external`'s
  // callback receives the *outside* context object — the one that
  // triggered the resume, complete with middleware mutations. We
  // route every env-dependent read through that escape hatch instead
  // of capturing `ctx.env` from the entry closure.
  const pinAlreadySet = await conversation.external((outside) =>
    buildPinManager(outside.env).isPinSet(userId),
  );

  const exportLabel = t(PIN_ACTION_LABEL_EXPORT, lang);
  if (!pinAlreadySet) {
    const setOk = await runPinSetFlow(
      conversation,
      ctx,
      userId,
      chatId,
      exportLabel,
      origin,
      lang,
      phrase,
    );
    if (!setOk) {
      await sweepWorkflow(conversation);
      return;
    }
  }

  const verifyOutcome = await runPinVerifyFlow(
    conversation,
    ctx,
    userId,
    chatId,
    pinAlreadySet,
    exportLabel,
    "/wallet → Export key",
    pinAlreadySet ? origin : undefined,
    lang,
    phrase,
  );
  if (verifyOutcome !== "ok") {
    // Lockout / state-lost: the export bubble is now dead-ended —
    // the user can't retry for 30 minutes (lockout) or at all
    // (unset). Replace the prompt with the /start view so they have
    // a live home affordance instead of a stale "Enter PIN" bubble
    // sitting above the locked / state-lost notice. Best-effort —
    // if the bubble is gone the sweep below still cleans up.
    if (origin) {
      await editOriginToStart(conversation, origin);
    }
    await sweepWorkflow(conversation);
    return;
  }

  // Re-fetch the wallet now (not at entry) so a concurrent delete is
  // caught here instead of leaking a stale key from a closure.
  const walletRecord = await conversation.external((outside) =>
    buildManager(outside.env).getWallet(userId, walletId),
  );
  if (!walletRecord) {
    await ctx.reply(
      withAntiPhishing(
        t(WALLET_EXPORT_NO_LONGER_EXISTS_REPLY, lang),
        phrase,
        lang,
      ),
    );
    if (origin) {
      await editOriginToStart(conversation, origin);
    }
    await sweepWorkflow(conversation);
    return;
  }
  const privateKey = await conversation.external((outside) =>
    buildManager(outside.env).decrypt(walletRecord.encryptedKey, userId),
  );
  const wallet = walletRecord;

  // Build the reveal as HTML so the address and private key can each
  // sit inside a `<code>` span — Telegram makes those tap-to-copy on
  // mobile + desktop. Plain text leaves the user manually selecting
  // a 64-character hex blob without a copy affordance, which is
  // why this flow exists at all. Translated label prefixes and the
  // warning copy don't contain HTML-special chars, but we escape them
  // defensively in case a future translation introduces one. The
  // anti-phishing phrase is user-set and must be escaped — a phrase
  // containing `<` would otherwise truncate the message at the first
  // unmatched tag with no error surfaced.
  const safeAddress = `<code>${escapeHtml(wallet.address)}</code>`;
  const safeKey = `<code>${escapeHtml(privateKey)}</code>`;
  const safePhraseHeader = escapeHtml(resolveAntiPhishingHeader(phrase, lang));
  const safeWarning = escapeHtml(
    t(WALLET_EXPORT_PRIVATE_KEY_WARNING_REPLY, lang),
  );
  const tapHint = escapeHtml(t(TAP_TO_COPY_HINT, lang));
  const revealBody = [
    safePhraseHeader,
    "",
    safeWarning,
    "",
    t(WALLET_EXPORT_REVEAL_ADDRESS_LABEL, lang)(safeAddress),
    t(WALLET_EXPORT_REVEAL_PRIVATE_KEY_LABEL, lang)(safeKey),
    tapHint,
  ].join("\n");
  const revealMarkup = {
    inline_keyboard: [
      [
        {
          text: t(WALLET_EXPORT_DONE_BUTTON, lang),
          callback_data: WALLET_CALLBACK.exportDelete,
        },
      ],
    ],
  };

  // Edit the existing prompt bubble (the wallet panel the user tapped
  // [Export key] on, transitioned through "Enter PIN" by the verify
  // flow) into the reveal so the chat stays single-bubbled rather
  // than splitting into "prompt deleted + fresh reveal below" — the
  // PIN message itself is already swept by `sweepPinMessage` inside
  // the verify loop. The auto-delete still fires on the reveal's
  // message_id (= origin.messageId here) so the 30 s hygiene window
  // is preserved. Fall back to a fresh reply when origin can't be
  // edited (deleted, aged out) — the user still gets the reveal.
  let revealMessageId: number | undefined;
  let editedOrigin = false;
  if (origin) {
    editedOrigin = await conversation.external((outside) =>
      safeEditMessageById(outside, origin, revealBody, {
        parse_mode: "HTML",
        reply_markup: revealMarkup,
      }),
    );
    if (editedOrigin) revealMessageId = origin.messageId;
  }

  // Sweep retry / confirm / state-set prompts AFTER editing origin so
  // origin (which is not on the workflow stack) is the lone bubble
  // left in the chat for this flow. When the edit fell back to a
  // fresh reply we still sweep first so the prompts disappear before
  // the reveal lands underneath them.
  await sweepWorkflow(conversation);

  if (!editedOrigin) {
    const revealMessage = await ctx.reply(revealBody, {
      parse_mode: "HTML",
      reply_markup: revealMarkup,
    });
    revealMessageId = revealMessage.message_id;
  }

  if (revealMessageId !== undefined) {
    const messageId = revealMessageId;
    await conversation.external((outside) => {
      scheduleRevealAutoReturn(outside, chatId, messageId);
    });
  }
};

/**
 * Replace an arbitrary bubble (the in-flight PIN prompt's bubble) with
 * the /start view. Used when the export flow ends without a reveal —
 * lockout, missing wallet, state-lost — so the user is re-seated on
 * the home menu instead of staring at a stale wizard prompt. Captures
 * the same edit/fallback pattern `lib/nav.ts → renderHome` uses for
 * Home taps, but against an explicit message ref rather than the
 * callback-query's own message.
 */
const editOriginToStart = async (
  conversation: Conversation<AppContext, AppContext>,
  origin: MessageRef,
): Promise<void> => {
  await conversation.external(async (outside) => {
    const snap = await buildStartSnapshot(outside);
    if (!snap) return;
    try {
      await outside.api.editMessageText(
        origin.chatId,
        origin.messageId,
        snap.text,
        {
          parse_mode: snap.parseMode,
          reply_markup: { inline_keyboard: snap.keyboard },
          link_preview_options: snap.linkPreviewDisabled
            ? { is_disabled: true }
            : undefined,
        },
      );
    } catch {
      // The origin bubble may already be gone (user cleared chat,
      // 48h window elapsed). Swallow — the lockout / state-lost
      // reply already informs the user; the start replacement is a
      // best-effort affordance, not load-bearing.
    }
  });
};

type ImportResult =
  | { kind: "ok"; wallet: StoredWallet }
  | { kind: "invalid" }
  | { kind: "duplicate" }
  | { kind: "cap" };

/**
 * Import-wallet conversation. Prompts the user for a raw private key
 * in DM, sweeps the message out of chat history the instant we've
 * read it (same hygiene as the PIN flow), validates the key shape,
 * derives the address, and persists via `WalletManager.importWallet`.
 *
 * Security notes:
 *   - The user's message is deleted before we even attempt to parse —
 *     parse failures would otherwise leak the key in chat for the full
 *     48-hour deleteMessage window if a later step throws.
 *   - The plaintext key is never echoed back; only the derived address
 *     (truncated) appears in the success toast.
 *   - The flow is private-DM only; the entry callback already enforces
 *     `ensurePrivate`, so the conversation body assumes a 1:1 chat.
 */
const importWalletConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  origin?: MessageRef,
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const lang = await convLang(conversation);
  const phrase = await convPhrase(conversation);
  await sweepWorkflow(conversation);

  let editedOrigin = false;
  if (origin) {
    editedOrigin = await tryEditOriginToPrompt(
      conversation,
      origin,
      t(WALLET_IMPORT_PASTE_KEY_PROMPT, lang),
      lang,
      phrase,
    );
  }
  if (!editedOrigin) {
    const promptMsg = await ctx.reply(
      withAntiPhishing(t(WALLET_IMPORT_PASTE_KEY_PROMPT, lang), phrase, lang),
      { reply_markup: backHomeMarkup(lang) },
    );
    await trackWorkflowMessage(conversation, promptMsg.message_id);
  }

  while (true) {
    const reply = await conversation.waitFor("message:text");
    const text = reply.message.text;
    // Sweep before parse / validate so a malformed key cannot linger
    // in the chat while the bot replies with an error. Telegram's 48h
    // deleteMessage window is plenty for a freshly-sent message; the
    // sweep itself is best-effort and tolerates already-gone messages.
    // Do NOT push the key reply id onto the workflow stack — it is
    // already deleted; pushing would only burn a `deleteMessage` call
    // on the next sweep.
    await conversation.external((outside) =>
      sweepPinMessage(outside, chatId, reply.message.message_id),
    );

    if (isOtherSlashCommand(text)) await haltAndForward(conversation);
    if (await tryAddressBuyIntercept(conversation, text)) return;

    const parsed = parsePrivateKey(text);
    if (!parsed) {
      const retry = await ctx.reply(
        withAntiPhishing(
          t(WALLET_IMPORT_INVALID_KEY_REPLY, lang),
          phrase,
          lang,
        ),
        { reply_markup: backHomeMarkup(lang) },
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }

    // Import happens inside `external` so the side effect is recorded
    // once and replayed verbatim. Errors out of `external` round-trip
    // through `structuredClone`, which strips custom Error subclass
    // identity (only built-in error types survive). To keep the
    // user-visible failure modes addressable on this side of the
    // boundary, the inside-callback catches the known failures and
    // returns a tagged discriminated union instead of throwing; only
    // genuinely-unexpected errors propagate as exceptions.
    const result = await conversation.external((outside) =>
      buildManager(outside.env)
        .importWallet(userId, parsed)
        .then(
          (w): ImportResult => ({ kind: "ok", wallet: w }),
          (err: unknown): ImportResult => {
            if (err instanceof InvalidPrivateKeyError)
              return { kind: "invalid" };
            if (err instanceof DuplicateWalletError)
              return { kind: "duplicate" };
            if (err instanceof TooManyWalletsError)
              return { kind: "cap" };
            throw err;
          },
        ),
    );
    if (result.kind === "invalid") {
      const retry = await ctx.reply(
        withAntiPhishing(
          t(WALLET_IMPORT_PRIVATE_KEY_INVALID_REPLY, lang),
          phrase,
          lang,
        ),
        { reply_markup: backHomeMarkup(lang) },
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    if (result.kind === "duplicate") {
      await ctx.reply(
        withAntiPhishing(
          t(WALLET_IMPORT_ALREADY_EXISTS_REPLY, lang),
          phrase,
          lang,
        ),
      );
      await sweepWorkflow(conversation);
      return;
    }
    if (result.kind === "cap") {
      await ctx.reply(
        withAntiPhishing(
          t(WALLET_IMPORT_CAP_REACHED_REPLY, lang)(MAX_WALLETS_PER_USER),
          phrase,
          lang,
        ),
      );
      await sweepWorkflow(conversation);
      return;
    }
    const wallet = result.wallet;

    const state = await conversation.external((outside) =>
      renderMainState(outside.env, userId, lang),
    );
    await ctx.reply(
      withAntiPhishing(
        `${t(WALLET_IMPORTED_HEADER, lang)(truncateAddress(wallet.address))}\n\n${state.text}`,
        phrase,
        lang,
      ),
      { reply_markup: state.reply_markup },
    );
    await sweepWorkflow(conversation);
    return;
  }
};

/**
 * Delete-wallet conversation. PIN-gates removal of a wallet from KV +
 * the user's index, with a typed "DELETE" confirmation after the PIN
 * verifies so a casual mis-tap doesn't nuke a funded wallet. Matches
 * the AGENTS.md `/wallet` row "Delete wallet | … | PIN + confirm".
 *
 * Side effects happen only after both gates pass; `WalletManager.deleteWallet`
 * reassigns the active pointer to `wallets[0]` (or null) so subsequent
 * `/wallet` renders stay consistent without a follow-up Switch.
 */
const deleteWalletConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  walletId: string,
  origin?: MessageRef,
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const lang = await convLang(conversation);
  const phrase = await convPhrase(conversation);
  await sweepWorkflow(conversation);

  const pinAlreadySet = await conversation.external((outside) =>
    buildPinManager(outside.env).isPinSet(userId),
  );

  const deleteLabel = t(PIN_ACTION_LABEL_DELETE, lang);
  if (!pinAlreadySet) {
    const setOk = await runPinSetFlow(
      conversation,
      ctx,
      userId,
      chatId,
      deleteLabel,
      origin,
      lang,
      phrase,
    );
    if (!setOk) {
      await sweepWorkflow(conversation);
      return;
    }
  }

  const verifyOutcome = await runPinVerifyFlow(
    conversation,
    ctx,
    userId,
    chatId,
    pinAlreadySet,
    deleteLabel,
    "/wallet → Delete",
    pinAlreadySet ? origin : undefined,
    lang,
    phrase,
  );
  if (verifyOutcome !== "ok") {
    await sweepWorkflow(conversation);
    return;
  }

  // Re-fetch the wallet after PIN passes so a concurrent delete (from a
  // second client) is caught here rather than blowing up inside
  // `deleteWallet` with a `WalletNotFoundError`.
  const walletRecord = await conversation.external((outside) =>
    buildManager(outside.env).getWallet(userId, walletId),
  );
  if (!walletRecord) {
    await ctx.reply(
      withAntiPhishing(
        t(WALLET_DELETE_NO_LONGER_EXISTS_REPLY, lang),
        phrase,
        lang,
      ),
    );
    await sweepWorkflow(conversation);
    return;
  }

  const confirmPrompt = await ctx.reply(
    withAntiPhishing(
      t(WALLET_DELETE_CONFIRM_PROMPT, lang)(
        walletRecord.label ?? t(WALLET_UNLABELED, lang),
        truncateAddress(walletRecord.address),
      ),
      phrase,
      lang,
    ),
    { reply_markup: backHomeMarkup(lang) },
  );
  await trackWorkflowMessage(conversation, confirmPrompt.message_id);

  const confirmMsg = await conversation.waitFor("message:text");
  const confirmText = confirmMsg.message.text.trim();
  if (isOtherSlashCommand(confirmText)) await haltAndForward(conversation);
  if (await tryAddressBuyIntercept(conversation, confirmText)) return;
  await trackWorkflowMessage(conversation, confirmMsg.message.message_id);
  if (confirmText !== "DELETE") {
    // Anything other than the exact uppercase token aborts — lowercase,
    // typo, fat-fingered emoji. The strictness is the point; this gate
    // exists to require deliberate action.
    await ctx.reply(
      withAntiPhishing(t(TOAST_DELETE_CANCELLED, lang), phrase, lang),
    );
    await sweepWorkflow(conversation);
    return;
  }

  // Errors thrown out of `conversation.external` are structured-cloned
  // by the conversations plugin, which strips custom Error subclass
  // identity — an `instanceof WalletNotFoundError` check on the outside
  // would be dead code. Catch the error inside the callback and return
  // a tagged union instead. Same pattern as `importWalletConversation`.
  const deleteResult = await conversation.external((outside) =>
    buildManager(outside.env)
      .deleteWallet(userId, walletId)
      .then(
        (): { kind: "ok" } | { kind: "missing" } => ({ kind: "ok" }),
        (err: unknown): { kind: "ok" } | { kind: "missing" } => {
          if (err instanceof WalletNotFoundError) return { kind: "missing" };
          throw err;
        },
      ),
  );
  if (deleteResult.kind === "missing") {
    await ctx.reply(
      withAntiPhishing(
        t(WALLET_DELETE_NO_LONGER_EXISTS_REPLY, lang),
        phrase,
        lang,
      ),
    );
    await sweepWorkflow(conversation);
    return;
  }

  const state = await conversation.external((outside) =>
    renderMainState(outside.env, userId, lang),
  );
  await ctx.reply(
    withAntiPhishing(
      `${t(WALLET_DELETED_HEADER, lang)(truncateAddress(walletRecord.address))}\n\n${state.text}`,
      phrase,
      lang,
    ),
    { reply_markup: state.reply_markup },
  );
  await sweepWorkflow(conversation);
};

/**
 * Set-PIN conversation — drives the first-time PIN creation gated on
 * the `/wallet` panel's [Set PIN] button. Persists the new PIN via
 * `PinManager.setPin` and lands the user back on a refreshed wallet
 * panel reflecting `PIN: set`.
 */
const setPinConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  origin?: MessageRef,
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const lang = await convLang(conversation);
  const phrase = await convPhrase(conversation);
  await sweepWorkflow(conversation);
  const newPin = await askNewPin(
    conversation,
    ctx,
    chatId,
    t(WALLET_SET_NEW_PIN_PROMPT, lang),
    origin,
  );
  await conversation.external((outside) =>
    buildPinManager(outside.env).setPin(userId, newPin),
  );
  const state = await conversation.external((outside) =>
    renderMainState(outside.env, userId, lang),
  );
  await ctx.reply(
    withAntiPhishing(
      `${t(WALLET_PIN_SET_HEADER, lang)}\n\n${state.text}`,
      phrase,
      lang,
    ),
    { reply_markup: state.reply_markup },
  );
  await sweepWorkflow(conversation);
};

/**
 * Change-PIN conversation. Verifies the existing PIN first (subject
 * to the 5-attempt lockout in `PinManager.verifyPin`) before
 * prompting for the new PIN — same gate the legacy `/security` panel
 * enforced.
 */
const changePinConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  origin?: MessageRef,
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const lang = await convLang(conversation);
  const phrase = await convPhrase(conversation);
  await sweepWorkflow(conversation);
  const ok = await verifyExistingPin(
    conversation,
    ctx,
    userId,
    chatId,
    t(PIN_ACTION_LABEL_PIN_CHANGE, lang),
    origin,
  );
  if (!ok) {
    await sweepWorkflow(conversation);
    return;
  }
  // Re-pass `origin` so the new-PIN prompt edits the same panel
  // bubble that `verifyExistingPin` already transitioned into the
  // verify prompt — otherwise the prompt drops as a fresh reply
  // below a stale "Send your current 6-digit PIN" bubble.
  const newPin = await askNewPin(
    conversation,
    ctx,
    chatId,
    t(WALLET_CHANGE_PIN_PROMPT, lang),
    origin,
  );
  await conversation.external((outside) =>
    buildPinManager(outside.env).setPin(userId, newPin),
  );
  const state = await conversation.external((outside) =>
    renderMainState(outside.env, userId, lang),
  );
  await ctx.reply(
    withAntiPhishing(
      `${t(WALLET_PIN_CHANGED_HEADER, lang)}\n\n${state.text}`,
      phrase,
      lang,
    ),
    { reply_markup: state.reply_markup },
  );
  await sweepWorkflow(conversation);
};

/**
 * Complete-PIN-reset conversation. Driven by [Complete PIN reset]
 * once the 24h cooldown has elapsed. The cooldown is re-checked at
 * write time inside `PinManager.completeReset` so a stray callback
 * in the last seconds before `readyAt` cannot bypass the gate.
 */
const completeResetConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  origin?: MessageRef,
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const lang = await convLang(conversation);
  const phrase = await convPhrase(conversation);
  await sweepWorkflow(conversation);
  const reset: ResetStatus = await conversation.external((outside) =>
    buildPinManager(outside.env).getResetStatus(userId),
  );
  if (reset.kind === "none") {
    await ctx.reply(
      withAntiPhishing(t(TOAST_NO_PIN_RESET_IN_PROGRESS, lang), phrase, lang),
    );
    await sweepWorkflow(conversation);
    return;
  }
  if (reset.kind === "pending") {
    const hours = formatHoursRemaining(
      reset.requestedAt + PIN_RESET_DELAY_MS,
      Date.now(),
    );
    await ctx.reply(
      withAntiPhishing(
        t(WALLET_RESET_NOT_READY_WITH_CANCEL_HINT_REPLY, lang)(hours),
        phrase,
        lang,
      ),
    );
    await sweepWorkflow(conversation);
    return;
  }
  const newPin = await askNewPin(
    conversation,
    ctx,
    chatId,
    t(WALLET_RESET_PIN_PROMPT, lang),
    origin,
  );
  const result = await conversation.external((outside) =>
    buildPinManager(outside.env).completeReset(userId, newPin),
  );
  if (result.kind === "pending") {
    const hours = formatHoursRemaining(result.readyAt, Date.now());
    await ctx.reply(
      withAntiPhishing(
        t(WALLET_RESET_NOT_READY_REPLY, lang)(hours),
        phrase,
        lang,
      ),
    );
    await sweepWorkflow(conversation);
    return;
  }
  if (result.kind === "not-requested") {
    await ctx.reply(
      withAntiPhishing(t(TOAST_NO_PIN_RESET_IN_PROGRESS, lang), phrase, lang),
    );
    await sweepWorkflow(conversation);
    return;
  }
  const state = await conversation.external((outside) =>
    renderMainState(outside.env, userId, lang),
  );
  await ctx.reply(
    withAntiPhishing(
      `${t(WALLET_PIN_RESET_COMPLETE_HEADER, lang)}\n\n${state.text}`,
      phrase,
      lang,
    ),
    { reply_markup: state.reply_markup },
  );
  await sweepWorkflow(conversation);
};

export const registerWalletCommand = (bot: Bot<AppContext>): void => {
  // Conversation registration — must come before any handler that
  // calls `ctx.conversation.enter("...")`. The name is the public
  // identifier passed to `enter` from callback handlers below.
  bot.use(
    createConversation(renameWalletConversation, {
      id: "wallet-rename",
      parallel: true,
    }),
  );
  bot.use(
    createConversation(exportKeyConversation, {
      id: "wallet-export-key",
      parallel: true,
    }),
  );
  bot.use(
    createConversation(importWalletConversation, {
      id: "wallet-import",
      parallel: true,
    }),
  );
  bot.use(
    createConversation(deleteWalletConversation, {
      id: "wallet-delete",
      parallel: true,
    }),
  );
  bot.use(
    createConversation(setPinConversation, {
      id: "wallet-set-pin",
      parallel: true,
    }),
  );
  bot.use(
    createConversation(changePinConversation, {
      id: "wallet-change-pin",
      parallel: true,
    }),
  );
  bot.use(
    createConversation(completeResetConversation, {
      id: "wallet-complete-reset",
      parallel: true,
    }),
  );

  /**
   * `/wallet` entry point. Sends the main view with the action
   * keyboard. Messages without a `from` (channel posts, anonymous
   * admins) get a clear "wallets require a personal account" reply
   * rather than dispatching into the manager with an unknown userId.
   */
  bot.command("wallet", async (ctx) => {
    const lang = ctxLang(ctx);
    if (!ctx.from) {
      await ctx.reply(wrap(ctx, t(WALLET_NO_USER_REPLY, lang)));
      return;
    }
    // Wallet flows are private-only — group / supergroup / channel
    // contexts would publicly leak wallet labels and addresses, and
    // callback flows would let any group member mutate state. Reject
    // anything that isn't a 1:1 chat before doing any KV reads.
    if (!isPrivateChat(ctx)) {
      await ctx.reply(wrap(ctx, t(WALLET_NON_PRIVATE_CHAT_REPLY, lang)));
      return;
    }
    const state = await renderMainState(ctx.env, ctx.from.id, lang);
    await ctx.reply(wrap(ctx, state.text), {
      reply_markup: state.reply_markup,
    });
  });

  bot.callbackQuery(WALLET_CALLBACK.create, async (ctx) => {
    const lang = ctxLang(ctx);
    if (!ctx.from) {
      await ctx.answerCallbackQuery({ text: t(TOAST_MISSING_USER, lang) });
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const wm = buildManager(ctx.env);
    try {
      const wallet = await wm.createWallet(ctx.from.id);
      await editToMain(ctx);
      await ctx.answerCallbackQuery({
        text: t(TOAST_WALLET_CREATED, lang)(truncateAddress(wallet.address)),
      });
    } catch (err) {
      if (err instanceof TooManyWalletsError) {
        await ctx.answerCallbackQuery({
          text: t(TOAST_WALLET_CAP_REACHED, lang)(MAX_WALLETS_PER_USER),
          show_alert: true,
        });
        return;
      }
      throw err;
    }
  });

  bot.callbackQuery(WALLET_CALLBACK.switchPicker, async (ctx) => {
    const lang = ctxLang(ctx);
    if (!ctx.from || !ctx.callbackQuery.message) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const wm = buildManager(ctx.env);
    const wallets = await wm.listWallets(ctx.from.id);
    if (wallets.length === 0) {
      await ctx.answerCallbackQuery({
        text: t(TOAST_NO_WALLETS_TO_SWITCH, lang),
        show_alert: true,
      });
      return;
    }
    const active = await wm.getActive(ctx.from.id);
    // Push the wallet-main snapshot so the global Back row on the
    // switch picker pops back here. snapshotFromCallback reads the
    // current message before we edit it.
    const parent = snapshotFromCallback(ctx);
    if (parent) pushNavSnapshot(ctx.session, parent);
    await safeEditMessageText(
      ctx,
      wrap(ctx, t(WALLET_PICK_ACTIVE_PROMPT, lang)),
      {
        reply_markup: {
          inline_keyboard: buildWalletSwitchKeyboard(
            wallets,
            active?.id ?? null,
          ),
        },
      },
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(
    new RegExp(`^${WALLET_CALLBACK.switchTo}:`),
    async (ctx) => {
      const lang = ctxLang(ctx);
      if (!ctx.from) {
        await ctx.answerCallbackQuery();
        return;
      }
      if (!(await ensurePrivate(ctx))) return;
      const data = ctx.callbackQuery.data ?? "";
      const walletId = data.split(":")[1];
      if (!walletId) {
        await ctx.answerCallbackQuery({
          text: t(TOAST_INVALID_SWITCH_TARGET, lang),
        });
        return;
      }
      const wm = buildManager(ctx.env);
      try {
        await wm.setActive(ctx.from.id, walletId);
      } catch (err) {
        if (err instanceof WalletNotFoundError) {
          await ctx.answerCallbackQuery({
            text: t(TOAST_WALLET_NO_LONGER_EXISTS, lang),
            show_alert: true,
          });
          return;
        }
        throw err;
      }
      const wallet = await wm.getWallet(ctx.from.id, walletId);
      await editToMain(ctx);
      await ctx.answerCallbackQuery({
        text: wallet?.label
          ? t(TOAST_WALLET_SWITCHED_TO, lang)(wallet.label)
          : t(TOAST_WALLET_SWITCHED, lang),
      });
    },
  );

  /**
   * Rename picker stub: in v1 we enter the conversation for the active
   * wallet. A multi-wallet picker (rename any wallet, not just active)
   * lands once the conversation flow is proven out — keeping the
   * surface small for the first conversations integration.
   */
  bot.callbackQuery(WALLET_CALLBACK.rename, async (ctx) => {
    const lang = ctxLang(ctx);
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const wm = buildManager(ctx.env);
    const active = await wm.getActive(ctx.from.id);
    if (!active) {
      await ctx.answerCallbackQuery({
        text: t(TOAST_NO_ACTIVE_WALLET_TO_RENAME, lang),
        show_alert: true,
      });
      return;
    }
    const origin: MessageRef | undefined = ctx.callbackQuery.message
      ? {
          chatId: ctx.callbackQuery.message.chat.id,
          messageId: ctx.callbackQuery.message.message_id,
        }
      : undefined;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("wallet-rename", active.id, origin);
  });

  /**
   * Export key flow. Mirrors Rename's "operate on active wallet" v1
   * shape: a per-wallet picker would be ergonomic but the PIN gate is
   * the security-critical surface and shipping that with a smaller
   * keyboard footprint is worth the v1 simplicity. A future PR can
   * generalise to a picker → conversation once delete / withdraw /
   * export converge on the same multi-wallet UX.
   */
  bot.callbackQuery(WALLET_CALLBACK.exportKey, async (ctx) => {
    const lang = ctxLang(ctx);
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const wm = buildManager(ctx.env);
    const active = await wm.getActive(ctx.from.id);
    if (!active) {
      await ctx.answerCallbackQuery({
        text: t(TOAST_NO_ACTIVE_WALLET_TO_EXPORT, lang),
        show_alert: true,
      });
      return;
    }
    const origin: MessageRef | undefined = ctx.callbackQuery.message
      ? {
          chatId: ctx.callbackQuery.message.chat.id,
          messageId: ctx.callbackQuery.message.message_id,
        }
      : undefined;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("wallet-export-key", active.id, origin);
  });

  bot.callbackQuery(WALLET_CALLBACK.exportDelete, async (ctx) => {
    if (!ctx.callbackQuery.message) {
      await ctx.answerCallbackQuery();
      return;
    }
    await editRevealToStart(
      ctx,
      ctx.callbackQuery.message.chat.id,
      ctx.callbackQuery.message.message_id,
    );
    await ctx.answerCallbackQuery({
      text: t(TOAST_RETURNED_HOME, ctxLang(ctx)),
    });
  });

  /**
   * Delete flow. Mirrors Export's "operate on active wallet" v1 shape:
   * a per-wallet picker would let users delete a non-active wallet
   * directly, but the PIN + typed-confirm gate is the security surface
   * worth getting right first. A future PR can generalise to a picker
   * → conversation once delete / withdraw / export share that UX.
   */
  bot.callbackQuery(WALLET_CALLBACK.delete, async (ctx) => {
    const lang = ctxLang(ctx);
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const wm = buildManager(ctx.env);
    const active = await wm.getActive(ctx.from.id);
    if (!active) {
      await ctx.answerCallbackQuery({
        text: t(TOAST_NO_ACTIVE_WALLET_TO_DELETE, lang),
        show_alert: true,
      });
      return;
    }
    const origin: MessageRef | undefined = ctx.callbackQuery.message
      ? {
          chatId: ctx.callbackQuery.message.chat.id,
          messageId: ctx.callbackQuery.message.message_id,
        }
      : undefined;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("wallet-delete", active.id, origin);
  });

  /**
   * Import entry point. Cap-checks before entering the conversation so
   * a user at MAX_WALLETS_PER_USER sees a clean toast instead of being
   * walked through a prompt that can only fail at the persist step.
   */
  bot.callbackQuery(WALLET_CALLBACK.import, async (ctx) => {
    const lang = ctxLang(ctx);
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const wm = buildManager(ctx.env);
    const wallets = await wm.listWallets(ctx.from.id);
    if (wallets.length >= MAX_WALLETS_PER_USER) {
      await ctx.answerCallbackQuery({
        text: t(TOAST_WALLET_CAP_REACHED, lang)(MAX_WALLETS_PER_USER),
        show_alert: true,
      });
      return;
    }
    const origin: MessageRef | undefined = ctx.callbackQuery.message
      ? {
          chatId: ctx.callbackQuery.message.chat.id,
          messageId: ctx.callbackQuery.message.message_id,
        }
      : undefined;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("wallet-import", origin);
  });

  // WALLET_CALLBACK.withdraw is owned by commands/withdraw.ts and
  // enters the same wizard as the /start → Withdraw button.

  bot.callbackQuery(WALLET_CALLBACK.pinSet, async (ctx) => {
    const lang = ctxLang(ctx);
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    // Guard against a stale "Set PIN" button on an old /wallet message
    // re-firing after a PIN already exists — without this, tapping the
    // stale button would overwrite the PIN without the current-PIN
    // check or the 24h reset flow.
    if (await buildPinManager(ctx.env).isPinSet(ctx.from.id)) {
      await ctx.answerCallbackQuery({
        text: t(TOAST_PIN_ALREADY_SET, lang),
        show_alert: true,
      });
      return;
    }
    const origin: MessageRef | undefined = ctx.callbackQuery.message
      ? {
          chatId: ctx.callbackQuery.message.chat.id,
          messageId: ctx.callbackQuery.message.message_id,
        }
      : undefined;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("wallet-set-pin", origin);
  });

  bot.callbackQuery(WALLET_CALLBACK.pinChange, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const origin: MessageRef | undefined = ctx.callbackQuery.message
      ? {
          chatId: ctx.callbackQuery.message.chat.id,
          messageId: ctx.callbackQuery.message.message_id,
        }
      : undefined;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("wallet-change-pin", origin);
  });

  bot.callbackQuery(WALLET_CALLBACK.pinReset, async (ctx) => {
    const lang = ctxLang(ctx);
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const result = await buildPinManager(ctx.env).requestReset(ctx.from.id);
    await editToMain(ctx);
    if (result.kind === "ready") {
      await ctx.answerCallbackQuery({
        text: t(TOAST_RESET_ALREADY_READY, lang),
        show_alert: true,
      });
      return;
    }
    if (result.kind === "pending") {
      const hours = formatHoursRemaining(result.readyAt, Date.now());
      await ctx.answerCallbackQuery({
        text: t(TOAST_PIN_RESET_REQUESTED, lang)(hours),
        show_alert: true,
      });
      return;
    }
    // `requestReset` always either schedules a new request or surfaces an
    // existing one. Defensive ack so a future signature change doesn't
    // leave the callback hanging.
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(WALLET_CALLBACK.pinCancelReset, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    await buildPinManager(ctx.env).cancelReset(ctx.from.id);
    await editToMain(ctx);
    await ctx.answerCallbackQuery({
      text: t(TOAST_RESET_CANCELLED, ctxLang(ctx)),
    });
  });

  bot.callbackQuery(WALLET_CALLBACK.pinCompleteReset, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const origin: MessageRef | undefined = ctx.callbackQuery.message
      ? {
          chatId: ctx.callbackQuery.message.chat.id,
          messageId: ctx.callbackQuery.message.message_id,
        }
      : undefined;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("wallet-complete-reset", origin);
  });

  bot.callbackQuery(WALLET_CALLBACK.lockEnable, async (ctx) => {
    const lang = ctxLang(ctx);
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    await buildSecurityState(ctx.env).enableWithdrawLock(ctx.from.id);
    await editToMain(ctx);
    await ctx.answerCallbackQuery({
      text: t(TOAST_WITHDRAWAL_LOCK_ENABLED, lang),
    });
  });

  bot.callbackQuery(WALLET_CALLBACK.lockDisable, async (ctx) => {
    const lang = ctxLang(ctx);
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
        text: t(TOAST_LOCK_NOT_ENABLED, lang),
        show_alert: true,
      });
      return;
    }
    if (result.kind === "disabled") {
      await ctx.answerCallbackQuery({
        text: t(TOAST_WITHDRAWAL_LOCK_DISABLED, lang),
      });
      return;
    }
    const hours = formatHoursRemaining(result.readyAt, Date.now());
    await ctx.answerCallbackQuery({
      text: t(TOAST_LOCK_DISABLE_REQUESTED, lang)(hours),
      show_alert: true,
    });
  });

  bot.callbackQuery(WALLET_CALLBACK.lockCancelDisable, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    await buildSecurityState(ctx.env).cancelDisableWithdrawLock(ctx.from.id);
    await editToMain(ctx);
    await ctx.answerCallbackQuery({
      text: t(TOAST_DISABLE_CANCELLED, ctxLang(ctx)),
    });
  });


  bot.callbackQuery(START_CALLBACK.wallet, async (ctx) => {
    const lang = ctxLang(ctx);
    if (!ctx.from) {
      await ctx.answerCallbackQuery({ text: t(TOAST_MISSING_USER, lang) });
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const state = await renderMainState(ctx.env, ctx.from.id, lang);
    await editToSubmenu(ctx, {
      text: wrap(ctx, state.text),
      inlineKeyboard: state.reply_markup.inline_keyboard,
    });
    await ctx.answerCallbackQuery();
  });
};

export const WITHDRAW_LOCK_COOLDOWN_MS = WITHDRAW_LOCK_DISABLE_COOLDOWN_MS;
