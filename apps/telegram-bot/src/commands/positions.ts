import type { Bot } from "grammy";
import type { Address } from "viem";

import type { AppContext } from "../bot.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import {
  ACTION_TOKEN_OUTAGE,
  editToActionCard,
} from "../lib/action-card.js";
import { wrapWithCtxPhrase as wrap } from "../lib/anti-phishing.js";
import { fetchBotPositions, isAddress } from "../lib/api.js";
import {
  OUTAGE_REPLY,
  POSITIONS_INVALID_ADDRESS_REPLY,
  POSITIONS_NO_ACTIVE_WALLET_REPLY,
  TOAST_INVALID_PAGE_REQUEST,
  TOAST_INVALID_REFRESH_REQUEST,
  TOAST_INVALID_TOKEN,
  TOAST_MESSAGE_NO_LONGER_AVAILABLE,
  TOAST_MISSING_USER,
  TOAST_REFRESHED,
  POSITIONS_NON_PRIVATE_CHAT_REPLY,
  POSITIONS_USAGE_REPLY,
  getCtxLanguage,
  t,
} from "../lib/i18n.js";
import {
  POSITIONS_BUY_CALLBACK_CMD,
  POSITIONS_PAGE_CALLBACK_CMD,
  POSITIONS_REFRESH_CALLBACK_CMD,
  POSITIONS_SELL_CALLBACK_CMD,
  buildPositionsPageKeyboard,
  buildPositionsView,
} from "../lib/format.js";
import { logger } from "../lib/logger.js";
import { editToSubmenu, replyWithNav } from "../lib/nav.js";
import { WalletManager } from "../lib/wallet.js";

/**
 * Record the (chatId, messageId) of the just-rendered positions card so
 * the track-action deeplink fired by tapping a ticker on an open
 * position can sweep it once the token detail card lands. Mirrors the
 * `lastBuyCardMessageByChat` shape — keyed by stringified chatId for
 * JSON round-trip through the session store.
 */
const rememberPositionsMessage = (
  ctx: AppContext,
  messageId: number | undefined,
): void => {
  const chatId = ctx.chat?.id;
  if (chatId === undefined || typeof messageId !== "number") return;
  const byChat = ctx.session.lastPositionsMessageByChat ?? {};
  byChat[String(chatId)] = messageId;
  ctx.session.lastPositionsMessageByChat = byChat;
};

const usage = (ctx: AppContext): string =>
  t(POSITIONS_USAGE_REPLY, getCtxLanguage(ctx));
const outage = (ctx: AppContext): string =>
  t(OUTAGE_REPLY, getCtxLanguage(ctx));
const invalidAddress = (ctx: AppContext): string =>
  t(POSITIONS_INVALID_ADDRESS_REPLY, getCtxLanguage(ctx));
const nonPrivateChatReply = (ctx: AppContext): string =>
  t(POSITIONS_NON_PRIVATE_CHAT_REPLY, getCtxLanguage(ctx));
const noActiveWallet = (ctx: AppContext): string =>
  t(POSITIONS_NO_ACTIVE_WALLET_REPLY, getCtxLanguage(ctx));

interface RenderedView {
  text: string;
  reply_markup: ReturnType<typeof buildPositionsPageKeyboard>;
}

const renderView = async (
  env: AppContext["env"],
  wallet: string,
  openPage: number,
  realisedPage: number,
): Promise<RenderedView | { outage: true } | { invalid: true }> => {
  const res = await fetchBotPositions(env, wallet);
  if (res.ok === false && res.kind === "invalid_address") {
    return { invalid: true };
  }
  if (!res.ok) return { outage: true };

  const botUsername = env.BOT_USERNAME?.trim() || null;
  const view = buildPositionsView(res.data, openPage, realisedPage, botUsername);
  const keyboard = buildPositionsPageKeyboard(view, wallet);
  return { text: view.text, reply_markup: keyboard };
};

/**
 * Common reply options for `/positions`. The body contains escaped
 * tickers (`<` / `>` / `&`) so HTML parse mode keeps an attacker-
 * controlled symbol from injecting markup. Link previews are disabled
 * to keep the pagination keyboard from being pushed off-screen by an
 * incidental preview card.
 */
const HTML_REPLY = {
  parse_mode: "HTML" as const,
  link_preview_options: { is_disabled: true as const },
};

const parseNonNegativeInt = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

export const registerPositionsCommand = (bot: Bot<AppContext>): void => {
  /**
   * Each section (open / realised) paginates independently at 5 records
   * per page — the section-specific `← Page N/T Open Pos` /
   * `→ Page N/T Realised Pos` buttons move one axis while preserving
   * the other's page state via the (openPage, realisedPage) tuple in
   * `callback_data`.
   *
   * With no argument we resolve the user's active custodial wallet so
   * `/positions` matches the start-menu Positions button. The fallback
   * is private-DM only — leaking a user's custodial address in a group
   * transcript is the exact thing we avoid. An explicit wallet argument
   * still works in any chat.
   */
  bot.command("positions", async (ctx) => {
    const arg = ctx.match.trim().split(/\s+/)[0] ?? "";
    let wallet = arg;
    if (wallet === "") {
      if (ctx.chat?.type !== "private" || !ctx.from) {
        await ctx.reply(wrap(ctx, usage(ctx)));
        return;
      }
      const wm = new WalletManager(ctx.env.WALLET_KV, ctx.env.MASTER_KEY);
      const active = await wm.getActive(ctx.from.id);
      if (!active) {
        await ctx.reply(wrap(ctx, noActiveWallet(ctx)));
        return;
      }
      wallet = active.address;
    } else if (!isAddress(wallet)) {
      await ctx.reply(wrap(ctx, invalidAddress(ctx)));
      return;
    }
    const view = await renderView(ctx.env, wallet, 0, 0);
    if ("invalid" in view) {
      await ctx.reply(wrap(ctx, invalidAddress(ctx)));
      return;
    }
    if ("outage" in view) {
      await replyWithNav(ctx, wrap(ctx, outage(ctx)));
      return;
    }
    const sent = await ctx.reply(wrap(ctx, view.text), {
      ...HTML_REPLY,
      reply_markup: view.reply_markup,
    });
    rememberPositionsMessage(ctx, sent.message_id);
  });

  /**
   * Refresh callback `pr:<openPage>:<realisedPage>:<wallet>`. Re-fetches
   * positions for the wallet and edits the originating message in-place
   * at the same (openPage, realisedPage) so proceeds / realised PnL
   * reflect the latest indexer state. Clamping to the new totals is
   * delegated to `buildPositionsView` so a position closing out between
   * renders cannot leave the user on a phantom page.
   */
  bot.callbackQuery(
    new RegExp(`^${POSITIONS_REFRESH_CALLBACK_CMD}:`),
    async (ctx) => {
      const data = ctx.callbackQuery.data ?? "";
      const parts = data.split(":");
      const openPage = parseNonNegativeInt(parts[1]);
      const realisedPage = parseNonNegativeInt(parts[2]);
      const wallet = parts[3];
      if (
        openPage === null ||
        realisedPage === null ||
        wallet === undefined ||
        !isAddress(wallet)
      ) {
        await ctx.answerCallbackQuery({ text: t(TOAST_INVALID_REFRESH_REQUEST, getCtxLanguage(ctx)) });
        return;
      }
      if (!ctx.callbackQuery.message) {
        await ctx.answerCallbackQuery({ text: t(TOAST_MESSAGE_NO_LONGER_AVAILABLE, getCtxLanguage(ctx)) });
        return;
      }

      const view = await renderView(ctx.env, wallet, openPage, realisedPage);
      if ("invalid" in view || "outage" in view) {
        await ctx.answerCallbackQuery({ text: outage(ctx) });
        return;
      }

      try {
        await ctx.editMessageText(wrap(ctx, view.text), {
          ...HTML_REPLY,
          reply_markup: view.reply_markup,
        });
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
        if (!isBenign) {
          await ctx.answerCallbackQuery();
          throw err;
        }
        logger.warn("editMessageText benign 400 in positions refresh", {
          queryId: ctx.callbackQuery.id,
          description: e.description,
        });
      }
      await ctx.answerCallbackQuery({ text: t(TOAST_REFRESHED, getCtxLanguage(ctx)) });
    },
  );

  /**
   * Pagination callback `pp:<openPage>:<realisedPage>:<wallet>`. Both
   * axes ride in the callback so each section's nav row can move its
   * own page index while preserving the other's state. Re-fetches on
   * every click (idempotent, ~zero-egress over the service binding)
   * and edits the originating message in-place so the chat doesn't
   * grow per nav click.
   */
  bot.callbackQuery(
    new RegExp(`^${POSITIONS_PAGE_CALLBACK_CMD}:`),
    async (ctx) => {
      const data = ctx.callbackQuery.data ?? "";
      const parts = data.split(":");
      const openPage = parseNonNegativeInt(parts[1]);
      const realisedPage = parseNonNegativeInt(parts[2]);
      const wallet = parts[3];
      if (
        openPage === null ||
        realisedPage === null ||
        wallet === undefined ||
        !isAddress(wallet)
      ) {
        await ctx.answerCallbackQuery({ text: t(TOAST_INVALID_PAGE_REQUEST, getCtxLanguage(ctx)) });
        return;
      }
      if (!ctx.callbackQuery.message) {
        await ctx.answerCallbackQuery({ text: t(TOAST_MESSAGE_NO_LONGER_AVAILABLE, getCtxLanguage(ctx)) });
        return;
      }

      const view = await renderView(ctx.env, wallet, openPage, realisedPage);
      if ("invalid" in view || "outage" in view) {
        await ctx.answerCallbackQuery({ text: outage(ctx) });
        return;
      }

      try {
        await ctx.editMessageText(wrap(ctx, view.text), {
          ...HTML_REPLY,
          reply_markup: view.reply_markup,
        });
      } catch (err) {
        // Only swallow the two known-benign Telegram 400 cases — a real
        // regression must surface so silent pagination failures don't
        // hide behind an unconditional catch.
        //   - "message not found"           — user deleted the msg
        //   - "message is not modified"     — user double-clicked
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
        if (!isBenign) {
          await ctx.answerCallbackQuery();
          throw err;
        }
        logger.warn("editMessageText benign 400 in positions pagination", {
          queryId: ctx.callbackQuery.id,
          description: e.description,
        });
      }
      await ctx.answerCallbackQuery();
    },
  );

  /**
   * Per-position `[Buy <TICKER>]` / `[Sell <TICKER>]` callbacks. Buttons
   * fire inline so the action card lands as the next message in the
   * same chat. Private-DM only — the action card prints USDC balance
   * and a buy/sell keyboard scoped to the user's active wallet.
   */
  const registerActionCallback = (
    cmd: typeof POSITIONS_BUY_CALLBACK_CMD | typeof POSITIONS_SELL_CALLBACK_CMD,
    action: "buy" | "sell",
  ): void => {
    bot.callbackQuery(new RegExp(`^${cmd}:`), async (ctx) => {
      const data = ctx.callbackQuery.data ?? "";
      const token = data.slice(cmd.length + 1);
      if (!isAddress(token)) {
        await ctx.answerCallbackQuery({ text: t(TOAST_INVALID_TOKEN, getCtxLanguage(ctx)) });
        return;
      }
      if (!ctx.from) {
        await ctx.answerCallbackQuery({ text: t(TOAST_MISSING_USER, getCtxLanguage(ctx)) });
        return;
      }
      if (ctx.chat?.type !== "private") {
        await ctx.answerCallbackQuery({
          text: nonPrivateChatReply(ctx),
          show_alert: true,
        });
        return;
      }
      const wm = new WalletManager(ctx.env.WALLET_KV, ctx.env.MASTER_KEY);
      const active = await wm.getActive(ctx.from.id);
      if (!active) {
        await ctx.answerCallbackQuery({
          text: noActiveWallet(ctx),
          show_alert: true,
        });
        return;
      }
      try {
        const ok = await editToActionCard(
          ctx,
          active.address,
          action,
          token as Address,
        );
        if (!ok) {
          await ctx.answerCallbackQuery({
            text: ACTION_TOKEN_OUTAGE,
            show_alert: true,
          });
          return;
        }
      } catch (err) {
        await ctx.answerCallbackQuery();
        throw err;
      }
      await ctx.answerCallbackQuery();
    });
  };
  registerActionCallback(POSITIONS_BUY_CALLBACK_CMD, "buy");
  registerActionCallback(POSITIONS_SELL_CALLBACK_CMD, "sell");

  /**
   * Start-menu "Positions" button: open positions for the user's
   * active custodial wallet directly. Mirrors the wallet-button pattern
   * (start menu → command UI in one tap). Private-chat only — group /
   * channel taps see the same gating as /start.
   */
  bot.callbackQuery(START_CALLBACK.positions, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery({ text: t(TOAST_MISSING_USER, getCtxLanguage(ctx)) });
      return;
    }
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery({
        text: nonPrivateChatReply(ctx),
        show_alert: true,
      });
      return;
    }
    const wm = new WalletManager(ctx.env.WALLET_KV, ctx.env.MASTER_KEY);
    const active = await wm.getActive(ctx.from.id);
    if (!active) {
      await ctx.answerCallbackQuery({
        text: noActiveWallet(ctx),
        show_alert: true,
      });
      return;
    }
    const view = await renderView(ctx.env, active.address, 0, 0);
    if ("invalid" in view) {
      await ctx.answerCallbackQuery({ text: invalidAddress(ctx), show_alert: true });
      return;
    }
    if ("outage" in view) {
      await ctx.answerCallbackQuery({ text: outage(ctx), show_alert: true });
      return;
    }
    try {
      const result = await editToSubmenu(ctx, {
        text: wrap(ctx, view.text),
        parseMode: "HTML",
        inlineKeyboard: view.reply_markup.inline_keyboard,
        linkPreviewDisabled: true,
      });
      rememberPositionsMessage(ctx, result.editedMessageId);
    } catch (err) {
      await ctx.answerCallbackQuery();
      throw err;
    }
    await ctx.answerCallbackQuery();
  });
};
