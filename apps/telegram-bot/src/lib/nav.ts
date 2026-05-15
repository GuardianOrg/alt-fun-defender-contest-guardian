import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import type {
  InlineCallbackButton,
  InlineKeyboard,
} from "../keyboards/wallet-actions.js";
import { logger } from "./logger.js";

/**
 * Global navigation primitives. Every system prompt (sub-menu reached
 * from the /start keyboard) renders a final `[← Back] [🏠 Home]` row
 * built by `backHomeRow()`. The /start screen itself never carries
 * this row — it is the home and has nowhere to back out to.
 *
 * Semantics:
 *   - Back (`nav:b`) — replace the current message with the previous
 *     snapshot pushed onto `session.navStack`. With no snapshot to
 *     restore, behaves like Home.
 *   - Home (`nav:h`) — clear the entire nav stack and re-render the
 *     /start view in place of the current message.
 *
 * Both also exit any in-flight conversation so wizards (PIN entry,
 * rewards-wallet change, withdraw flow, etc.) abort cleanly when the
 * user taps Back/Home on the prompt's inline keyboard. This replaces
 * the prior `/cancel` text-command exit path.
 */
export const NAV_CALLBACK = {
  back: "nav:b",
  home: "nav:h",
} as const;

const BACK_LABEL = "← Back";
const HOME_LABEL = "🏠 Home";

/** Single trailing row shared by every system-prompt keyboard. */
export const backHomeRow = (): InlineCallbackButton[] => [
  { text: BACK_LABEL, callback_data: NAV_CALLBACK.back },
  { text: HOME_LABEL, callback_data: NAV_CALLBACK.home },
];

/**
 * Standalone `[← Back] [🏠 Home]` reply markup for wizard prompts that
 * otherwise have no inline keyboard. Without this, copy that instructs
 * the user to "tap Home to exit" leaves them with no Home button on the
 * very message making the offer — the parent menu's keyboard is still
 * tappable but is often scrolled off-screen by the time the user reads
 * the prompt. Use on every `ctx.reply` inside a wizard that prompts for
 * text input.
 */
export const backHomeMarkup = (): { inline_keyboard: InlineKeyboard } => ({
  inline_keyboard: [backHomeRow()],
});

/**
 * `ctx.reply` wrapper for wizard prompts: auto-attaches the
 * `[← Back] [🏠 Home]` row when the caller doesn't supply its own
 * `reply_markup`. Use this for every text-input prompt inside a
 * conversation so the user always has a visible exit on the message
 * they're being asked to respond to — sprinkling `backHomeMarkup()`
 * by hand at each call site is easy to forget.
 *
 * Terminal replies ("Cancelled.", success toasts, error notices that
 * end the flow) should keep calling `ctx.reply` directly — they don't
 * need the nav row and would just clutter the chat.
 */
export const replyWithNav = async (
  ctx: AppContext,
  text: string,
  extra: Parameters<AppContext["reply"]>[1] = {},
): ReturnType<AppContext["reply"]> => {
  return ctx.reply(text, {
    ...extra,
    reply_markup: extra.reply_markup ?? backHomeMarkup(),
  });
};

/** Maximum nav-stack depth held per session. Older snapshots fall off
 * the bottom — Telegram's 64KB session blob and KV's per-key write
 * cost both prefer this stay tight. */
export const MAX_NAV_STACK = 10;

export interface NavSnapshot {
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
  keyboard: InlineKeyboard;
  linkPreviewDisabled?: boolean;
}

export interface NavStackSession {
  navStack?: NavSnapshot[];
}

const ensureStack = (session: NavStackSession): NavSnapshot[] => {
  if (!Array.isArray(session.navStack)) {
    session.navStack = [];
  }
  return session.navStack;
};

/** Push a snapshot describing the screen currently visible so that a
 * later Back tap can restore it. Caller passes the snapshot *of the
 * screen about to be replaced* — i.e. the existing screen state, not
 * the new one being navigated to. */
export const pushNavSnapshot = (
  session: NavStackSession,
  snap: NavSnapshot,
): void => {
  const stack = ensureStack(session);
  stack.push(snap);
  while (stack.length > MAX_NAV_STACK) stack.shift();
};

export const popNavSnapshot = (
  session: NavStackSession,
): NavSnapshot | undefined => {
  const stack = ensureStack(session);
  return stack.pop();
};

export const clearNavStack = (session: NavStackSession): void => {
  session.navStack = [];
};

/**
 * Capture the snapshot of the message that owns the in-flight callback
 * query, suitable for pushing onto the nav stack before the handler
 * edits that message into a new view. Returns `null` when the source
 * message is a photo / non-text payload (chart cards) — those screens
 * cannot be restored via `editMessageText`, so Back from a deeper view
 * just navigates to /start instead.
 */
export const snapshotFromCallback = (ctx: AppContext): NavSnapshot | null => {
  const msg = ctx.callbackQuery?.message;
  if (!msg) return null;
  // grammY surfaces text under `text` and inline keyboard under
  // `reply_markup.inline_keyboard`. Photo/video captions carry text on
  // `caption`, which we deliberately skip — restoring a media message
  // by editing text would orphan the attachment.
  const text = "text" in msg ? msg.text : undefined;
  if (typeof text !== "string") return null;
  const markup = msg.reply_markup;
  const rawKeyboard: unknown = (markup as { inline_keyboard?: unknown })
    ?.inline_keyboard;
  if (!Array.isArray(rawKeyboard)) return null;
  // Strict-shape filter: only retain rows that are arrays of callback
  // or URL buttons (the only shapes our keyboards produce). Anything
  // exotic gets dropped rather than fed back into edit_markup.
  const safeKeyboard: InlineKeyboard = (rawKeyboard as unknown[])
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => {
      const cells: (
        | { text: string; callback_data: string }
        | { text: string; url: string }
      )[] = [];
      for (const raw of row) {
        if (typeof raw !== "object" || raw === null) continue;
        const b = raw as {
          text?: unknown;
          callback_data?: unknown;
          url?: unknown;
        };
        const text = typeof b.text === "string" ? b.text : "";
        if (typeof b.callback_data === "string") {
          cells.push({ text, callback_data: b.callback_data });
        } else if (typeof b.url === "string") {
          cells.push({ text, url: b.url });
        }
      }
      return cells;
    });
  return { text, keyboard: safeKeyboard };
};

/** Callable supplied at registration time so nav handlers can render
 * the /start view without `lib/nav.ts` taking a direct dependency on
 * `commands/start.ts` (which would invert the layering — commands
 * depend on lib, not the other way round). */
export type StartRenderer = (ctx: AppContext) => Promise<NavSnapshot | null>;

/**
 * View payload for `editToSubmenu`. Matches the shape of the snapshots
 * stored in the nav stack, but framed in terms of the
 * `editMessageText` / `ctx.reply` API the caller is targeting (raw
 * `reply_markup` shape rather than the nav-stack's `keyboard` field).
 */
export interface SubmenuView {
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
  inlineKeyboard: InlineKeyboard;
  linkPreviewDisabled?: boolean;
}

/**
 * Standard "start-menu button tap" navigation: edit the current
 * message into a sub-screen and push the previous (start) view onto
 * the nav stack so [← Back] / [🏠 Home] can restore it. Falls back to
 * a fresh `ctx.reply` when the original message can no longer be
 * edited (user cleared the chat, message aged out, photo caption).
 *
 * Every `START_CALLBACK.*` handler that navigates from /start into a
 * sub-screen (wallet, settings, positions, referral, help, …) should
 * go through this helper rather than calling `ctx.reply` directly —
 * `ctx.reply` would leave the stale /start view above the new screen
 * and never pushes onto `navStack`, so Back has nothing to restore.
 *
 * The sub-screen's keyboard must end with `backHomeRow()` (or be a
 * keyboard that already includes it via a builder) — without that row
 * the user has no way to navigate back out, since /start was the
 * entry point.
 */
/**
 * Result of a submenu render. `editedMessageId` is the message the
 * user is now looking at — the original (edited in place) on the
 * happy path, or the freshly-sent reply id when we fell back. Callers
 * that track the rendered message on a workflow stack (e.g. the
 * post-trade sweep) must read this rather than reusing
 * `ctx.callbackQuery.message.message_id`, which still points at the
 * deleted parent in the fallback branch.
 */
export interface SubmenuResult {
  editedMessageId: number | undefined;
}

export const editToSubmenu = async (
  ctx: AppContext,
  view: SubmenuView,
): Promise<SubmenuResult> => {
  const parent = snapshotFromCallback(ctx);
  if (parent) pushNavSnapshot(ctx.session, parent);
  const reply_markup = { inline_keyboard: view.inlineKeyboard };
  const link_preview_options = view.linkPreviewDisabled
    ? ({ is_disabled: true } as const)
    : undefined;
  try {
    await ctx.editMessageText(view.text, {
      parse_mode: view.parseMode,
      reply_markup,
      link_preview_options,
    });
    return { editedMessageId: ctx.callbackQuery?.message?.message_id };
  } catch (err) {
    if (!isBenignEditError(err)) {
      logger.warn("editToSubmenu: editMessageText failed, falling back", {
        err,
      });
    }
  }
  // Edit path failed. Send the sub-screen as a fresh reply FIRST so
  // the user is guaranteed to see the new view, then best-effort
  // delete the stale parent. Doing the delete first risks the
  // "prompt disappears but the new view never appears" race when the
  // delete succeeds but the reply throws (transient Telegram 5xx,
  // network blip) — see issue: /track start-menu button.
  const sent = await ctx.reply(view.text, {
    parse_mode: view.parseMode,
    reply_markup,
    link_preview_options,
  });
  try {
    await ctx.deleteMessage();
  } catch (err) {
    if (!isBenignEditError(err)) {
      logger.debug("editToSubmenu: deleteMessage fallback failed", { err });
    }
  }
  return { editedMessageId: sent.message_id };
};

interface BenignEditError {
  error_code?: number;
  description?: string;
  message?: string;
}

/**
 * Identifies a previously-sent bot message by `(chatId, messageId)` so
 * a later edit can target it without holding the ctx that produced it.
 * Used to thread a callback-captured origin (the start-menu bubble the
 * user tapped) through into a conversation that subsequently edits the
 * same bubble for each step of the wizard.
 */
export interface MessageRef {
  chatId: number;
  messageId: number;
}

/**
 * Best-effort `editMessageText` by id. Returns `true` on a clean edit,
 * `false` when the target is gone / unchanged / unsendable (the same
 * benign 400s `editToSubmenu` swallows), and rethrows anything else.
 * Use from inside a `conversation.external(...)` block when the
 * conversation needs to refresh an origin message without owning the
 * original ctx.
 */
export const safeEditMessageById = async (
  outside: AppContext,
  ref: MessageRef,
  text: string,
  extra: Parameters<AppContext["api"]["editMessageText"]>[3] = {},
): Promise<boolean> => {
  try {
    await outside.api.editMessageText(ref.chatId, ref.messageId, text, extra);
    return true;
  } catch (err) {
    if (isBenignEditError(err)) return false;
    throw err;
  }
};

/**
 * Shared filter for the "edit target is gone / unchanged / unsendable"
 * 400s that Telegram returns when a button-driven edit races a user
 * who moved on (cleared chat, deleted the bot reply, tapped a stale
 * button twice). Every start-menu callback that edits a message in
 * place uses this so the fallback path is identical across commands.
 */
export const isBenignEditError = (err: unknown): boolean => {
  const e = err as BenignEditError;
  if (e.error_code !== 400) return false;
  const desc = (e.description ?? e.message ?? "").toLowerCase();
  return (
    desc.includes("message to edit not found") ||
    desc.includes("message not found") ||
    desc.includes("message is not modified") ||
    desc.includes("message can't be edited")
  );
};

const editMessageToSnapshot = async (
  ctx: AppContext,
  snap: NavSnapshot,
): Promise<boolean> => {
  try {
    await ctx.editMessageText(snap.text, {
      parse_mode: snap.parseMode,
      reply_markup: { inline_keyboard: snap.keyboard },
      link_preview_options: snap.linkPreviewDisabled
        ? { is_disabled: true }
        : undefined,
    });
    return true;
  } catch (err) {
    if (isBenignEditError(err)) return false;
    throw err;
  }
};

const deleteCurrentMessage = async (ctx: AppContext): Promise<void> => {
  try {
    await ctx.deleteMessage();
  } catch (err) {
    if (isBenignEditError(err)) return;
    logger.debug("nav: deleteMessage failed", { err });
  }
};

const exitConversations = async (ctx: AppContext): Promise<void> => {
  // `ctx.conversation.exitAll()` is the documented escape hatch for
  // aborting every in-flight conversation owned by this user (PIN
  // wizard, withdraw wizard, etc.). Swallow failures — even if the
  // exit hook throws, the user-facing nav action must still succeed.
  try {
    await ctx.conversation?.exitAll();
  } catch (err) {
    logger.debug("nav: conversation.exitAll failed", { err });
  }
};

/**
 * Wire the global `nav:b` / `nav:h` handlers. `renderStart` is invoked
 * for Home (and as the Back fallback when the stack is empty) — pass
 * the start-view snapshot builder from `commands/start.ts`.
 */
export const registerNavCallbacks = (
  bot: Bot<AppContext>,
  renderStart: StartRenderer,
): void => {
  bot.callbackQuery(NAV_CALLBACK.back, async (ctx) => {
    await exitConversations(ctx);
    const snap = popNavSnapshot(ctx.session);
    if (snap) {
      const edited = await editMessageToSnapshot(ctx, snap);
      await ctx.answerCallbackQuery();
      if (!edited) {
        // The original message is gone (deleted by user or aged out);
        // surface the snapshot as a fresh reply so the user is not
        // stranded with no UI.
        await ctx.reply(snap.text, {
          parse_mode: snap.parseMode,
          reply_markup: { inline_keyboard: snap.keyboard },
          link_preview_options: snap.linkPreviewDisabled
            ? { is_disabled: true }
            : undefined,
        });
      }
      return;
    }
    // Stack empty — degrade to Home. Drop through.
    await renderHome(ctx, renderStart);
  });

  bot.callbackQuery(NAV_CALLBACK.home, async (ctx) => {
    await exitConversations(ctx);
    await renderHome(ctx, renderStart);
  });
};

/**
 * Install a `/^st:/` callback-query middleware that exits every
 * in-flight conversation before the matching start-menu handler runs.
 * Without this, tapping a `/start` menu button (Positions, Wallet,
 * Settings, …) from an older menu message while a wizard is active —
 * e.g. Buy already entered the buy-lookup conversation that is waiting
 * for a token address — has the callback silently consumed by the
 * conversations plugin (the default `skip` semantics drop the update
 * instead of forwarding it to outer middleware). Mirrors the `nav:b`
 * / `nav:h` escape pattern.
 *
 * MUST be wired BEFORE any `createConversation(...)` middleware so
 * the escape runs ahead of an active conversation's update
 * consumption. Calls `next()` so the actual start-menu handler
 * registered downstream still fires.
 */
export const registerStartMenuConversationEscape = (
  bot: Bot<AppContext>,
): void => {
  bot.callbackQuery(/^st:/, async (ctx, next) => {
    await exitConversations(ctx);
    await next();
  });
};

const renderHome = async (
  ctx: AppContext,
  renderStart: StartRenderer,
): Promise<void> => {
  clearNavStack(ctx.session);
  const snap = await renderStart(ctx);
  if (!snap) {
    // Start rendering failed (no active wallet, RPC degraded). Best we
    // can do is clear the current screen and let the user re-run
    // `/start` from the command menu.
    await deleteCurrentMessage(ctx);
    await ctx.answerCallbackQuery({
      text: "Run /start to return home.",
      show_alert: false,
    });
    return;
  }
  const edited = await editMessageToSnapshot(ctx, snap);
  await ctx.answerCallbackQuery();
  if (!edited) {
    await ctx.reply(snap.text, {
      parse_mode: snap.parseMode,
      reply_markup: { inline_keyboard: snap.keyboard },
      link_preview_options: snap.linkPreviewDisabled
        ? { is_disabled: true }
        : undefined,
    });
  }
};
