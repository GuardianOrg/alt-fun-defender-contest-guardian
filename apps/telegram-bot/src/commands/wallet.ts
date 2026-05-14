import {
  type Conversation,
  createConversation,
} from "@grammyjs/conversations";
import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import {
  WALLET_CALLBACK,
  buildWalletMainKeyboard,
  buildWalletSwitchKeyboard,
} from "../keyboards/wallet-actions.js";
import { wrapWithCtxPhrase as wrap } from "../lib/anti-phishing.js";
import {
  haltAndForward,
  isOtherSlashCommand,
  tryAddressBuyIntercept,
} from "../lib/conversation-commands.js";
import { PinManager } from "../lib/pin.js";
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
  pushNavSnapshot,
  snapshotFromCallback,
} from "../lib/nav.js";
import {
  sweepWorkflow,
  trackWorkflowMessage,
} from "../lib/workflow-stack-conversation.js";

const NO_USER_REPLY =
  "Wallets require a personal Telegram account — this message has no user attached (channel post or anonymous admin).";

const NON_PRIVATE_CHAT_REPLY =
  "Wallet flows are private-DM only — wallet labels and addresses must not surface in groups. Open a direct chat with the bot to manage wallets.";

const RENAME_MAX_LEN = 32;

/**
 * Plaintext-key reveal lives in the chat for 30 seconds before the
 * bot deletes it. The 48-hour `deleteMessage` window is plenty of
 * headroom (see AGENTS.md "Telegram nuance"); we use 30s for the
 * security tradeoff, not the API limit. Users impatient with the
 * wait have a "Delete now" button.
 */
const EXPORT_REVEAL_AUTO_DELETE_MS = 30_000;

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
    text: "Wallet actions are private-DM only.",
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

const renderMainText = (
  wallets: StoredWallet[],
  active: StoredWallet | null,
): string => {
  if (wallets.length === 0) {
    // "Import from Web App" stays first-class per AGENTS.md "Key
    // Constraints" so users who already have a Privy wallet see the
    // bridge path. Both Create and Import are now wired.
    return [
      "No wallets yet.",
      "",
      "• Create — generate a new bot-managed wallet to start trading",
      "• Import — paste an existing private key (including a Privy key exported from the Web App)",
    ].join("\n");
  }
  const lines = [`Wallets (${wallets.length}/${MAX_WALLETS_PER_USER})`, ""];
  for (const w of wallets) {
    const marker = w.id === active?.id ? "*" : " ";
    lines.push(
      `${marker} ${w.label ?? "(unlabeled)"} — ${truncateAddress(w.address)}`,
    );
  }
  if (active) {
    lines.push("", "* = active wallet (used for buy / sell / withdraw)");
  }
  return lines.join("\n");
};

const buildManager = (env: AppContext["env"]): WalletManager =>
  new WalletManager(env.WALLET_KV, env.MASTER_KEY);

const buildPinManager = (env: AppContext["env"]): PinManager =>
  new PinManager(env.WALLET_KV, { saltRounds: env.PIN_SALT_ROUNDS });

const renderMainState = async (
  wm: WalletManager,
  userId: number,
): Promise<{
  text: string;
  reply_markup: {
    inline_keyboard: ReturnType<typeof buildWalletMainKeyboard>;
  };
}> => {
  const wallets = await wm.listWallets(userId);
  const active = await wm.getActive(userId);
  return {
    text: renderMainText(wallets, active),
    reply_markup: {
      inline_keyboard: buildWalletMainKeyboard(
        wallets.length > 0,
        active !== null,
      ),
    },
  };
};

const editToMain = async (ctx: AppContext): Promise<void> => {
  if (!ctx.from || !ctx.callbackQuery?.message) return;
  const wm = buildManager(ctx.env);
  const state = await renderMainState(wm, ctx.from.id);
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
): Promise<void> => {
  await sweepWorkflow(conversation);
  const promptMsg = await ctx.reply(
    wrap(ctx, "Send the new label for this wallet (max 32 chars)."),
    { reply_markup: backHomeMarkup() },
  );
  await trackWorkflowMessage(conversation, promptMsg.message_id);
  const reply = await conversation.waitFor("message:text");
  const label = reply.message.text.trim();
  if (isOtherSlashCommand(label)) await haltAndForward(conversation);
  if (await tryAddressBuyIntercept(conversation, label)) return;
  await trackWorkflowMessage(conversation, reply.message.message_id);
  if (label === "" || label.length > RENAME_MAX_LEN) {
    await reply.reply(
      wrap(ctx,
        `Label must be 1–${RENAME_MAX_LEN} characters. Rename cancelled.`,
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
        wrap(ctx, "Wallet no longer exists. Rename cancelled."),
      );
      await sweepWorkflow(conversation);
      return;
    }
    throw err;
  }
  const state = await conversation.external((outerCtx) =>
    renderMainState(buildManager(outerCtx.env), fromId),
  );
  await reply.reply(wrap(ctx, state.text), {
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
 * Fire-and-forget 30s auto-delete of the plaintext-key bubble.
 *
 * Cloudflare DOs don't expose `executionCtx.waitUntil` from the
 * `fetch` handler, so the timer is genuinely best-effort: if the DO
 * is evicted before 30s elapse the deletion misses. The reveal
 * message ships with a "Delete now" inline button as the user-side
 * safety net.
 */
const scheduleRevealAutoDelete = (
  ctx: AppContext,
  chatId: number,
  messageId: number,
): void => {
  setTimeout(() => {
    void ctx.api.deleteMessage(chatId, messageId).catch(() => {
      // Already deleted (Delete-now button pressed, or 48h window
      // closed on a wedged DO). Swallow.
    });
  }, EXPORT_REVEAL_AUTO_DELETE_MS);
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
): Promise<boolean> => {
  // Track the bot's prompt messages so a sweep on exit removes them.
  // User-side PIN replies are NOT tracked: `sweepPinMessage` deletes
  // them individually for security (PIN must not survive in chat any
  // longer than necessary) — pushing already-deleted ids would just
  // burn `deleteMessage` calls on the eventual clear.
  const askMsg = await ctx.reply(
    wrap(ctx,
      "No PIN set yet. Send a new 6-digit PIN (digits only) to protect wallet exports, withdrawals, and deletions.",
    ),
    { reply_markup: backHomeMarkup() },
  );
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
        wrap(ctx,
          "PIN must be exactly 6 digits. Send again.",
        ),
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
        wrap(ctx,
          "PINs do not match. Send the confirmation PIN again.",
        ),
        { reply_markup: backHomeMarkup() },
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
    wrap(ctx,
      `PIN set. Send it once more to authorise the ${actionLabel}.`,
    ),
    { reply_markup: backHomeMarkup() },
  );
  await trackWorkflowMessage(conversation, finalAsk.message_id);
  return true;
};

/**
 * PIN verify loop. Bails out on lockout or /cancel; otherwise loops
 * the user back through retries. The PinManager owns the attempt
 * counter and lockout state; we only render its result.
 */
const runPinVerifyFlow = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  userId: number,
  chatId: number,
  pinAlreadySet: boolean,
  actionLabel: string,
  retryHint: string,
): Promise<boolean> => {
  if (pinAlreadySet) {
    const askMsg = await ctx.reply(
      wrap(ctx,
        `Send your 6-digit PIN to authorise the ${actionLabel}.`,
      ),
      { reply_markup: backHomeMarkup() },
    );
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
        wrap(ctx,
          `Too many wrong PIN attempts — locked for ~${mins} min. ${capitalize(actionLabel)} cancelled.`,
        ),
      );
      return false;
    }
    if (result.reason === "unset") {
      // Shouldn't happen — we either just set the PIN above or
      // confirmed `isPinSet` at entry. Surface a clean abort rather
      // than looping forever if the KV state somehow vanished.
      await ctx.reply(
        wrap(ctx, `PIN state lost — re-run ${retryHint}.`),
      );
      return false;
    }
    const retry = await ctx.reply(
      wrap(ctx,
        `Wrong PIN. ${result.attemptsRemaining} attempts remaining. Try again.`,
      ),
      { reply_markup: backHomeMarkup() },
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
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
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

  if (!pinAlreadySet) {
    const setOk = await runPinSetFlow(
      conversation,
      ctx,
      userId,
      chatId,
      "export",
    );
    if (!setOk) {
      await sweepWorkflow(conversation);
      return;
    }
  }

  const verifyOk = await runPinVerifyFlow(
    conversation,
    ctx,
    userId,
    chatId,
    pinAlreadySet,
    "export",
    "/wallet → Export key",
  );
  if (!verifyOk) {
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
      wrap(ctx, "Wallet no longer exists. Export aborted."),
    );
    await sweepWorkflow(conversation);
    return;
  }
  const privateKey = await conversation.external((outside) =>
    buildManager(outside.env).decrypt(walletRecord.encryptedKey, userId),
  );
  const wallet = walletRecord;

  // Sweep prompt history BEFORE rendering the reveal so the PIN-set /
  // PIN-verify ladder gets cleared first, and the reveal lands at the
  // bottom of the chat where the 30s auto-delete + "Delete now" path
  // can manage it independently. The reveal id is intentionally NOT
  // tracked on the workflow stack — auto-delete owns its lifecycle and
  // a future sweep must not prematurely remove a still-pending reveal.
  await sweepWorkflow(conversation);

  const revealBody = [
    "⚠️ Private key — anyone with this controls the wallet. Do NOT share. This message auto-deletes in 30s; tap Delete now to remove it immediately.",
    "",
    `Address: ${wallet.address}`,
    `Private key: ${privateKey}`,
  ].join("\n");

  const revealMessage = await ctx.reply(wrap(ctx, revealBody), {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Delete now",
            callback_data: WALLET_CALLBACK.exportDelete,
          },
        ],
      ],
    },
  });

  await conversation.external((outside) => {
    scheduleRevealAutoDelete(outside, chatId, revealMessage.message_id);
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
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  await sweepWorkflow(conversation);

  const promptMsg = await ctx.reply(
    wrap(ctx,
      [
        "Paste the private key for the wallet you want to import (0x-prefixed, 64 hex chars).",
        "",
        "Your message is deleted from this chat the instant the bot reads it. The bot never stores the plaintext key — only an encrypted copy.",
        "",
        "Tap Home to exit.",
      ].join("\n"),
    ),
    { reply_markup: backHomeMarkup() },
  );
  await trackWorkflowMessage(conversation, promptMsg.message_id);

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
        wrap(ctx,
          "That doesn't look like a private key — expected 0x followed by 64 hex characters. Paste it again.",
        ),
        { reply_markup: backHomeMarkup() },
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
        wrap(ctx,
          "That private key is invalid. Paste it again.",
        ),
        { reply_markup: backHomeMarkup() },
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    if (result.kind === "duplicate") {
      await ctx.reply(
        wrap(ctx,
          "That wallet is already in your list. Import cancelled.",
        ),
      );
      await sweepWorkflow(conversation);
      return;
    }
    if (result.kind === "cap") {
      await ctx.reply(
        wrap(ctx,
          `Wallet cap reached (${MAX_WALLETS_PER_USER}). Delete one first, then try importing again.`,
        ),
      );
      await sweepWorkflow(conversation);
      return;
    }
    const wallet = result.wallet;

    const state = await conversation.external((outside) =>
      renderMainState(buildManager(outside.env), userId),
    );
    await ctx.reply(
      wrap(ctx,
        `Imported ${truncateAddress(wallet.address)}.\n\n${state.text}`,
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
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  await sweepWorkflow(conversation);

  const pinAlreadySet = await conversation.external((outside) =>
    buildPinManager(outside.env).isPinSet(userId),
  );

  if (!pinAlreadySet) {
    const setOk = await runPinSetFlow(
      conversation,
      ctx,
      userId,
      chatId,
      "delete",
    );
    if (!setOk) {
      await sweepWorkflow(conversation);
      return;
    }
  }

  const verifyOk = await runPinVerifyFlow(
    conversation,
    ctx,
    userId,
    chatId,
    pinAlreadySet,
    "delete",
    "/wallet → Delete",
  );
  if (!verifyOk) {
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
      wrap(ctx, "Wallet no longer exists. Delete aborted."),
    );
    await sweepWorkflow(conversation);
    return;
  }

  const confirmPrompt = await ctx.reply(
    wrap(ctx,
      `Final step — this permanently removes ${walletRecord.label ?? "(unlabeled)"} (${truncateAddress(walletRecord.address)}) from KV. Encrypted key cannot be recovered. Type DELETE to confirm or tap Home to exit.`,
    ),
    { reply_markup: backHomeMarkup() },
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
    await ctx.reply(wrap(ctx, "Delete cancelled."));
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
      wrap(ctx, "Wallet no longer exists. Delete aborted."),
    );
    await sweepWorkflow(conversation);
    return;
  }

  const state = await conversation.external((outside) =>
    renderMainState(buildManager(outside.env), userId),
  );
  await ctx.reply(
    wrap(ctx,
      `Deleted ${truncateAddress(walletRecord.address)}.\n\n${state.text}`,
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
    createConversation(renameWalletConversation, "wallet-rename"),
  );
  bot.use(
    createConversation(exportKeyConversation, "wallet-export-key"),
  );
  bot.use(
    createConversation(importWalletConversation, "wallet-import"),
  );
  bot.use(
    createConversation(deleteWalletConversation, "wallet-delete"),
  );

  /**
   * `/wallet` entry point. Sends the main view with the action
   * keyboard. Messages without a `from` (channel posts, anonymous
   * admins) get a clear "wallets require a personal account" reply
   * rather than dispatching into the manager with an unknown userId.
   */
  bot.command("wallet", async (ctx) => {
    if (!ctx.from) {
      await ctx.reply(wrap(ctx, NO_USER_REPLY));
      return;
    }
    // Wallet flows are private-only — group / supergroup / channel
    // contexts would publicly leak wallet labels and addresses, and
    // callback flows would let any group member mutate state. Reject
    // anything that isn't a 1:1 chat before doing any KV reads.
    if (!isPrivateChat(ctx)) {
      await ctx.reply(wrap(ctx, NON_PRIVATE_CHAT_REPLY));
      return;
    }
    const wm = buildManager(ctx.env);
    const state = await renderMainState(wm, ctx.from.id);
    await ctx.reply(wrap(ctx, state.text), {
      reply_markup: state.reply_markup,
    });
  });

  bot.callbackQuery(WALLET_CALLBACK.create, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery({ text: "Missing user." });
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const wm = buildManager(ctx.env);
    try {
      const wallet = await wm.createWallet(ctx.from.id);
      await editToMain(ctx);
      await ctx.answerCallbackQuery({
        text: `Created ${truncateAddress(wallet.address)}`,
      });
    } catch (err) {
      if (err instanceof TooManyWalletsError) {
        await ctx.answerCallbackQuery({
          text: `Wallet cap reached (${MAX_WALLETS_PER_USER}). Delete one first.`,
          show_alert: true,
        });
        return;
      }
      throw err;
    }
  });

  bot.callbackQuery(WALLET_CALLBACK.switchPicker, async (ctx) => {
    if (!ctx.from || !ctx.callbackQuery.message) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const wm = buildManager(ctx.env);
    const wallets = await wm.listWallets(ctx.from.id);
    if (wallets.length === 0) {
      await ctx.answerCallbackQuery({
        text: "No wallets to switch to.",
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
      wrap(ctx, "Pick the wallet to use as active:"),
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
      if (!ctx.from) {
        await ctx.answerCallbackQuery();
        return;
      }
      if (!(await ensurePrivate(ctx))) return;
      const data = ctx.callbackQuery.data ?? "";
      const walletId = data.split(":")[1];
      if (!walletId) {
        await ctx.answerCallbackQuery({ text: "Invalid switch target." });
        return;
      }
      const wm = buildManager(ctx.env);
      try {
        await wm.setActive(ctx.from.id, walletId);
      } catch (err) {
        if (err instanceof WalletNotFoundError) {
          await ctx.answerCallbackQuery({
            text: "Wallet no longer exists.",
            show_alert: true,
          });
          return;
        }
        throw err;
      }
      const wallet = await wm.getWallet(ctx.from.id, walletId);
      await editToMain(ctx);
      await ctx.answerCallbackQuery({
        text: wallet?.label ? `Switched to ${wallet.label}` : "Switched.",
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
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const wm = buildManager(ctx.env);
    const active = await wm.getActive(ctx.from.id);
    if (!active) {
      await ctx.answerCallbackQuery({
        text: "No active wallet to rename.",
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("wallet-rename", active.id);
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
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const wm = buildManager(ctx.env);
    const active = await wm.getActive(ctx.from.id);
    if (!active) {
      await ctx.answerCallbackQuery({
        text: "No active wallet to export.",
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("wallet-export-key", active.id);
  });

  bot.callbackQuery(WALLET_CALLBACK.exportDelete, async (ctx) => {
    if (!ctx.callbackQuery.message) {
      await ctx.answerCallbackQuery();
      return;
    }
    try {
      await ctx.api.deleteMessage(
        ctx.callbackQuery.message.chat.id,
        ctx.callbackQuery.message.message_id,
      );
    } catch {
      // Already swept by the 30s auto-delete or out of the 48-hour
      // deleteMessage window. The user's intent (no plaintext key in
      // chat) is satisfied either way.
    }
    await ctx.answerCallbackQuery({ text: "Deleted." });
  });

  /**
   * Delete flow. Mirrors Export's "operate on active wallet" v1 shape:
   * a per-wallet picker would let users delete a non-active wallet
   * directly, but the PIN + typed-confirm gate is the security surface
   * worth getting right first. A future PR can generalise to a picker
   * → conversation once delete / withdraw / export share that UX.
   */
  bot.callbackQuery(WALLET_CALLBACK.delete, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const wm = buildManager(ctx.env);
    const active = await wm.getActive(ctx.from.id);
    if (!active) {
      await ctx.answerCallbackQuery({
        text: "No active wallet to delete.",
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("wallet-delete", active.id);
  });

  /**
   * Import entry point. Cap-checks before entering the conversation so
   * a user at MAX_WALLETS_PER_USER sees a clean toast instead of being
   * walked through a prompt that can only fail at the persist step.
   */
  bot.callbackQuery(WALLET_CALLBACK.import, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const wm = buildManager(ctx.env);
    const wallets = await wm.listWallets(ctx.from.id);
    if (wallets.length >= MAX_WALLETS_PER_USER) {
      await ctx.answerCallbackQuery({
        text: `Wallet cap reached (${MAX_WALLETS_PER_USER}). Delete one first.`,
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("wallet-import");
  });

  // WALLET_CALLBACK.withdraw is owned by commands/withdraw.ts and
  // enters the same wizard as the /start → Withdraw button.

  bot.callbackQuery(START_CALLBACK.wallet, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery({ text: "Missing user." });
      return;
    }
    if (!(await ensurePrivate(ctx))) return;
    const wm = buildManager(ctx.env);
    const state = await renderMainState(wm, ctx.from.id);
    await ctx.answerCallbackQuery();
    await ctx.reply(wrap(ctx, state.text), {
      reply_markup: state.reply_markup,
    });
  });
};
