import {
  type Conversation,
  createConversation,
} from "@grammyjs/conversations";
import type { Bot } from "grammy";
import { MIN_USDC_BUY_AMOUNT } from "@launchpad/shared";

import type { AppContext } from "../bot.js";
import {
  buildBuyTokenKeyboard,
  isBuyPresetAmount,
  MAX_BUY_PRESET_USDC,
  normaliseBuyPresets,
} from "../keyboards/buy-sell-token.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import { extractTokenAddress, fetchToken } from "../lib/api.js";
import { parseCallback } from "../lib/callbacks.js";
import {
  haltAndForward,
  isCancel,
  isOtherSlashCommand,
  tryAddressBuyIntercept,
} from "../lib/conversation-commands.js";
import {
  cancelTrade,
  confirmKeyboard,
  confirmTrade,
  renderConfirmReply,
  stageBuy,
  submitBuy,
} from "../lib/execute.js";
import { logger } from "../lib/logger.js";
import { backHomeMarkup } from "../lib/nav.js";
import { MAX_USDC_AMOUNT, parseUserAmount } from "../lib/parse-number.js";
import { fetchUsdcBalance } from "../lib/rpc.js";
import { renderBuyTokenCardText, formatUsdc6 } from "../lib/token-card.js";
import { WalletManager } from "../lib/wallet.js";
import { pushWorkflowMessage } from "../lib/workflow-stack.js";
import {
  sweepWorkflow,
  trackWorkflowMessage,
} from "../lib/workflow-stack-conversation.js";

/** Combined bot+protocol fee rate used for balance headroom check (1%). */
const COMBINED_FEE_RATE = 0.01;

const PROMPT_HTML =
  "Enter the token contract address or paste a link from alt.fun or hyperevmscan.\n\n" +
  "Examples:\n" +
  "• <code>0x1234…abcd</code>\n" +
  "• <code>https://alt.fun/0x1234…</code>\n" +
  "• <code>https://hyperevmscan.io/token/0x1234…</code>\n\n" +
  "Tap Home to exit.";

const TOKEN_NOT_FOUND_HTML =
  "❌ <b>Token not found.</b>\n\n" +
  "Make sure you have the correct contract address. You can find it on:\n" +
  "• <a href=\"https://alt.fun\">alt.fun</a> — tap the token → copy address\n" +
  "• <a href=\"https://hyperevmscan.io\">hyperevmscan.io</a> — search the token → copy address\n\n" +
  "Try again, or tap Home to exit.";

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
  // Sweep any prompts left behind by a prior interrupted flow so the
  // user's view opens cleanly on the new lookup. Idempotent — no-op if
  // the stack is already empty.
  await sweepWorkflow(conversation);

  const promptMsg = await ctx.reply(PROMPT_HTML, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: backHomeMarkup(),
  });
  await trackWorkflowMessage(conversation, promptMsg.message_id);

  while (true) {
    const msgCtx = await conversation.waitFor("message:text");
    await trackWorkflowMessage(conversation, msgCtx.message.message_id);
    const text = msgCtx.message.text.trim();

    if (isCancel(text)) {
      await msgCtx.reply("Cancelled.");
      await sweepWorkflow(conversation);
      return;
    }
    if (isOtherSlashCommand(text)) {
      await sweepWorkflow(conversation);
      await haltAndForward(conversation);
    }

    const addr = extractTokenAddress(text);
    if (!addr) {
      const notFound = await msgCtx.reply(TOKEN_NOT_FOUND_HTML, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: backHomeMarkup(),
      });
      await trackWorkflowMessage(conversation, notFound.message_id);
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
        const notFound = await msgCtx.reply(TOKEN_NOT_FOUND_HTML, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: backHomeMarkup(),
        });
        await trackWorkflowMessage(conversation, notFound.message_id);
        continue;
      }
      // API unavailable — abort per AGENTS.md Error Handling
      await msgCtx.reply(API_UNAVAILABLE);
      await sweepWorkflow(conversation);
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
    const buyPresets = await conversation.external((outerCtx) =>
      normaliseBuyPresets(
        outerCtx.session.buyPresetsUsdc,
        outerCtx.session.defaultBuyUsdc,
      ),
    );
    const cardMsg = await msgCtx.reply(cardText, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: buildBuyTokenKeyboard(token.address, buyPresets),
      },
      link_preview_options: { is_disabled: true },
    });
    // Token card is the lookup's terminal result — sweep the chain of
    // prompts + retries above it so the user sees only the card.
    await sweepWorkflow(conversation);
    // Push the card onto the now-empty stack so the post-trade sweep
    // in `confirmTrade` deletes it once the user's buy lands; the card's
    // mcap/balance are stale the moment the trade commits.
    await trackWorkflowMessage(conversation, cardMsg.message_id);
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
  await sweepWorkflow(conversation);

  const promptMsg = await ctx.reply(
    `Enter the USDC amount to buy (minimum $${MIN_USDC_BUY_AMOUNT}):\n\nTap Home to exit.`,
    { reply_markup: backHomeMarkup() },
  );
  await trackWorkflowMessage(conversation, promptMsg.message_id);

  while (true) {
    const msgCtx = await conversation.waitFor("message:text");
    await trackWorkflowMessage(conversation, msgCtx.message.message_id);
    const text = msgCtx.message.text.trim();

    if (isCancel(text)) {
      await msgCtx.reply("Cancelled.");
      await sweepWorkflow(conversation);
      return;
    }
    if (isOtherSlashCommand(text)) {
      await sweepWorkflow(conversation);
      await haltAndForward(conversation);
    }
    if (await tryAddressBuyIntercept(conversation, text)) return;

    const amount = parseUserAmount(text, { max: MAX_USDC_AMOUNT });
    if (amount === null) {
      const retry = await msgCtx.reply(
        `Please enter a valid number (e.g. 50). Minimum is $${MIN_USDC_BUY_AMOUNT}.`,
        { reply_markup: backHomeMarkup() },
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    if (amount < MIN_USDC_BUY_AMOUNT) {
      const retry = await msgCtx.reply(
        `Minimum buy is $${MIN_USDC_BUY_AMOUNT} USDC. Enter a larger amount.`,
        { reply_markup: backHomeMarkup() },
      );
      await trackWorkflowMessage(conversation, retry.message_id);
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
      await sweepWorkflow(conversation);
      return;
    }

    const usdcBalance = await conversation.external((outerCtx) =>
      fetchUsdcBalance(outerCtx.env, active.address),
    );
    // Null means RPC failed — don't treat as zero, which would produce
    // a false "insufficient balance" rejection for a working wallet.
    if (usdcBalance === null) {
      const retry = await msgCtx.reply(
        `Unable to verify your USDC balance — please try again.`,
        { reply_markup: backHomeMarkup() },
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    const usdcAvailable = Number(usdcBalance) / 1_000_000;
    const totalNeeded = amount * (1 + COMBINED_FEE_RATE);

    if (usdcAvailable < totalNeeded) {
      const retry = await msgCtx.reply(
        `Insufficient USDC balance.\n` +
          `You need $${totalNeeded.toFixed(2)} (amount + fees) but have ${formatUsdc6(usdcBalance)}.\n\n` +
          `Enter a smaller amount, or tap Home to exit.`,
        { reply_markup: backHomeMarkup() },
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }

    const tokenResult = await conversation.external((outerCtx) =>
      fetchToken(outerCtx.env, tokenAddress),
    );
    if (!tokenResult.ok) {
      await msgCtx.reply(API_UNAVAILABLE);
      await sweepWorkflow(conversation);
      return;
    }

    const token = tokenResult.data;
    const usdcRaw = BigInt(Math.round(amount * 1_000_000));
    const degenMode = await conversation.external(
      (outerCtx): boolean => outerCtx.session.degenMode,
    );
    if (degenMode) {
      await msgCtx.reply(
        `⚡ <b>Degen mode — submitting $${amount.toFixed(2)} USDC buy of ${token.ticker}…</b>`,
        { parse_mode: "HTML" },
      );
      const outcome = await conversation.external((outerCtx) =>
        submitBuy({
          ctx: outerCtx,
          token: token.address,
          ticker: token.ticker,
          usdcRaw,
        }),
      );
      await msgCtx.reply(renderConfirmReply(outcome), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
      await sweepWorkflow(conversation);
      return;
    }
    const { nonce } = await conversation.external(
      (outerCtx): { nonce: string } =>
        stageBuy({
          ctx: outerCtx,
          token: token.address,
          ticker: token.ticker,
          usdcRaw,
        }),
    );
    const stagingMsg = await msgCtx.reply(
      `✅ <b>Ready to buy $${amount.toFixed(2)} USDC of ${token.ticker}</b>\n\n` +
        `Tap <b>Confirm</b> within 60s to submit.`,
      {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: confirmKeyboard(nonce) },
      },
    );
    await sweepWorkflow(conversation);
    // Staging prompt is stale once the trade lands — push so the
    // post-trade sweep clears it alongside the originating card.
    await trackWorkflowMessage(conversation, stagingMsg.message_id);
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
    reply_markup: {
      inline_keyboard: buildBuyTokenKeyboard(
        tokenAddress,
        normaliseBuyPresets(
          ctx.session.buyPresetsUsdc,
          ctx.session.defaultBuyUsdc,
        ),
      ),
    },
    link_preview_options: { is_disabled: true },
  });
  await ctx.answerCallbackQuery({ text: "Refreshed" });
};

/**
 * Push a transient message onto the chat-scoped workflow stack so a
 * later `clearWorkflowMessages` sweep (run after a trade lands) deletes
 * it. Used for the token-detail card and the "Ready to buy…" staging
 * prompt — both are stale the moment the trade confirms. No-op when the
 * context has no resolvable chat id (rare, only for inline-mode).
 */
const trackForPostTradeSweep = (ctx: AppContext, messageId: number): void => {
  if (!ctx.chat) return;
  pushWorkflowMessage(ctx.session, ctx.chat.id, messageId);
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

  const usdcRaw = BigInt(Math.round(amountUsdc * 1_000_000));
  // Track the token-detail card the user just tapped on so the
  // post-trade sweep clears it once the buy commits.
  if (ctx.callbackQuery?.message) {
    trackForPostTradeSweep(ctx, ctx.callbackQuery.message.message_id);
  }
  if (ctx.session.degenMode) {
    await ctx.answerCallbackQuery({ text: "⚡ Submitting…" });
    const outcome = await submitBuy({
      ctx,
      token: tokenResult.data.address,
      ticker: tokenResult.data.ticker,
      usdcRaw,
    });
    await ctx.reply(renderConfirmReply(outcome), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    return;
  }
  await ctx.answerCallbackQuery();
  const { nonce } = stageBuy({
    ctx,
    token: tokenResult.data.address,
    ticker: tokenResult.data.ticker,
    usdcRaw,
  });
  const stagingMsg = await ctx.reply(
    `✅ <b>Ready to buy $${amountUsdc} USDC of ${tokenResult.data.ticker}</b>\n\n` +
      `Tap <b>Confirm</b> within 60s to submit.`,
    {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: confirmKeyboard(nonce) },
    },
  );
  trackForPostTradeSweep(ctx, stagingMsg.message_id);
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
    // An unhandled throw inside the handler used to log-and-swallow,
    // leaving the Telegram client spinner on the button until its 30s
    // timeout — visually indistinguishable from a no-op. Surface the
    // outage via answerCallbackQuery so the user can tell the press
    // landed and failed, then retry.
    await handleBuyRefresh(ctx, parsed.args[0]).catch(async (err) => {
      logger.error("buy refresh failed", { err });
      await ctx
        .answerCallbackQuery({ text: API_UNAVAILABLE, show_alert: true })
        .catch(() => {});
    });
  });

  // Buy <amount> USDC — preset slot. The keyboard encodes the amount
  // directly in the callback payload (`btp:<addr>:<amount>`) so a stale
  // card always buys the amount the user sees on the button, even if
  // they have edited a different /settings slot since the card was sent.
  // `isBuyPresetAmount` defends against tampered payloads bypassing the
  // min/max bounds enforced by the /settings wizard.
  bot.callbackQuery(/^btp:/, async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    const tokenAddress = parsed?.args[0];
    const amountRaw = parsed?.args[1];
    if (!tokenAddress || !amountRaw) {
      await ctx.answerCallbackQuery();
      return;
    }
    const amount = Number(amountRaw);
    if (!isBuyPresetAmount(amount)) {
      await ctx.answerCallbackQuery();
      return;
    }
    const clamped = Math.min(Math.max(amount, MIN_USDC_BUY_AMOUNT), MAX_BUY_PRESET_USDC);
    await handleFixedBuy(ctx, tokenAddress, clamped).catch(async (err) => {
      logger.error("buy preset handler failed", { err, amount: clamped });
      await ctx
        .answerCallbackQuery({ text: API_UNAVAILABLE, show_alert: true })
        .catch(() => {});
    });
  });

  // Buy X USDC — enter custom amount conversation
  bot.callbackQuery(/^btbx:/, async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    if (!parsed?.args[0]) {
      await ctx.answerCallbackQuery();
      return;
    }
    // Push the originating token-detail card onto the workflow stack
    // before entering the wizard, so the post-trade sweep deletes it
    // once the user's eventual buy lands.
    if (ctx.callbackQuery.message) {
      trackForPostTradeSweep(ctx, ctx.callbackQuery.message.message_id);
    }
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("buy-custom", parsed.args[0]);
  });

  // Confirm / Cancel are shared with /sell (same staging slot in
  // `ctx.session.pendingTrade`). Registered here so the wiring stays
  // in one place.
  bot.callbackQuery(/^cnf:/, async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    const nonce = parsed?.args[0];
    if (!nonce) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery({ text: "Submitting…" });
    try {
      const outcome = await confirmTrade(ctx, nonce);
      await ctx.reply(renderConfirmReply(outcome), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    } catch (err) {
      logger.error("trade confirm failed", { err });
      await ctx.reply(
        "Transaction failed — please try again in a moment.",
      );
    }
  });

  bot.callbackQuery(/^ccl:/, async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    const nonce = parsed?.args[0];
    if (!nonce) {
      await ctx.answerCallbackQuery();
      return;
    }
    const cleared = cancelTrade(ctx, nonce);
    await ctx.answerCallbackQuery({
      text: cleared ? "Cancelled" : "Already expired",
    });
  });
};
