import type { Bot } from "grammy";
import type { Address } from "viem";

import type { AppContext } from "../bot.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import {
  ACTION_TOKEN_OUTAGE,
  editToActionCard,
} from "../lib/action-card.js";
import { fetchBotPositions, isAddress } from "../lib/api.js";
import {
  POSITIONS_BUY_CALLBACK_CMD,
  POSITIONS_PAGE_CALLBACK_CMD,
  POSITIONS_REFRESH_CALLBACK_CMD,
  POSITIONS_SELL_CALLBACK_CMD,
  buildPositionsPageKeyboard,
  formatBotPositionsResponse,
  renderPaginatedPage,
} from "../lib/format.js";
import { logger } from "../lib/logger.js";
import { editToSubmenu, replyWithNav } from "../lib/nav.js";
import { WalletManager } from "../lib/wallet.js";

const USAGE = "Usage: /positions <wallet_address>";
const OUTAGE = "Data temporarily unavailable — try again in a moment.";
const INVALID_ADDRESS =
  "Invalid wallet address. Expected a 0x-prefixed 40-character hex address.";
const NON_PRIVATE_CHAT_REPLY =
  "Positions are private-DM only — open a direct chat with the bot to view your positions.";
const NO_ACTIVE_WALLET = "No active wallet. Run /wallet to create one.";

interface RenderedPage {
  text: string;
  reply_markup: ReturnType<typeof buildPositionsPageKeyboard>;
}

const renderPage = async (
  env: AppContext["env"],
  wallet: string,
  page: number,
): Promise<RenderedPage | { outage: true } | { invalid: true }> => {
  const res = await fetchBotPositions(env, wallet);
  if (res.ok === false && res.kind === "invalid_address") {
    return { invalid: true };
  }
  if (!res.ok) return { outage: true };

  const botUsername = env.BOT_USERNAME?.trim() || null;
  const pages = formatBotPositionsResponse(res.data, botUsername);
  // Clamp the requested page — positions may have shrunk since the
  // button was rendered, in which case `page` could exceed the new
  // page count.
  const clamped = Math.min(Math.max(page, 0), pages.length - 1);
  const text = renderPaginatedPage(pages, clamped);
  const keyboard = buildPositionsPageKeyboard(
    clamped,
    pages.length,
    wallet,
    pages[clamped]!.openActions,
  );
  return { text, reply_markup: keyboard };
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

export const registerPositionsCommand = (bot: Bot<AppContext>): void => {
  /**
   * Long lists paginate in-place via the `pp` callback below — the
   * AGENTS.md Telegram-platform-constraints rule "never send one giant
   * message" is enforced by sending only page 0 and attaching a
   * `[Next →]` button when the response spills.
   *
   * With no argument we resolve the user's active custodial wallet so
   * `/positions` matches the start-menu Positions button and the
   * AGENTS.md spec (`/positions [wallet]` → "default: active wallet").
   * The fallback is private-DM only — leaking a user's custodial
   * address in a group transcript is the exact thing we avoid. An
   * explicit wallet argument still works in any chat.
   */
  bot.command("positions", async (ctx) => {
    const arg = ctx.match.trim().split(/\s+/)[0] ?? "";
    let wallet = arg;
    if (wallet === "") {
      if (ctx.chat?.type !== "private" || !ctx.from) {
        await ctx.reply(USAGE);
        return;
      }
      const wm = new WalletManager(ctx.env.WALLET_KV, ctx.env.MASTER_KEY);
      const active = await wm.getActive(ctx.from.id);
      if (!active) {
        await ctx.reply(NO_ACTIVE_WALLET);
        return;
      }
      wallet = active.address;
    } else if (!isAddress(wallet)) {
      await ctx.reply(INVALID_ADDRESS);
      return;
    }
    const page = await renderPage(ctx.env, wallet, 0);
    if ("invalid" in page) {
      await ctx.reply(INVALID_ADDRESS);
      return;
    }
    if ("outage" in page) {
      await replyWithNav(ctx, OUTAGE);
      return;
    }
    await ctx.reply(page.text, {
      ...HTML_REPLY,
      reply_markup: page.reply_markup,
    });
  });

  /**
   * Pagination callback `pp:<page>:<wallet>`. Re-fetches on every click
   * (idempotent, ~zero-egress over the service binding) and edits the
   * originating message in-place so the chat doesn't grow per nav click.
   *
   * The wallet rides in `callback_data` rather than server-side state
   * so the bot survives Worker cold-starts and re-deploys without
   * needing a KV-backed page cache.
   */
  /**
   * Refresh callback `pr:<page>:<wallet>`. Re-fetches positions for the
   * wallet and edits the originating message in-place so proceeds /
   * realised PnL reflect the latest indexer state. Mirrors the buy/sell
   * card refresh — clamping to the new page count is delegated to
   * `renderPage` so a position closing out between renders cannot leave
   * the user on a phantom page.
   */
  bot.callbackQuery(
    new RegExp(`^${POSITIONS_REFRESH_CALLBACK_CMD}:`),
    async (ctx) => {
      const data = ctx.callbackQuery.data ?? "";
      const parts = data.split(":");
      const pageStr = parts[1];
      const wallet = parts[2];
      if (pageStr === undefined || wallet === undefined || !isAddress(wallet)) {
        await ctx.answerCallbackQuery({ text: "Invalid refresh request." });
        return;
      }
      const requestedPage = Number.parseInt(pageStr, 10);
      if (!Number.isFinite(requestedPage) || requestedPage < 0) {
        await ctx.answerCallbackQuery({ text: "Invalid refresh request." });
        return;
      }
      if (!ctx.callbackQuery.message) {
        await ctx.answerCallbackQuery({ text: "Message no longer available." });
        return;
      }

      const page = await renderPage(ctx.env, wallet, requestedPage);
      if ("invalid" in page || "outage" in page) {
        await ctx.answerCallbackQuery({ text: OUTAGE });
        return;
      }

      try {
        await ctx.editMessageText(page.text, {
          ...HTML_REPLY,
          reply_markup: page.reply_markup,
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
      await ctx.answerCallbackQuery({ text: "Refreshed" });
    },
  );

  bot.callbackQuery(
    new RegExp(`^${POSITIONS_PAGE_CALLBACK_CMD}:`),
    async (ctx) => {
      const data = ctx.callbackQuery.data ?? "";
      const parts = data.split(":");
      const pageStr = parts[1];
      const wallet = parts[2];
      if (pageStr === undefined || wallet === undefined || !isAddress(wallet)) {
        await ctx.answerCallbackQuery({ text: "Invalid page request." });
        return;
      }
      const requestedPage = Number.parseInt(pageStr, 10);
      if (!Number.isFinite(requestedPage) || requestedPage < 0) {
        await ctx.answerCallbackQuery({ text: "Invalid page request." });
        return;
      }
      if (!ctx.callbackQuery.message) {
        // Inline-mode or messages older than 48h have no `message`.
        await ctx.answerCallbackQuery({ text: "Message no longer available." });
        return;
      }

      const page = await renderPage(ctx.env, wallet, requestedPage);
      if ("invalid" in page || "outage" in page) {
        await ctx.answerCallbackQuery({ text: OUTAGE });
        return;
      }

      try {
        await ctx.editMessageText(page.text, {
          ...HTML_REPLY,
          reply_markup: page.reply_markup,
        });
      } catch (err) {
        // Only swallow the two known-benign Telegram 400 cases —
        // anything else (network, auth, runtime) must surface so a
        // real regression doesn't hide behind silent pagination
        // failures.
        //   - "message not found"           — user deleted the msg
        //   - "message is not modified"     — user double-clicked
        // grammY wraps Telegram errors with `error_code` + `description`
        // on `GrammyError`; fall back to message-substring for any
        // other shape.
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
   * Per-position `[Buy <TICKER>]` / `[Sell <TICKER>]` callbacks. These
   * replace the legacy `t.me?start=buy_<addr>` HTML anchors that
   * shipped on each open-position line — the anchors bounced the user
   * through Telegram's link-handler UI even inside the same bot's
   * chat, where the username mismatch (`CortisolBot` vs the deployed
   * `trade_cortisol_bot`) actively broke the deeplink. Callback
   * buttons fire inline so the action card lands as the next message
   * in the same chat with no extra navigation.
   *
   * Private-DM only — the action card prints USDC balance and a buy/
   * sell keyboard scoped to the user's active wallet, which we won't
   * surface in a group transcript.
   */
  const registerActionCallback = (
    cmd: typeof POSITIONS_BUY_CALLBACK_CMD | typeof POSITIONS_SELL_CALLBACK_CMD,
    action: "buy" | "sell",
  ): void => {
    bot.callbackQuery(new RegExp(`^${cmd}:`), async (ctx) => {
      const data = ctx.callbackQuery.data ?? "";
      const token = data.slice(cmd.length + 1);
      if (!isAddress(token)) {
        await ctx.answerCallbackQuery({ text: "Invalid token." });
        return;
      }
      if (!ctx.from) {
        await ctx.answerCallbackQuery({ text: "Missing user." });
        return;
      }
      if (ctx.chat?.type !== "private") {
        await ctx.answerCallbackQuery({
          text: NON_PRIVATE_CHAT_REPLY,
          show_alert: true,
        });
        return;
      }
      const wm = new WalletManager(ctx.env.WALLET_KV, ctx.env.MASTER_KEY);
      const active = await wm.getActive(ctx.from.id);
      if (!active) {
        await ctx.answerCallbackQuery({
          text: NO_ACTIVE_WALLET,
          show_alert: true,
        });
        return;
      }
      // Replace the /positions message in place with the buy/sell card
      // so Back lands the user back on the positions list via the
      // snapshot pushed inside `editToActionCard`. Token-fetch outage
      // surfaces as a toast — leaving the positions view intact is the
      // friendliest fallback.
      //
      // The try/catch wraps the edit so a non-benign Telegram failure
      // (e.g. 403 user blocked the bot) still acks the callback before
      // bubbling — without the ack the client spinner hangs until
      // Telegram's 30s timeout.
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
   * active custodial wallet directly instead of toasting a /positions
   * hint. Mirrors the wallet-button pattern (start menu → command UI
   * in one tap). Private-chat only — group/channel taps see the same
   * gating as /start.
   */
  bot.callbackQuery(START_CALLBACK.positions, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery({ text: "Missing user." });
      return;
    }
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery({
        text: NON_PRIVATE_CHAT_REPLY,
        show_alert: true,
      });
      return;
    }
    const wm = new WalletManager(ctx.env.WALLET_KV, ctx.env.MASTER_KEY);
    const active = await wm.getActive(ctx.from.id);
    if (!active) {
      await ctx.answerCallbackQuery({
        text: NO_ACTIVE_WALLET,
        show_alert: true,
      });
      return;
    }
    const page = await renderPage(ctx.env, active.address, 0);
    if ("invalid" in page) {
      // Outage / invalid states surface as toasts rather than editing
      // the /start view into an error screen — the user keeps the
      // welcome card and can retry.
      await ctx.answerCallbackQuery({ text: INVALID_ADDRESS, show_alert: true });
      return;
    }
    if ("outage" in page) {
      await ctx.answerCallbackQuery({ text: OUTAGE, show_alert: true });
      return;
    }
    try {
      await editToSubmenu(ctx, {
        text: page.text,
        parseMode: "HTML",
        inlineKeyboard: page.reply_markup.inline_keyboard,
        linkPreviewDisabled: true,
      });
    } catch (err) {
      // Ack before rethrow so the client spinner unwinds even when
      // the edit / fallback reply errors non-benignly.
      await ctx.answerCallbackQuery();
      throw err;
    }
    await ctx.answerCallbackQuery();
  });
};
