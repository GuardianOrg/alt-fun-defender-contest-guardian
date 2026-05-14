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

interface BenignEditError {
  error_code?: number;
  description?: string;
  message?: string;
}

const isBenignEditError = (err: unknown): boolean => {
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
