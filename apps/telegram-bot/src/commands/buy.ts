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
  isOtherSlashCommand,
  tryAddressBuyIntercept,
} from "../lib/conversation-commands.js";
import {
  cancelTrade,
  confirmKeyboard,
  confirmTrade,
  describeTradeForStatus,
  renderTxSendingText,
  replyConfirmedTradeAndPromptStart,
  runWithTxStatusUpdates,
  stageBuy,
  submitBuy,
  trackingPageUrl,
} from "../lib/execute.js";
import { escapeHtml } from "../lib/format.js";
import { logger } from "../lib/logger.js";
import {
  backHomeMarkup,
  backHomeRow,
  editToSubmenu,
  type MessageRef,
  replyWithNav,
  safeEditMessageById,
} from "../lib/nav.js";
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
 * Edit an origin bubble to show one of the prompt/retry texts. Used by
 * the conversation when entered with an `origin` ref so the wizard runs
 * inside the start-menu bubble the user tapped, rather than dropping a
 * fresh prompt below it. Returns `false` if the origin is gone — caller
 * falls back to `replyWithNav`.
 */
const editOriginToPrompt = async (
  conversation: Conversation<AppContext, AppContext>,
  origin: MessageRef,
  text: string,
): Promise<boolean> =>
  conversation.external((outside) =>
    safeEditMessageById(outside, origin, text, {
      parse_mode: "HTML",
      reply_markup: backHomeMarkup(),
      link_preview_options: { is_disabled: true },
    }),
  );

/**
 * Conversation: collect token address → show buy card.
 * Loops on not-found / invalid input; aborts on API unavailability.
 *
 * When entered from a start-menu button tap, `origin` carries the
 * `(chatId, messageId)` of the bubble the user tapped — the prompt was
 * already rendered into that bubble by the callback handler via
 * `editToSubmenu`. The conversation edits the same bubble for every
 * subsequent step (retry on not-found, final card) so the flow runs in
 * one stable chat bubble. With no origin (slash-command entry), falls
 * back to the legacy `replyWithNav` flow.
 */
const buyLookupConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  origin?: MessageRef,
): Promise<void> => {
  // Sweep any prompts left behind by a prior interrupted flow so the
  // user's view opens cleanly on the new lookup. Idempotent — no-op if
  // the stack is already empty.
  await sweepWorkflow(conversation);

  // Origin-edit mode tracks the origin bubble lazily: it must NOT be
  // pushed onto the workflow stack until it is repurposed as the card,
  // since the stack is swept on completion and any premature push would
  // delete the bubble the wizard is still running inside.
  let activeOrigin: MessageRef | null = origin ?? null;

  if (!activeOrigin) {
    const promptMsg = await replyWithNav(ctx, PROMPT_HTML, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    await trackWorkflowMessage(conversation, promptMsg.message_id);
  }

  const showRetry = async (msgCtx: AppContext, text: string): Promise<void> => {
    if (activeOrigin) {
      const edited = await editOriginToPrompt(conversation, activeOrigin, text);
      if (edited) return;
      // Origin was deleted (user wiped chat). Drop into fallback mode for
      // the rest of the flow.
      activeOrigin = null;
    }
    const notFound = await replyWithNav(msgCtx, text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    await trackWorkflowMessage(conversation, notFound.message_id);
  };

  while (true) {
    const msgCtx = await conversation.waitFor("message:text");
    await trackWorkflowMessage(conversation, msgCtx.message.message_id);
    const text = msgCtx.message.text.trim();

    if (isOtherSlashCommand(text)) {
      await sweepWorkflow(conversation);
      await haltAndForward(conversation);
    }

    const addr = extractTokenAddress(text);
    if (!addr) {
      await showRetry(msgCtx, TOKEN_NOT_FOUND_HTML);
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
        await showRetry(msgCtx, TOKEN_NOT_FOUND_HTML);
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
    const cardKeyboard = {
      inline_keyboard: buildBuyTokenKeyboard(token.address, buyPresets),
    };

    let cardMessageId: number | null = null;
    if (activeOrigin) {
      const edited = await conversation.external((outside) =>
        safeEditMessageById(outside, activeOrigin as MessageRef, cardText, {
          parse_mode: "HTML",
          reply_markup: cardKeyboard,
          link_preview_options: { is_disabled: true },
        }),
      );
      if (edited) cardMessageId = activeOrigin.messageId;
    }
    if (cardMessageId === null) {
      const cardMsg = await msgCtx.reply(cardText, {
        parse_mode: "HTML",
        reply_markup: cardKeyboard,
        link_preview_options: { is_disabled: true },
      });
      cardMessageId = cardMsg.message_id;
    }
    // Token card is the lookup's terminal result — sweep the chain of
    // prompts + retries above it so the user sees only the card. The
    // origin bubble (when used) was never pushed, so it survives the
    // sweep and is now the card itself.
    await sweepWorkflow(conversation);
    // Push the card onto the now-empty stack so the post-trade sweep
    // in `confirmTrade` deletes it once the user's buy lands; the card's
    // mcap/balance are stale the moment the trade commits.
    await trackWorkflowMessage(conversation, cardMessageId);
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
  origin?: MessageRef,
): Promise<void> => {
  await sweepWorkflow(conversation);

  const promptText = `Enter the USDC amount to buy (minimum $${MIN_USDC_BUY_AMOUNT}):\n\nTap Home to exit.`;

  // Edit-in-place when entered from a token-card tap so the wizard
  // runs in the same bubble; fall back to a fresh reply when no origin
  // is threaded (slash-entry / inline-mode).
  let promptShown = false;
  if (origin) {
    promptShown = await conversation.external((outside) =>
      safeEditMessageById(outside, origin, promptText, {
        reply_markup: backHomeMarkup(),
      }),
    );
  }
  if (!promptShown) {
    const promptMsg = await replyWithNav(ctx, promptText);
    await trackWorkflowMessage(conversation, promptMsg.message_id);
  }

  while (true) {
    const msgCtx = await conversation.waitFor("message:text");
    await trackWorkflowMessage(conversation, msgCtx.message.message_id);
    const text = msgCtx.message.text.trim();

    if (isOtherSlashCommand(text)) {
      await sweepWorkflow(conversation);
      await haltAndForward(conversation);
    }
    if (await tryAddressBuyIntercept(conversation, text)) return;

    const amount = parseUserAmount(text, { max: MAX_USDC_AMOUNT });
    if (amount === null) {
      const retry = await replyWithNav(
        msgCtx,
        `Please enter a valid number (e.g. 50). Minimum is $${MIN_USDC_BUY_AMOUNT}.`,
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    if (amount < MIN_USDC_BUY_AMOUNT) {
      const retry = await replyWithNav(
        msgCtx,
        `Minimum buy is $${MIN_USDC_BUY_AMOUNT} USDC. Enter a larger amount.`,
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
      const retry = await replyWithNav(
        msgCtx,
        `Unable to verify your USDC balance — please try again.`,
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    const usdcAvailable = Number(usdcBalance) / 1_000_000;
    const totalNeeded = amount * (1 + COMBINED_FEE_RATE);

    if (usdcAvailable < totalNeeded) {
      const retry = await replyWithNav(
        msgCtx,
        `Insufficient USDC balance.\n` +
          `You need $${totalNeeded.toFixed(2)} (amount + fees) but have ${formatUsdc6(usdcBalance)}.\n\n` +
          `Enter a smaller amount, or tap Home to exit.`,
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
      const description = describeTradeForStatus(
        "buy",
        token.ticker,
        usdcRaw,
      );
      const statusMsg = await msgCtx.reply(renderTxSendingText(description), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
      const chatId = msgCtx.chat?.id;
      if (chatId !== undefined) {
        await conversation.external((outerCtx) =>
          runWithTxStatusUpdates({
            ctx: outerCtx,
            target: {
              api: outerCtx.api,
              chatId,
              messageId: statusMsg.message_id,
            },
            side: "buy",
            description,
            run: () =>
              submitBuy({
                ctx: outerCtx,
                token: token.address,
                ticker: token.ticker,
                usdcRaw,
              }),
          }),
        );
      } else {
        // No resolvable chat id (rare — inline-mode / channel post).
        // Still submit the trade and reply with the receipt; without
        // this fallback the user would be left staring at the "Tx
        // sending" prompt with no follow-up.
        const outcome = await conversation.external((outerCtx) =>
          submitBuy({
            ctx: outerCtx,
            token: token.address,
            ticker: token.ticker,
            usdcRaw,
          }),
        );
        await replyConfirmedTradeAndPromptStart(msgCtx, outcome);
      }
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
    const tickerSafe = escapeHtml(token.ticker);
    const tokenSafe = escapeHtml(token.address);
    const stagingText =
      `✅ <b>Ready to buy $${amount.toFixed(2)} USDC of ${tickerSafe}</b>\n\n` +
      `Tap <b>Confirm</b> within 60s to submit.\n\n` +
      `Token: <a href="${trackingPageUrl(token.address)}">${tickerSafe}</a> <code>${tokenSafe}</code>`;
    const stagingMarkup = { inline_keyboard: confirmKeyboard(nonce) };

    // Prefer editing the originating token-detail card in place: the
    // card already showed token + balance, the staging text re-states
    // both, and a fresh bubble below would just stack clutter. The
    // `cnf:` / `ccl:` handlers target whichever bubble the user tapped
    // Confirm on, so they work against the edited bubble identically.
    let stagingMessageId: number | null = null;
    if (origin) {
      const edited = await conversation.external((outside) =>
        safeEditMessageById(outside, origin, stagingText, {
          parse_mode: "HTML",
          reply_markup: stagingMarkup,
          link_preview_options: { is_disabled: true },
        }),
      );
      if (edited) stagingMessageId = origin.messageId;
    }
    if (stagingMessageId === null) {
      const stagingMsg = await msgCtx.reply(stagingText, {
        parse_mode: "HTML",
        reply_markup: stagingMarkup,
        link_preview_options: { is_disabled: true },
      });
      stagingMessageId = stagingMsg.message_id;
    }
    await sweepWorkflow(conversation);
    // Staging prompt is stale once the trade lands — push so the
    // post-trade sweep clears it. The Tx-status flow detaches it
    // before editing in place with the receipt, so the receipt itself
    // survives the sweep.
    await trackWorkflowMessage(conversation, stagingMessageId);
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
  if (ctx.session.degenMode) {
    await ctx.answerCallbackQuery({ text: "⚡ Submitting…" });
    const cbMsg = ctx.callbackQuery?.message;
    if (cbMsg) {
      await runWithTxStatusUpdates({
        ctx,
        target: {
          api: ctx.api,
          chatId: cbMsg.chat.id,
          messageId: cbMsg.message_id,
        },
        side: "buy",
        description: describeTradeForStatus(
          "buy",
          tokenResult.data.ticker,
          usdcRaw,
        ),
        run: () =>
          submitBuy({
            ctx,
            token: tokenResult.data.address,
            ticker: tokenResult.data.ticker,
            usdcRaw,
          }),
      });
      return;
    }
    // Fallback for the rare case the callback has no parent message ref
    // (inline-mode invocation, ancient client). Preserves the pre-status
    // flow rather than dropping the trade.
    const outcome = await submitBuy({
      ctx,
      token: tokenResult.data.address,
      ticker: tokenResult.data.ticker,
      usdcRaw,
    });
    await replyConfirmedTradeAndPromptStart(ctx, outcome);
    return;
  }
  await ctx.answerCallbackQuery();
  const { nonce } = stageBuy({
    ctx,
    token: tokenResult.data.address,
    ticker: tokenResult.data.ticker,
    usdcRaw,
  });
  const tickerSafe = escapeHtml(tokenResult.data.ticker);
  const tokenSafe = escapeHtml(tokenResult.data.address);
  const stagingText =
    `✅ <b>Ready to buy $${amountUsdc} USDC of ${tickerSafe}</b>\n\n` +
    `Tap <b>Confirm</b> within 60s to submit.\n\n` +
    `Token: <a href="${trackingPageUrl(tokenResult.data.address)}">${tickerSafe}</a> <code>${tokenSafe}</code>`;
  const stagingMarkup = { inline_keyboard: confirmKeyboard(nonce) };

  // Edit the token-detail card the user tapped from into the staging
  // bubble: the card already showed token + balance and the staging
  // text re-states both, so a fresh reply below would just clutter.
  // `cnf:` / `ccl:` already target the bubble the user tapped Confirm
  // on, so they operate on the edited bubble identically.
  const cbMsg = ctx.callbackQuery?.message;
  let stagingMessageId: number | null = null;
  if (cbMsg) {
    try {
      await safeEditMessageText(ctx, stagingText, {
        parse_mode: "HTML",
        reply_markup: stagingMarkup,
        link_preview_options: { is_disabled: true },
      });
      stagingMessageId = cbMsg.message_id;
    } catch (err) {
      logger.debug("buy preset: edit-in-place failed, sending fresh", { err });
    }
  }
  if (stagingMessageId === null) {
    const stagingMsg = await ctx.reply(stagingText, {
      parse_mode: "HTML",
      reply_markup: stagingMarkup,
      link_preview_options: { is_disabled: true },
    });
    stagingMessageId = stagingMsg.message_id;
  }
  trackForPostTradeSweep(ctx, stagingMessageId);
};

export const registerBuyCommand = (bot: Bot<AppContext>): void => {
  bot.use(
    createConversation(
      buyLookupConversation as (
        conv: Conversation<AppContext, AppContext>,
        ctx: AppContext,
        ...args: unknown[]
      ) => Promise<void>,
      { id: "buy-lookup", parallel: true },
    ),
  );
  bot.use(
    createConversation(
      buyCustomConversation as (
        conv: Conversation<AppContext, AppContext>,
        ctx: AppContext,
        ...args: unknown[]
      ) => Promise<void>,
      { id: "buy-custom", parallel: true },
    ),
  );

  // Start menu "Buy" button — edit the start bubble in place to show
  // the address prompt (and thread that bubble's id into the wizard so
  // every step edits the same bubble) rather than dropping a fresh
  // prompt below the still-visible start menu.
  bot.callbackQuery(START_CALLBACK.buy, async (ctx) => {
    const result = await editToSubmenu(ctx, {
      text: PROMPT_HTML,
      parseMode: "HTML",
      inlineKeyboard: [backHomeRow()],
      linkPreviewDisabled: true,
    });
    await ctx.answerCallbackQuery();
    const origin: MessageRef | undefined =
      ctx.chat && result.editedMessageId !== undefined
        ? { chatId: ctx.chat.id, messageId: result.editedMessageId }
        : undefined;
    await ctx.conversation.enter("buy-lookup", origin);
  });

  // /buy command — slash entry has no parent bubble to edit, so it
  // falls through to the legacy `replyWithNav` prompt inside the
  // conversation when no origin is passed.
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

  // Buy X USDC — enter custom amount conversation. Pass the token-detail
  // card the user tapped from as the wizard's origin so every step
  // (amount prompt, retries, staging confirm) edits that same bubble
  // rather than stacking new prompts below it.
  bot.callbackQuery(/^btbx:/, async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    if (!parsed?.args[0]) {
      await ctx.answerCallbackQuery();
      return;
    }
    const origin: MessageRef | undefined = ctx.callbackQuery.message
      ? {
          chatId: ctx.callbackQuery.message.chat.id,
          messageId: ctx.callbackQuery.message.message_id,
        }
      : undefined;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("buy-custom", parsed.args[0], origin);
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
    // Snapshot the staged intent before `confirmTrade` clears it — we
    // need side / ticker / amount to render the Tx-status copy.
    const intent = ctx.session.pendingTrade;
    const cbMsg = ctx.callbackQuery.message;
    const canStream =
      intent !== undefined &&
      intent.nonce === nonce &&
      intent.expiresAt >= Date.now() &&
      cbMsg !== undefined;
    try {
      if (canStream && intent && cbMsg) {
        await runWithTxStatusUpdates({
          ctx,
          target: {
            api: ctx.api,
            chatId: cbMsg.chat.id,
            messageId: cbMsg.message_id,
          },
          side: intent.side,
          description: describeTradeForStatus(
            intent.side,
            intent.ticker,
            BigInt(intent.amountRaw),
          ),
          run: () => confirmTrade(ctx, nonce),
        });
        return;
      }
      // Expired / replayed / inline-mode without a message ref — fall
      // back to the legacy reply path so the user still gets an error
      // or receipt instead of nothing.
      const outcome = await confirmTrade(ctx, nonce);
      await replyConfirmedTradeAndPromptStart(ctx, outcome);
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
