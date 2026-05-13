import {
  type Conversation,
  createConversation,
} from "@grammyjs/conversations";
import type { Bot } from "grammy";
import { MIN_USDC_BUY_AMOUNT } from "@launchpad/shared";

import type { AppContext } from "../bot.js";
import { buildBuyTokenKeyboard } from "../keyboards/buy-sell-token.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import { extractTokenAddress, fetchToken } from "../lib/api.js";
import { parseCallback } from "../lib/callbacks.js";
import { logger } from "../lib/logger.js";
import { fetchUsdcBalance } from "../lib/rpc.js";
import { renderBuyTokenCardText, formatUsdc6 } from "../lib/token-card.js";
import { WalletManager } from "../lib/wallet.js";

/** Combined bot+protocol fee rate used for balance headroom check (1%). */
const COMBINED_FEE_RATE = 0.01;

/** Required fee-summary line per AGENTS.md key constraints. */
const FEE_SUMMARY = "Bot fee 0.5% + Alt Fun fee 0.5%";

const PROMPT_HTML =
  "Enter the token contract address or paste a link from alt.fun or hyperevmscan.\n\n" +
  "Examples:\n" +
  "• <code>0x1234…abcd</code>\n" +
  "• <code>https://alt.fun/0x1234…</code>\n" +
  "• <code>https://hyperevmscan.io/token/0x1234…</code>\n\n" +
  "Send /cancel to exit.";

const TOKEN_NOT_FOUND_HTML =
  "❌ <b>Token not found.</b>\n\n" +
  "Make sure you have the correct contract address. You can find it on:\n" +
  "• <a href=\"https://alt.fun\">alt.fun</a> — tap the token → copy address\n" +
  "• <a href=\"https://hyperevmscan.io\">hyperevmscan.io</a> — search the token → copy address\n\n" +
  "Try again or send /cancel to exit.";

/** Exact outage copy mandated by AGENTS.md Error Handling table. */
const API_UNAVAILABLE =
  "Data temporarily unavailable — try again in a moment.";

const safeEditMessageText = async (
  ctx: AppContext,
  text: string,
  extra: Parameters<AppContext["editMessageText"]>[1] = {},
): Promise<void> => {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    const e = err as { error_code?: number; description?: string; message?: string };
    const desc = (e.description ?? e.message ?? "").toLowerCase();
    const benign =
      e.error_code === 400 &&
      (desc.includes("message to edit not found") ||
        desc.includes("message not found") ||
        desc.includes("message is not modified"));
    if (!benign) throw err;
  }
};

const buildManager = (env: AppContext["env"]): WalletManager =>
  new WalletManager(env.WALLET_KV, env.MASTER_KEY);

/**
 * Conversation: collect token address → show buy card.
 * Loops on not-found / invalid input; aborts on API unavailability.
 */
const buyLookupConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
): Promise<void> => {
  await ctx.reply(PROMPT_HTML, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });

  while (true) {
    const msgCtx = await conversation.waitFor("message:text");
    const text = msgCtx.message.text.trim();

    if (text === "/cancel" || text.toLowerCase() === "cancel") {
      await msgCtx.reply("Cancelled.");
      return;
    }

    const addr = extractTokenAddress(text);
    if (!addr) {
      await msgCtx.reply(TOKEN_NOT_FOUND_HTML, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
      continue;
    }

    // `ctx.env` is not available on the replay-time context — use the
    // `outerCtx` argument that `conversation.external` provides.
    const tokenResult = await conversation.external((outerCtx) =>
      fetchToken(outerCtx.env, addr),
    );
    if (!tokenResult.ok) {
      if (
        tokenResult.kind === "not_found" ||
        tokenResult.kind === "invalid_address"
      ) {
        await msgCtx.reply(TOKEN_NOT_FOUND_HTML, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
        continue;
      }
      // API unavailable — abort per AGENTS.md Error Handling
      await msgCtx.reply(API_UNAVAILABLE);
      return;
    }

    const token = tokenResult.data;
    const userId = msgCtx.from?.id ?? ctx.from?.id;
    const active = userId
      ? await conversation.external((outerCtx) =>
          buildManager(outerCtx.env).getActive(userId),
        )
      : null;
    const usdcBalance =
      active && userId
        ? await conversation.external((outerCtx) =>
            fetchUsdcBalance(outerCtx.env, active.address),
          )
        : null;

    const cardText = renderBuyTokenCardText(token, usdcBalance);
    await msgCtx.reply(cardText, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buildBuyTokenKeyboard(token.address) },
      link_preview_options: { is_disabled: true },
    });
    return;
  }
};

/**
 * Conversation: collect custom buy amount.
 * `tokenAddress` is passed via `ctx.conversation.enter("buy-custom", addr)`.
 */
const buyCustomConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  tokenAddress: string,
): Promise<void> => {
  await ctx.reply(
    `Enter the USDC amount to buy (minimum $${MIN_USDC_BUY_AMOUNT}):\n\nSend /cancel to exit.`,
  );

  while (true) {
    const msgCtx = await conversation.waitFor("message:text");
    const text = msgCtx.message.text.trim();

    if (text === "/cancel" || text.toLowerCase() === "cancel") {
      await msgCtx.reply("Cancelled.");
      return;
    }

    const amount = parseFloat(text.replace(/[$,]/g, ""));
    if (isNaN(amount) || amount <= 0) {
      await msgCtx.reply(
        `Please enter a valid number (e.g. 50). Minimum is $${MIN_USDC_BUY_AMOUNT}.`,
      );
      continue;
    }
    if (amount < MIN_USDC_BUY_AMOUNT) {
      await msgCtx.reply(
        `Minimum buy is $${MIN_USDC_BUY_AMOUNT} USDC. Enter a larger amount or send /cancel.`,
      );
      continue;
    }

    const userId = msgCtx.from?.id ?? ctx.from?.id;
    const active = userId
      ? await conversation.external((outerCtx) =>
          buildManager(outerCtx.env).getActive(userId),
        )
      : null;
    if (!active) {
      await msgCtx.reply(
        "No active wallet — run /wallet to create or import one.",
      );
      return;
    }

    const usdcBalance = await conversation.external((outerCtx) =>
      fetchUsdcBalance(outerCtx.env, active.address),
    );
    // Null means RPC failed — don't treat as zero, which would produce
    // a false "insufficient balance" rejection for a working wallet.
    if (usdcBalance === null) {
      await msgCtx.reply(
        `Unable to verify your USDC balance — please try again.`,
      );
      continue;
    }
    const usdcAvailable = Number(usdcBalance) / 1_000_000;
    const totalNeeded = amount * (1 + COMBINED_FEE_RATE);

    if (usdcAvailable < totalNeeded) {
      await msgCtx.reply(
        `Insufficient USDC balance.\n` +
          `You need $${totalNeeded.toFixed(2)} (amount + fees) but have ${formatUsdc6(usdcBalance)}.\n\n` +
          `Enter a smaller amount or send /cancel.`,
      );
      continue;
    }

    const tokenResult = await conversation.external((outerCtx) =>
      fetchToken(outerCtx.env, tokenAddress),
    );
    if (!tokenResult.ok) {
      await msgCtx.reply(API_UNAVAILABLE);
      return;
    }

    const ticker = tokenResult.data.ticker;
    await msgCtx.reply(
      `✅ <b>Ready to buy $${amount.toFixed(2)} USDC of ${ticker}</b>\n\n` +
        `<i>${FEE_SUMMARY}</i>\n\n` +
        `<i>Trade execution will be wired to BotFeeRouter in a future update.</i>`,
      { parse_mode: "HTML" },
    );
    return;
  }
};

/** Re-fetch token + USDC balance and edit the existing buy card in-place. */
const handleBuyRefresh = async (
  ctx: AppContext,
  tokenAddress: string,
): Promise<void> => {
  const wm = buildManager(ctx.env);
  const active = ctx.from ? await wm.getActive(ctx.from.id) : null;
  const [tokenResult, usdcBalance] = await Promise.all([
    fetchToken(ctx.env, tokenAddress),
    active ? fetchUsdcBalance(ctx.env, active.address) : Promise.resolve(null),
  ]);

  if (!tokenResult.ok) {
    await ctx.answerCallbackQuery({
      text: API_UNAVAILABLE,
      show_alert: true,
    });
    return;
  }

  const cardText = renderBuyTokenCardText(tokenResult.data, usdcBalance);
  await safeEditMessageText(ctx, cardText, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buildBuyTokenKeyboard(tokenAddress) },
    link_preview_options: { is_disabled: true },
  });
  await ctx.answerCallbackQuery({ text: "Refreshed" });
};

/** Validate balance then show confirmation for a fixed buy amount. */
const handleFixedBuy = async (
  ctx: AppContext,
  tokenAddress: string,
  amountUsdc: number,
): Promise<void> => {
  if (!ctx.from) {
    await ctx.answerCallbackQuery();
    return;
  }
  const wm = buildManager(ctx.env);
  const active = await wm.getActive(ctx.from.id);
  if (!active) {
    await ctx.answerCallbackQuery({
      text: "No active wallet — run /wallet to set one up.",
      show_alert: true,
    });
    return;
  }

  const [usdcBalance, tokenResult] = await Promise.all([
    fetchUsdcBalance(ctx.env, active.address),
    fetchToken(ctx.env, tokenAddress),
  ]);

  if (!tokenResult.ok) {
    await ctx.answerCallbackQuery({
      text: API_UNAVAILABLE,
      show_alert: true,
    });
    return;
  }

  // Null balance = RPC unavailable; do not coerce to zero.
  if (usdcBalance === null) {
    await ctx.answerCallbackQuery({
      text: "Unable to verify your USDC balance — please try again.",
      show_alert: true,
    });
    return;
  }

  const usdcAvailable = Number(usdcBalance) / 1_000_000;
  const totalNeeded = amountUsdc * (1 + COMBINED_FEE_RATE);
  if (usdcAvailable < totalNeeded) {
    await ctx.answerCallbackQuery({
      text: `Insufficient USDC: need $${totalNeeded.toFixed(2)}, have $${usdcAvailable.toFixed(2)}.`,
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `✅ <b>Ready to buy $${amountUsdc} USDC of ${tokenResult.data.ticker}</b>\n\n` +
      `<i>${FEE_SUMMARY}</i>\n\n` +
      `<i>Trade execution will be wired to BotFeeRouter in a future update.</i>`,
    { parse_mode: "HTML" },
  );
};

export const registerBuyCommand = (bot: Bot<AppContext>): void => {
  bot.use(createConversation(buyLookupConversation, "buy-lookup"));
  bot.use(
    createConversation(
      buyCustomConversation as (
        conv: Conversation<AppContext, AppContext>,
        ctx: AppContext,
        ...args: unknown[]
      ) => Promise<void>,
      "buy-custom",
    ),
  );

  // Start menu "Buy" button — no toast, go directly into lookup flow
  bot.callbackQuery(START_CALLBACK.buy, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("buy-lookup");
  });

  // /buy command — same flow as the button
  bot.command("buy", async (ctx) => {
    await ctx.conversation.enter("buy-lookup");
  });

  // Refresh buy card in-place
  bot.callbackQuery(/^btr:/, async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    if (!parsed?.args[0]) {
      await ctx.answerCallbackQuery();
      return;
    }
    await handleBuyRefresh(ctx, parsed.args[0]).catch((err) => {
      logger.error("buy refresh failed", { err });
    });
  });

  // Buy 20 USDC
  bot.callbackQuery(/^bt20:/, async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    if (!parsed?.args[0]) {
      await ctx.answerCallbackQuery();
      return;
    }
    await handleFixedBuy(ctx, parsed.args[0], MIN_USDC_BUY_AMOUNT).catch(
      (err) => {
        logger.error("buy 20 handler failed", { err });
      },
    );
  });

  // Buy 100 USDC
  bot.callbackQuery(/^bt100:/, async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    if (!parsed?.args[0]) {
      await ctx.answerCallbackQuery();
      return;
    }
    await handleFixedBuy(ctx, parsed.args[0], 100).catch((err) => {
      logger.error("buy 100 handler failed", { err });
    });
  });

  // Buy X USDC — enter custom amount conversation
  bot.callbackQuery(/^btbx:/, async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    if (!parsed?.args[0]) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("buy-custom", parsed.args[0]);
  });
};
