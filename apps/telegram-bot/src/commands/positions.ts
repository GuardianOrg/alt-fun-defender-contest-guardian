import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import { fetchBalances, fetchPortfolio, isAddress } from "../lib/api.js";
import {
  POSITIONS_PAGE_CALLBACK_CMD,
  buildPositionsPageKeyboard,
  formatPositionsResponse,
  joinPositions,
  renderPaginatedPage,
} from "../lib/format.js";
import { logger } from "../lib/logger.js";
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
  reply_markup?: ReturnType<typeof buildPositionsPageKeyboard>;
}

const renderPage = async (
  env: AppContext["env"],
  wallet: string,
  page: number,
): Promise<RenderedPage | { outage: true } | { invalid: true }> => {
  const [portfolioRes, balancesRes] = await Promise.all([
    fetchPortfolio(env, wallet),
    fetchBalances(env, wallet),
  ]);
  if (
    (portfolioRes.ok === false && portfolioRes.kind === "invalid_address") ||
    (balancesRes.ok === false && balancesRes.kind === "invalid_address")
  ) {
    return { invalid: true };
  }
  if (!portfolioRes.ok || !balancesRes.ok) return { outage: true };

  const joined = joinPositions(
    portfolioRes.data.positions,
    balancesRes.data,
  );
  const chunks = formatPositionsResponse(joined, {
    approximate: portfolioRes.data.approximate,
  });
  // Clamp the requested page — positions may have shrunk since the
  // button was rendered, in which case `page` could exceed the new
  // chunk count.
  const clamped = Math.min(Math.max(page, 0), chunks.length - 1);
  const text = renderPaginatedPage(chunks, clamped);
  const keyboard = buildPositionsPageKeyboard(clamped, chunks.length, wallet);
  return keyboard ? { text, reply_markup: keyboard } : { text };
};

export const registerPositionsCommand = (bot: Bot<AppContext>): void => {
  /**
   * v1: wallet address is required (no active-wallet selector yet — see
   * apps/telegram-bot/AGENTS.md "/wallet"). Balance + cost basis only;
   * live PnL is a deferred feature pending the enriched portfolio
   * endpoint.
   *
   * Long lists paginate in-place via the `pp` callback below — the
   * AGENTS.md Telegram-platform-constraints rule "never send one giant
   * message" is enforced by sending only page 0 and attaching a
   * `[Next →]` button when the response spills.
   */
  bot.command("positions", async (ctx) => {
    const wallet = ctx.match.trim().split(/\s+/)[0] ?? "";
    if (wallet === "") {
      await ctx.reply(USAGE);
      return;
    }
    if (!isAddress(wallet)) {
      await ctx.reply(INVALID_ADDRESS);
      return;
    }
    const page = await renderPage(ctx.env, wallet, 0);
    if ("invalid" in page) {
      await ctx.reply(INVALID_ADDRESS);
      return;
    }
    if ("outage" in page) {
      await ctx.reply(OUTAGE);
      return;
    }
    await ctx.reply(page.text, page.reply_markup ? { reply_markup: page.reply_markup } : {});
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
        await ctx.editMessageText(
          page.text,
          page.reply_markup ? { reply_markup: page.reply_markup } : {},
        );
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
    await ctx.answerCallbackQuery();
    if ("invalid" in page) {
      await ctx.reply(INVALID_ADDRESS);
      return;
    }
    if ("outage" in page) {
      await ctx.reply(OUTAGE);
      return;
    }
    await ctx.reply(
      page.text,
      page.reply_markup ? { reply_markup: page.reply_markup } : {},
    );
  });
};
