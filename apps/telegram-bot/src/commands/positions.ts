import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import {
  buildBuyTokenKeyboard,
  buildSellTokenKeyboard,
  normaliseDefaultBuyUsdc,
  normaliseDefaultSellUsdc,
} from "../keyboards/buy-sell-token.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import {
  fetchBotPositions,
  fetchToken,
  isAddress,
} from "../lib/api.js";
import { parseCallback } from "../lib/callbacks.js";
import {
  POSITIONS_PAGE_CALLBACK_CMD,
  POSITION_BUY_CALLBACK_CMD,
  POSITION_SELL_CALLBACK_CMD,
  buildPositionsPageKeyboard,
  formatBotPositionsResponse,
  renderPaginatedPage,
} from "../lib/format.js";
import { logger } from "../lib/logger.js";
import {
  fetchErc20Balance,
  fetchUsdcBalance,
} from "../lib/rpc.js";
import {
  renderBuyTokenCardText,
  renderSellTokenCardText,
} from "../lib/token-card.js";
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
  const res = await fetchBotPositions(env, wallet);
  if (res.ok === false && res.kind === "invalid_address") {
    return { invalid: true };
  }
  if (!res.ok) return { outage: true };

  const chunks = formatBotPositionsResponse(res.data);
  // Clamp the requested page — positions may have shrunk since the
  // button was rendered, in which case `page` could exceed the new
  // chunk count.
  const clamped = Math.min(Math.max(page, 0), chunks.length - 1);
  const text = renderPaginatedPage(
    chunks.map((c) => c.text),
    clamped,
  );
  const keyboard = buildPositionsPageKeyboard(
    clamped,
    chunks.length,
    wallet,
    chunks[clamped]!.openPositions,
  );
  return keyboard ? { text, reply_markup: keyboard } : { text };
};

/** Reply with a fresh buy card for the selected open position. */
const handlePositionBuy = async (
  ctx: AppContext,
  tokenAddress: string,
): Promise<void> => {
  const wm = new WalletManager(ctx.env.WALLET_KV, ctx.env.MASTER_KEY);
  const active = ctx.from ? await wm.getActive(ctx.from.id) : null;
  const [tokenResult, usdcBalance] = await Promise.all([
    fetchToken(ctx.env, tokenAddress),
    active ? fetchUsdcBalance(ctx.env, active.address) : Promise.resolve(null),
  ]);
  if (!tokenResult.ok) {
    await ctx.answerCallbackQuery({ text: OUTAGE, show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
  await ctx.reply(renderBuyTokenCardText(tokenResult.data, usdcBalance), {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: buildBuyTokenKeyboard(
        tokenAddress,
        normaliseDefaultBuyUsdc(ctx.session.defaultBuyUsdc),
      ),
    },
    link_preview_options: { is_disabled: true },
  });
};

/** Reply with a fresh sell card for the selected open position. */
const handlePositionSell = async (
  ctx: AppContext,
  tokenAddress: string,
): Promise<void> => {
  const wm = new WalletManager(ctx.env.WALLET_KV, ctx.env.MASTER_KEY);
  const active = ctx.from ? await wm.getActive(ctx.from.id) : null;
  const [tokenResult, tokenBalance] = await Promise.all([
    fetchToken(ctx.env, tokenAddress),
    active
      ? fetchErc20Balance(ctx.env, tokenAddress, active.address)
      : Promise.resolve(null),
  ]);
  if (!tokenResult.ok) {
    await ctx.answerCallbackQuery({ text: OUTAGE, show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
  await ctx.reply(renderSellTokenCardText(tokenResult.data, tokenBalance), {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: buildSellTokenKeyboard(
        tokenAddress,
        normaliseDefaultSellUsdc(ctx.session.defaultBuyUsdc),
      ),
    },
    link_preview_options: { is_disabled: true },
  });
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
   * Per-position "Buy <TICKER>" / "Sell <TICKER>" buttons. Each maps a
   * single open position to a fresh buy/sell card pre-loaded with that
   * token — same view as `/buy <addr>` / `/sell <addr>` would render.
   * The token address rides in `callback_data` so the handler stays
   * stateless across Worker cold-starts.
   */
  bot.callbackQuery(
    new RegExp(`^${POSITION_BUY_CALLBACK_CMD}:`),
    async (ctx) => {
      const parsed = parseCallback(ctx.callbackQuery.data ?? "");
      const token = parsed?.args[0];
      if (!token || !isAddress(token)) {
        await ctx.answerCallbackQuery({ text: "Invalid request." });
        return;
      }
      await handlePositionBuy(ctx, token).catch(async (err) => {
        logger.error("positions buy handler failed", { err });
        await ctx
          .answerCallbackQuery({ text: OUTAGE, show_alert: true })
          .catch(() => {});
      });
    },
  );

  bot.callbackQuery(
    new RegExp(`^${POSITION_SELL_CALLBACK_CMD}:`),
    async (ctx) => {
      const parsed = parseCallback(ctx.callbackQuery.data ?? "");
      const token = parsed?.args[0];
      if (!token || !isAddress(token)) {
        await ctx.answerCallbackQuery({ text: "Invalid request." });
        return;
      }
      await handlePositionSell(ctx, token).catch(async (err) => {
        logger.error("positions sell handler failed", { err });
        await ctx
          .answerCallbackQuery({ text: OUTAGE, show_alert: true })
          .catch(() => {});
      });
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
