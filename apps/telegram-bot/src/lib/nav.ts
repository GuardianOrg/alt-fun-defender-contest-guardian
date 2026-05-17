import type { Bot } from "grammy";
import type { MessageEntity } from "grammy/types";

import type { AppContext } from "../bot.js";
import type {
  InlineCallbackButton,
  InlineKeyboard,
} from "../keyboards/wallet-actions.js";
import { BACK_BUTTON_TEXT, HOME_BUTTON_TEXT } from "./i18n.js";
import { logger } from "./logger.js";
import { removeWorkflowMessage } from "./workflow-stack.js";

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

const BACK_LABEL = BACK_BUTTON_TEXT.English;
const HOME_LABEL = HOME_BUTTON_TEXT.English;

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
  /**
   * Explicit Telegram MessageEntity list. Used when the snapshot is
   * captured off a rendered Telegram message — `msg.text` strips the
   * HTML/Markdown source, so without re-attaching the entities the
   * restored bubble loses formatting (the /start screen's `<code>`
   * wrapper around the wallet address is the regression that drove
   * this — without it, Tap-to-copy stops working after Back). When
   * both `entities` and `parseMode` are set, `entities` wins and
   * `parseMode` is dropped before the API call (Telegram rejects the
   * pair).
   */
  entities?: MessageEntity[];
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
  // Telegram returns formatted message text with the HTML/Markdown
  // source stripped — the formatting lives in `msg.entities`. Capture
  // those so a Back-restore can re-attach them via the `entities`
  // editMessage parameter; otherwise the /start `<code>` wrapper on
  // the wallet address collapses to plain text and tap-to-copy dies.
  const rawEntities = (msg as { entities?: unknown }).entities;
  const entities: MessageEntity[] | undefined = Array.isArray(rawEntities)
    ? (rawEntities as MessageEntity[])
    : undefined;
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
  return { text, entities, keyboard: safeKeyboard };
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
  // Detach the bubble from the workflow stack before returning so a
  // downstream `sweepWorkflow` (every conversation runs one on entry)
  // cannot delete the view the user is about to look at. The bubble
  // might be on the stack because a prior flow (e.g. `/buy` rendered
  // into this bubble as the buy card via `editToSubmenu` + a follow-up
  // `pushWorkflowMessage`) left the id tracked there and the user
  // navigated Back/Home onto the same bubble without ever triggering
  // a post-trade sweep. Without this detach, tapping a start-menu
  // button on that bubble looks like "the prompt vanishes with no
  // replacement" — the edit lands, then the conversation's sweep
  // deletes the bubble before the user types anything.
  const detach = (messageId: number): void => {
    if (!ctx.chat) return;
    removeWorkflowMessage(ctx.session, ctx.chat.id, messageId);
  };
  try {
    await ctx.editMessageText(view.text, {
      parse_mode: view.parseMode,
      reply_markup,
      link_preview_options,
    });
    const editedMessageId = ctx.callbackQuery?.message?.message_id;
    if (editedMessageId !== undefined) detach(editedMessageId);
    return { editedMessageId };
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
  detach(sent.message_id);
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
 * Best-effort `editMessageText` by id. Returns `true` when the target
 * message ends up showing the requested content — either because the
 * edit landed cleanly *or* because Telegram returned "message is not
 * modified" (i.e. the bubble already shows exactly that text, which
 * is the wizard-prompt re-render case). Returns `false` only when the
 * target message is gone / unsendable (and therefore the caller needs
 * to fall back to a fresh reply). Rethrows non-benign errors.
 *
 * The not-modified case must NOT return false: that would push every
 * caller into a duplicate `ctx.reply`, stacking identical wizard
 * prompts in the chat each time the same retry copy is shown (e.g.
 * the user typing two invalid inputs in a row hits the same
 * "Send a positive number" prompt twice). CodeRabbit #1009.
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
    if (isMessageNotModifiedError(err)) return true;
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
 *
 * Also catches the photo-bubble case ("there is no text in the message
 * to edit"): Home / Back can be tapped on a chart card (sendPhoto), and
 * `editMessageText` is structurally invalid against a media bubble —
 * the only honest recovery is delete + fresh reply, identical to the
 * benign-text path.
 */
export const isBenignEditError = (err: unknown): boolean => {
  const e = err as BenignEditError;
  if (e.error_code !== 400) return false;
  const desc = (e.description ?? e.message ?? "").toLowerCase();
  return (
    desc.includes("message to edit not found") ||
    desc.includes("message not found") ||
    desc.includes("message is not modified") ||
    desc.includes("message can't be edited") ||
    desc.includes("there is no text in the message to edit")
  );
};

/**
 * Subset of `isBenignEditError`: matches only the "message is not
 * modified" 400, which Telegram returns when the new text + markup
 * are byte-identical to the existing bubble. Semantically equivalent
 * to a successful edit (the bubble already shows the target content),
 * so `safeEditMessageById` reports it as a successful edit rather
 * than a "must fall back to reply" failure.
 */
const isMessageNotModifiedError = (err: unknown): boolean => {
  const e = err as BenignEditError;
  if (e.error_code !== 400) return false;
  const desc = (e.description ?? e.message ?? "").toLowerCase();
  return desc.includes("message is not modified");
};

/**
 * Build the `editMessageText` / `reply` payload for a NavSnapshot.
 * When `entities` is set we drop `parse_mode` — Telegram rejects both
 * being sent together, and the entities are the higher-fidelity source
 * (they survived a round-trip through the rendered bubble whereas
 * `parseMode` is only ever set on snapshots produced by code that knew
 * the original render path). Without this drop the Back fallback can
 * 400 with "can't parse entities" when the captured text contains
 * characters HTML treats as markup but that aren't in `entities`.
 */
const snapshotEditPayload = (
  snap: NavSnapshot,
): {
  parse_mode?: "HTML" | "MarkdownV2";
  entities?: MessageEntity[];
  reply_markup: { inline_keyboard: InlineKeyboard };
  link_preview_options?: { is_disabled: true };
} => {
  const useEntities = snap.entities !== undefined;
  return {
    parse_mode: useEntities ? undefined : snap.parseMode,
    entities: useEntities ? snap.entities : undefined,
    reply_markup: { inline_keyboard: snap.keyboard },
    link_preview_options: snap.linkPreviewDisabled
      ? { is_disabled: true }
      : undefined,
  };
};

const editMessageToSnapshot = async (
  ctx: AppContext,
  snap: NavSnapshot,
): Promise<boolean> => {
  try {
    await ctx.editMessageText(snap.text, snapshotEditPayload(snap));
    return true;
  } catch (err) {
    // Never throw out of a nav handler — Home / Back are the user's
    // last-resort escape and a thrown error here would propagate to
    // `bot.catch` and leave the tap looking dead from the client. Log
    // non-benign cases for ops visibility and degrade to the delete +
    // reply fallback in `renderHome`, identical to the benign path.
    if (!isBenignEditError(err)) {
      logger.warn("nav: editMessageText failed, falling back to fresh reply", {
        err,
      });
    }
    return false;
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
        // The originating bubble can't be edited (deleted by user,
        // aged out, photo caption from a chart card). Send the
        // snapshot as a fresh reply then delete the source bubble so
        // Back replaces the existing message rather than stacking a
        // duplicate alongside it. Reply-then-delete order so a send
        // failure never leaves the chat blank.
        //
        // The snapshot is already popped off `navStack` at this
        // point. If the fresh reply throws, re-push it so the next
        // Back tap still targets the screen this one was meant to
        // restore — otherwise a transient Telegram 5xx silently
        // collapses one level of Back history.
        try {
          await ctx.reply(snap.text, snapshotEditPayload(snap));
        } catch (err) {
          pushNavSnapshot(ctx.session, snap);
          throw err;
        }
        await deleteCurrentMessage(ctx);
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
  // Try edit-in-place first — the happy path for a text bubble. When
  // the source bubble cannot be edited (photo caption from /track,
  // deleted by user, aged out, or any non-benign Telegram 400) the
  // bubble is deleted and the start view is sent as a fresh reply,
  // so Home **always** replaces the existing message with the start
  // endpoint rather than leaving a stale source bubble alongside a
  // new one.
  const edited = await editMessageToSnapshot(ctx, snap);
  await ctx.answerCallbackQuery();
  if (edited) return;
  const sent = await ctx.reply(snap.text, snapshotEditPayload(snap));
  // Delete the originating bubble AFTER the fresh start view lands so
  // a transient send failure can never leave the user staring at an
  // empty chat. Best-effort: a benign 400 (already gone, outside the
  // 48h delete window, photo bubble owned by someone else) is fine to
  // swallow — the start view is what the user came for.
  void sent;
  await deleteCurrentMessage(ctx);
};
