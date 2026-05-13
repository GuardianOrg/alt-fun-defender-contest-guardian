import {
  type Conversation,
  createConversation,
} from "@grammyjs/conversations";
import type { Bot } from "grammy";
import { MIN_USDC_SELL_AMOUNT } from "@launchpad/shared";

import type { AppContext } from "../bot.js";
import { buildSellTokenKeyboard } from "../keyboards/buy-sell-token.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import { extractTokenAddress, fetchToken } from "../lib/api.js";
import { parseCallback } from "../lib/callbacks.js";
import { logger } from "../lib/logger.js";
import { fetchErc20Balance } from "../lib/rpc.js";
import {
  estimateHoldingUsdc,
  formatToken18,
  renderSellTokenCardText,
} from "../lib/token-card.js";
import { WalletManager } from "../lib/wallet.js";

/** Rough combined fee rate applied to estimated proceeds (1%). */
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
    const e = err as {
      error_code?: number;
      description?: string;
      message?: string;
    };
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
 * Conversation: collect token address → show sell card with user's balance.
 * Loops on not-found / invalid input; aborts on API unavailability.
 */
const sellLookupConversation = async (
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
    const tokenBalance =
      active && userId
        ? await conversation.external((outerCtx) =>
            fetchErc20Balance(outerCtx.env, token.address, active.address),
          )
        : null;

    const cardText = renderSellTokenCardText(token, tokenBalance);
    await msgCtx.reply(cardText, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buildSellTokenKeyboard(token.address) },
      link_preview_options: { is_disabled: true },
    });
    return;
  }
};

/**
 * Conversation: collect custom sell USDC target amount.
 * `tokenAddress` is passed via `ctx.conversation.enter("sell-custom", addr)`.
 */
const sellCustomConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  tokenAddress: string,
): Promise<void> => {
  await ctx.reply(
    `Enter the USDC amount to receive (minimum $${MIN_USDC_SELL_AMOUNT}):\n\nSend /cancel to exit.`,
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
        `Please enter a valid number (e.g. 50). Minimum is $${MIN_USDC_SELL_AMOUNT}.`,
      );
      continue;
    }
    if (amount < MIN_USDC_SELL_AMOUNT) {
      await msgCtx.reply(
        `Minimum sell is $${MIN_USDC_SELL_AMOUNT} USDC proceeds. Enter a larger amount or send /cancel.`,
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

    const [tokenResult, tokenBalance] = await Promise.all([
      conversation.external((outerCtx) =>
        fetchToken(outerCtx.env, tokenAddress),
      ),
      conversation.external((outerCtx) =>
        fetchErc20Balance(outerCtx.env, tokenAddress, active.address),
      ),
    ]);

    if (!tokenResult.ok) {
      await msgCtx.reply(API_UNAVAILABLE);
      return;
    }

    const token = tokenResult.data;

    // Null balance = RPC unavailable; don't coerce to zero.
    if (tokenBalance === null) {
      await msgCtx.reply(
        "Unable to verify your token balance — please try again.",
      );
      continue;
    }

    if (tokenBalance === 0n) {
      await msgCtx.reply(
        `You hold no ${token.ticker}. Get some via the buy flow first.`,
      );
      return;
    }

    if (token.priceUsd !== null) {
      const holdingUsdc = estimateHoldingUsdc(tokenBalance, token.priceUsd);
      const estimatedProceeds = holdingUsdc * (1 - COMBINED_FEE_RATE);
      if (estimatedProceeds < amount) {
        await msgCtx.reply(
          `Insufficient balance. Your ${formatToken18(tokenBalance)} ${token.ticker} is worth ≈$${holdingUsdc.toFixed(2)} (est. proceeds ≈$${estimatedProceeds.toFixed(2)} after fees).\n\nEnter a smaller amount or send /cancel.`,
        );
        continue;
      }
    }

    await msgCtx.reply(
      `✅ <b>Ready to sell $${amount.toFixed(2)} USDC worth of ${token.ticker}</b>\n\n` +
        `<i>${FEE_SUMMARY}</i>\n\n` +
        `<i>Trade execution will be wired to BotFeeRouter in a future update.</i>`,
      { parse_mode: "HTML" },
    );
    return;
  }
};

/** Re-fetch token + token balance and edit the existing sell card in-place. */
const handleSellRefresh = async (
  ctx: AppContext,
  tokenAddress: string,
): Promise<void> => {
  const wm = buildManager(ctx.env);
  const active = ctx.from ? await wm.getActive(ctx.from.id) : null;
  const [tokenResult, tokenBalance] = await Promise.all([
    fetchToken(ctx.env, tokenAddress),
    active
      ? fetchErc20Balance(ctx.env, tokenAddress, active.address)
      : Promise.resolve(null),
  ]);

  if (!tokenResult.ok) {
    await ctx.answerCallbackQuery({
      text: API_UNAVAILABLE,
      show_alert: true,
    });
    return;
  }

  const cardText = renderSellTokenCardText(tokenResult.data, tokenBalance);
  await safeEditMessageText(ctx, cardText, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buildSellTokenKeyboard(tokenAddress) },
    link_preview_options: { is_disabled: true },
  });
  await ctx.answerCallbackQuery({ text: "Refreshed" });
};

/** Validate holding then show confirmation for a fixed USDC target sell. */
const handleFixedSell = async (
  ctx: AppContext,
  tokenAddress: string,
  targetUsdc: number,
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

  const [tokenResult, tokenBalance] = await Promise.all([
    fetchToken(ctx.env, tokenAddress),
    fetchErc20Balance(ctx.env, tokenAddress, active.address),
  ]);

  if (!tokenResult.ok) {
    await ctx.answerCallbackQuery({
      text: API_UNAVAILABLE,
      show_alert: true,
    });
    return;
  }

  const token = tokenResult.data;

  // Null balance = RPC unavailable; don't coerce to zero.
  if (tokenBalance === null) {
    await ctx.answerCallbackQuery({
      text: "Unable to verify your token balance — please try again.",
      show_alert: true,
    });
    return;
  }

  if (tokenBalance === 0n) {
    await ctx.answerCallbackQuery({
      text: `You hold no ${token.ticker}.`,
      show_alert: true,
    });
    return;
  }

  if (token.priceUsd !== null) {
    const holdingUsdc = estimateHoldingUsdc(tokenBalance, token.priceUsd);
    const estimatedProceeds = holdingUsdc * (1 - COMBINED_FEE_RATE);
    if (estimatedProceeds < MIN_USDC_SELL_AMOUNT) {
      await ctx.answerCallbackQuery({
        text: `Estimated proceeds ≈$${estimatedProceeds.toFixed(2)} would be below the $${MIN_USDC_SELL_AMOUNT} minimum.`,
        show_alert: true,
      });
      return;
    }
    if (estimatedProceeds < targetUsdc) {
      await ctx.answerCallbackQuery({
        text: `Insufficient holding: estimated proceeds ≈$${estimatedProceeds.toFixed(2)} < $${targetUsdc} target.`,
        show_alert: true,
      });
      return;
    }
  }

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `✅ <b>Ready to sell $${targetUsdc} USDC worth of ${token.ticker}</b>\n\n` +
      `<i>${FEE_SUMMARY}</i>\n\n` +
      `<i>Trade execution will be wired to BotFeeRouter in a future update.</i>`,
    { parse_mode: "HTML" },
  );
};

/** Validate holding then show confirmation to sell the entire position. */
const handleSellAll = async (
  ctx: AppContext,
  tokenAddress: string,
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

  const [tokenResult, tokenBalance] = await Promise.all([
    fetchToken(ctx.env, tokenAddress),
    fetchErc20Balance(ctx.env, tokenAddress, active.address),
  ]);

  if (!tokenResult.ok) {
    await ctx.answerCallbackQuery({
      text: API_UNAVAILABLE,
      show_alert: true,
    });
    return;
  }

  const token = tokenResult.data;

  // Null balance = RPC unavailable; don't coerce to zero.
  if (tokenBalance === null) {
    await ctx.answerCallbackQuery({
      text: "Unable to verify your token balance — please try again.",
      show_alert: true,
    });
    return;
  }

  if (tokenBalance === 0n) {
    await ctx.answerCallbackQuery({
      text: `You hold no ${token.ticker}.`,
      show_alert: true,
    });
    return;
  }

  if (token.priceUsd !== null) {
    const holdingUsdc = estimateHoldingUsdc(tokenBalance, token.priceUsd);
    const estimatedProceeds = holdingUsdc * (1 - COMBINED_FEE_RATE);
    if (estimatedProceeds < MIN_USDC_SELL_AMOUNT) {
      await ctx.answerCallbackQuery({
        text: `Estimated proceeds ≈$${estimatedProceeds.toFixed(2)} would be below the $${MIN_USDC_SELL_AMOUNT} minimum.`,
        show_alert: true,
      });
      return;
    }
  }

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `✅ <b>Ready to sell all ${formatToken18(tokenBalance)} ${token.ticker}</b>\n\n` +
      `<i>${FEE_SUMMARY}</i>\n\n` +
      `<i>Trade execution will be wired to BotFeeRouter in a future update.</i>`,
    { parse_mode: "HTML" },
  );
};

export const registerSellCommand = (bot: Bot<AppContext>): void => {
  bot.use(createConversation(sellLookupConversation, "sell-lookup"));
  bot.use(
    createConversation(
      sellCustomConversation as (
        conv: Conversation<AppContext, AppContext>,
        ctx: AppContext,
        ...args: unknown[]
      ) => Promise<void>,
      "sell-custom",
    ),
  );

  // Start menu "Sell" button — no toast, go directly into lookup flow
  bot.callbackQuery(START_CALLBACK.sell, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("sell-lookup");
  });

  // /sell command — same flow as the button
  bot.command("sell", async (ctx) => {
    await ctx.conversation.enter("sell-lookup");
  });

  // Refresh sell card in-place
  bot.callbackQuery(/^btsr:/, async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    if (!parsed?.args[0]) {
      await ctx.answerCallbackQuery();
      return;
    }
    await handleSellRefresh(ctx, parsed.args[0]).catch((err) => {
      logger.error("sell refresh failed", { err });
    });
  });

  // Sell 20 USDC
  bot.callbackQuery(/^bts20:/, async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    if (!parsed?.args[0]) {
      await ctx.answerCallbackQuery();
      return;
    }
    await handleFixedSell(ctx, parsed.args[0], 20).catch(
      (err) => {
        logger.error("sell 20 handler failed", { err });
      },
    );
  });

  // Sell All
  bot.callbackQuery(/^btsa:/, async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    if (!parsed?.args[0]) {
      await ctx.answerCallbackQuery();
      return;
    }
    await handleSellAll(ctx, parsed.args[0]).catch((err) => {
      logger.error("sell all handler failed", { err });
    });
  });

  // Sell X USDC — enter custom amount conversation
  bot.callbackQuery(/^btsx:/, async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    if (!parsed?.args[0]) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("sell-custom", parsed.args[0]);
  });
};
