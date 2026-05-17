import {
  type Conversation,
  createConversation,
} from "@grammyjs/conversations";
import type { Bot } from "grammy";
import { MIN_USDC_SELL_AMOUNT } from "@launchpad/shared";

import type { AppContext } from "../bot.js";
import {
  buildSellTokenKeyboard,
  isSellPercent,
  normaliseSellPresets,
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
  confirmKeyboard,
  describeTradeForStatus,
  renderTxSendingText,
  replyConfirmedTradeAndPromptStart,
  runWithTxStatusUpdates,
  stageSell,
  submitSell,
  trackingPageUrl,
} from "../lib/execute.js";
import { escapeHtml } from "../lib/format.js";
import {
  DEFAULT_LANGUAGE,
  type Language,
  NO_ACTIVE_WALLET_RUN_WALLET_REPLY,
  OUTAGE_REPLY,
  PROCEEDS_UNAVAILABLE_REPLY,
  SELL_BUFFER_BELOW_MIN_HTML,
  SELL_CUSTOM_PERCENT_INVALID_REPLY,
  SELL_CUSTOM_PERCENT_PROMPT,
  SELL_LT_BUFFER_TOO_LOW_REPLY,
  SELL_NO_BALANCE_REPLY,
  SELL_PERCENT_ROUNDS_TO_ZERO_REPLY,
  SELL_PERCENT_ROUNDS_TO_ZERO_TRY_LARGER_REPLY,
  SELL_PRESET_ALL_OF_SUFFIX,
  SELL_PROCEEDS_BELOW_MIN_REPLY,
  SELL_PROCEEDS_BELOW_MIN_TRY_LARGER_REPLY,
  SELL_STAGING_BUFFER_CAPPED_HTML,
  SELL_STAGING_BUFFER_CAPPED_PRESET_HTML,
  SELL_STAGING_READY_HTML,
  SELL_STAGING_READY_PRESET_HTML,
  SELL_UNABLE_TO_VERIFY_TOKEN_BALANCE_REPLY,
  TOAST_NO_ACTIVE_WALLET_RUN_WALLET,
  TOAST_REFRESHED,
  TOAST_SUBMITTING_ZAP,
  TOAST_UNABLE_TO_VERIFY_TOKEN_BALANCE,
  TOKEN_LOOKUP_NOT_FOUND_RETRY_HTML,
  TOKEN_LOOKUP_PROMPT_HTML,
  getCtxLanguage,
  t,
} from "../lib/i18n.js";
import { logger } from "../lib/logger.js";
import {
  backHomeMarkup,
  backHomeRow,
  editToSubmenu,
  type MessageRef,
  replyWithNav,
  safeEditMessageById,
} from "../lib/nav.js";
import { fetchErc20Balance, fetchLtBaseAssetBalance } from "../lib/rpc.js";
import {
  estimateHoldingUsdc,
  formatToken18,
  renderSellTokenCardText,
} from "../lib/token-card.js";
import {
  simulateSellWithBotFee,
  usdcRawToNumber,
  type Hex,
} from "../lib/trade.js";
import { WalletManager } from "../lib/wallet.js";
import { pushWorkflowMessage } from "../lib/workflow-stack.js";
import {
  sweepWorkflow,
  trackWorkflowMessage,
} from "../lib/workflow-stack-conversation.js";

/**
 * Heuristic combined fee rate applied to `priceUsd × balance` when the
 * `BotFeeRouter` simulation is unavailable (router not deployed yet, or
 * RPC failure). Tracks the *expected* total fee surface — Alt Fun 0.5%
 * + bot 0.5% — so the pre-tx min-check still rejects obviously-too-small
 * sells. Real validation happens against `quotedUsdcOut` from
 * `simulateSellWithBotFee` once the router secret is provisioned.
 */
const COMBINED_FEE_RATE = 0.01;

/**
 * Headroom kept between the user's post-fee proceeds and the LT's idle
 * USDC buffer. The LT's `redeem()` is consumed at the executed
 * `exchangeRate()` (which can tick up between preflight and inclusion)
 * and the gross USDC `Zap` redeems for is slightly larger than the
 * `quotedUsdcOut` we compare against (the bot's 0.5% fee is skimmed
 * *after* `Zap.sell` returns). 1% covers both — matches the safety
 * factor the web client applies in `services/tradeRouter.ts`.
 */
const BUFFER_REQUIRED_FACTOR = 1.01;

/**
 * Multiplier on the size we cap a buffer-limited sell at. We size below
 * the raw buffer so the on-chain `redeem` has a margin if the LT rate
 * moves up between the preflight and the user's confirm tap.
 */
const BUFFER_CAP_SAFETY = 0.99;

const PROMPT_HTML = (lang: Language): string =>
  t(TOKEN_LOOKUP_PROMPT_HTML, lang);

const TOKEN_NOT_FOUND_HTML = (lang: Language): string =>
  t(TOKEN_LOOKUP_NOT_FOUND_RETRY_HTML, lang);

/** Exact outage copy mandated by AGENTS.md Error Handling table. */
const API_UNAVAILABLE = (lang: Language): string => t(OUTAGE_REPLY, lang);

/**
 * Shown when both the `BotFeeRouter` simulation and the priceUsd
 * heuristic come back empty (sim reverted/unavailable + no indexer
 * price). Fail-closed: never confirm a sell whose proceeds we cannot
 * estimate, since `MIN_USDC_SELL_AMOUNT` would otherwise be silently
 * bypassed. Surfaces the same retry copy AGENTS.md uses for the
 * upstream-unavailable case.
 */
const PROCEEDS_UNAVAILABLE = (lang: Language): string =>
  t(PROCEEDS_UNAVAILABLE_REPLY, lang);

/**
 * Shown when the LT's idle USDC buffer would not even support the
 * `MIN_USDC_SELL_AMOUNT` floor. The user has to wait for BounceTech's
 * automation layer to replenish the buffer (~10s per AGENTS.md). Same
 * tone as the buffer-low confirm copy so the user understands this is
 * transient.
 */
const BUFFER_BELOW_MIN_HTML = (maxUsd: number, lang: Language): string =>
  t(SELL_BUFFER_BELOW_MIN_HTML, lang)(maxUsd, MIN_USDC_SELL_AMOUNT);

const ctxLang = (ctx: AppContext): Language => getCtxLanguage(ctx);

const convLang = async (
  conversation: Conversation<AppContext, AppContext>,
): Promise<Language> =>
  conversation.external((outside) =>
    outside.session?.language ?? DEFAULT_LANGUAGE,
  );

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
 * Push a transient message onto the chat-scoped workflow stack so a
 * later `clearWorkflowMessages` sweep (run after a trade lands) deletes
 * it. Used for the token-detail card and the "Ready to sell…" staging
 * prompt — both are stale the moment the trade confirms. No-op when the
 * context has no resolvable chat id (rare, only for inline-mode).
 */
const trackForPostTradeSweep = (ctx: AppContext, messageId: number): void => {
  if (!ctx.chat) return;
  pushWorkflowMessage(ctx.session, ctx.chat.id, messageId);
};

/**
 * Compute the raw token amount for `percent` of the user's `balance`.
 * `100%` returns `balance` directly so a fully-closing sell drains the
 * exact wei the user holds (no rounding dust left behind). For partial
 * percents we use integer bigint math: `balance × percent / 100`.
 */
const tokensForPercent = (balance: bigint, percent: number): bigint => {
  if (percent >= 100) return balance;
  if (percent <= 0) return 0n;
  return (balance * BigInt(percent)) / 100n;
};

/**
 * Result of the LT-buffer preflight check.
 *
 * `kind: "ok"` — buffer comfortably covers the planned sell; submit as-is.
 *
 * `kind: "capped"` — buffer cannot cover the planned proceeds. The
 * handler must surface the reduced amount and require an explicit
 * confirm before submitting. Includes both the original target (so the
 * UX can show "reduced from $Y → $X") and the reduced token amount
 * pre-sized to fit under the buffer with `BUFFER_CAP_SAFETY` headroom.
 *
 * `kind: "below_min"` — even the buffer-capped sell would land under
 * `MIN_USDC_SELL_AMOUNT`. The handler must reject the trade outright
 * with the transient-replenish copy.
 *
 * `kind: "skipped"` — the LT address or buffer read was unavailable
 * (old api build with no `ltPair`, RPC blip). The handler falls back
 * to today's post-tx revert path: the sell submits and the user sees
 * `InsufficientBalance` mapped to the buffer-low copy in
 * `renderExecutionError`. Preflight is a UX improvement, not a
 * correctness gate.
 */
type BufferCheck =
  | { kind: "ok" }
  | {
      kind: "capped";
      reducedTokenAmount: bigint;
      reducedProceedsUsd: number;
      originalProceedsUsd: number;
      bufferUsd: number;
    }
  | { kind: "below_min"; bufferUsd: number; maxProceedsUsd: number }
  | { kind: "skipped" };

/**
 * Preflight the BounceTech LT idle-USDC buffer against the user's
 * expected proceeds. When `redeem(sellAmount) > baseAssetBalance()` the
 * on-chain tx reverts; this surfaces the cap before tx construction per
 * AGENTS.md "Error Handling → BounceTech buffer low".
 *
 * Scales the token amount linearly by the buffer-vs-proceeds ratio —
 * the curve's price impact is sub-linear, so the reduced amount is a
 * conservative under-estimate (real proceeds will be slightly higher).
 */
const previewBufferCap = async (
  env: AppContext["env"],
  ltAddress: string | null,
  tokenAmount: bigint,
  proceedsUsd: number,
): Promise<BufferCheck> => {
  if (!ltAddress || tokenAmount === 0n || proceedsUsd <= 0) {
    return { kind: "skipped" };
  }
  const bufferRaw = await fetchLtBaseAssetBalance(env, ltAddress);
  if (bufferRaw === null) return { kind: "skipped" };

  const bufferUsd = Number(bufferRaw) / 1_000_000;
  const requiredUsd = proceedsUsd * BUFFER_REQUIRED_FACTOR;
  if (bufferUsd >= requiredUsd) return { kind: "ok" };

  const reducedProceedsUsd = bufferUsd * BUFFER_CAP_SAFETY;
  if (reducedProceedsUsd < MIN_USDC_SELL_AMOUNT) {
    return { kind: "below_min", bufferUsd, maxProceedsUsd: reducedProceedsUsd };
  }
  // Scale tokenAmount × (reducedProceeds / originalProceeds). Use 1e6 ppm
  // precision — enough resolution for the largest plausible sell and
  // safely within bigint arithmetic.
  const ratioPpm = BigInt(
    Math.floor((reducedProceedsUsd / proceedsUsd) * 1_000_000),
  );
  const reducedTokenAmount = (tokenAmount * ratioPpm) / 1_000_000n;
  if (reducedTokenAmount === 0n) {
    return { kind: "below_min", bufferUsd, maxProceedsUsd: reducedProceedsUsd };
  }
  return {
    kind: "capped",
    reducedTokenAmount,
    reducedProceedsUsd,
    originalProceedsUsd: proceedsUsd,
    bufferUsd,
  };
};

/**
 * Result of resolving the user's max sell proceeds for pre-tx validation.
 * `source: "simulation"` is the authoritative path (issue #686); the
 * `"heuristic"` fallback preserves the pre-router behaviour for envs
 * where `BOT_FEE_ROUTER_ADDRESS` is unset (router not deployed yet) and
 * for transient sim failures. Returns `null` only when neither path can
 * yield an estimate — RPC down AND no `priceUsd` from the API.
 */
type SellQuote = { source: "simulation" | "heuristic"; proceedsUsd: number };

/**
 * Resolve the post-fee USDC proceeds for selling `tokenAmount`. Prefers
 * the `BotFeeRouter.sellWithBotFee` simulation per AGENTS.md `/sell`;
 * falls back to `priceUsd × balance × (1 − COMBINED_FEE_RATE)` when the
 * router is not configured or the sim reverts (e.g. user hasn't yet
 * approved the router for `transferFrom`; the eventual sell-tx path
 * handles approve/permit before submission).
 */
const quoteSellProceeds = async (
  env: AppContext["env"],
  tokenAddress: string,
  tokenAmount: bigint,
  traderAddress: string,
  priceUsd: number | null,
): Promise<SellQuote | null> => {
  if (tokenAmount > 0n) {
    const sim = await simulateSellWithBotFee(env, {
      token: tokenAddress as Hex,
      tokenAmount,
      trader: traderAddress as Hex,
    });
    if (sim.ok) {
      return {
        source: "simulation",
        proceedsUsd: usdcRawToNumber(sim.quotedUsdcOut),
      };
    }
    if (sim.kind !== "not_configured") {
      logger.warn("sellWithBotFee simulation failed", {
        kind: sim.kind,
        reason: sim.reason,
        tokenAddress,
      });
    }
  }
  if (priceUsd === null) return null;
  const holdingUsd = estimateHoldingUsdc(tokenAmount, priceUsd);
  return {
    source: "heuristic",
    proceedsUsd: holdingUsd * (1 - COMBINED_FEE_RATE),
  };
};

/**
 * Edit an origin bubble to show one of the prompt/retry texts. Mirrors
 * the buy.ts helper so the /sell wizard runs in the same start-menu
 * bubble the user tapped, rather than dropping a fresh prompt below it.
 */
const editOriginToPrompt = async (
  conversation: Conversation<AppContext, AppContext>,
  origin: MessageRef,
  text: string,
): Promise<boolean> =>
  conversation.external((outside) =>
    safeEditMessageById(outside, origin, text, {
      parse_mode: "HTML",
      reply_markup: backHomeMarkup(ctxLang(outside)),
      link_preview_options: { is_disabled: true },
    }),
  );

/**
 * Conversation: collect token address → show sell card with user's balance.
 * Loops on not-found / invalid input; aborts on API unavailability.
 *
 * When entered from a start-menu button tap, `origin` carries the
 * `(chatId, messageId)` of the bubble that already shows the prompt —
 * every step edits the same bubble so the flow stays in-place. With no
 * origin (slash entry), falls back to the legacy `replyWithNav` flow.
 */
const sellLookupConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  origin?: MessageRef,
): Promise<void> => {
  const lang = await convLang(conversation);
  await sweepWorkflow(conversation);

  // See `buyLookupConversation` for the rationale: the origin bubble
  // must NOT be tracked on the workflow stack until it is repurposed as
  // the card, otherwise the sweep on completion would delete the same
  // bubble the wizard is running inside.
  let activeOrigin: MessageRef | null = origin ?? null;

  if (!activeOrigin) {
    const promptMsg = await replyWithNav(ctx, PROMPT_HTML(lang), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    await trackWorkflowMessage(conversation, promptMsg.message_id);
  }

  const showRetry = async (msgCtx: AppContext, text: string): Promise<void> => {
    if (activeOrigin) {
      const edited = await editOriginToPrompt(conversation, activeOrigin, text);
      if (edited) return;
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
      await showRetry(msgCtx, TOKEN_NOT_FOUND_HTML(lang));
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
        await showRetry(msgCtx, TOKEN_NOT_FOUND_HTML(lang));
        continue;
      }
      // API unavailable — abort per AGENTS.md Error Handling
      await replyWithNav(msgCtx, API_UNAVAILABLE(lang));
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
    const tokenBalance =
      active && userId
        ? await conversation.external((outerCtx) =>
            fetchErc20Balance(outerCtx.env, token.address, active.address),
          )
        : null;

    const cardText = renderSellTokenCardText(token, tokenBalance, lang);
    const sellPresets = await conversation.external((outerCtx) =>
      normaliseSellPresets(outerCtx.session.sellPresetsPct),
    );
    const cardKeyboard = {
      inline_keyboard: buildSellTokenKeyboard(token.address, sellPresets, lang),
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
    await sweepWorkflow(conversation);
    // Push the card onto the now-empty stack so the post-trade sweep
    // in `confirmTrade` deletes it once the user's sell lands; the
    // card's mcap/balance are stale the moment the trade commits.
    await trackWorkflowMessage(conversation, cardMessageId);
    return;
  }
};

const isInt1to100 = (value: number): boolean =>
  Number.isFinite(value) && Number.isInteger(value) && value >= 1 && value <= 100;

const parsePercentInput = (raw: string): number | null => {
  // Strip a trailing % and whitespace; accept integer percent values
  // only — fractional percents would round to dust on small balances
  // and confuse the displayed receipt.
  const cleaned = raw.trim().replace(/%\s*$/, "").trim();
  if (cleaned === "") return null;
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return isInt1to100(n) ? n : null;
};

/**
 * Conversation: collect custom sell percentage (1–100%).
 * `tokenAddress` is passed via `ctx.conversation.enter("sell-custom", addr)`.
 */
const sellCustomConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  tokenAddress: string,
  origin?: MessageRef,
): Promise<void> => {
  const lang = await convLang(conversation);
  await sweepWorkflow(conversation);

  const promptText = t(SELL_CUSTOM_PERCENT_PROMPT, lang);

  // Edit-in-place when entered from a token-card tap; fall back to a
  // fresh reply otherwise (slash-entry / inline-mode without origin).
  let promptShown = false;
  if (origin) {
    promptShown = await conversation.external((outside) =>
      safeEditMessageById(outside, origin, promptText, {
        reply_markup: backHomeMarkup(ctxLang(outside)),
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

    const percent = parsePercentInput(text);
    if (percent === null) {
      const retry = await replyWithNav(
        msgCtx,
        t(SELL_CUSTOM_PERCENT_INVALID_REPLY, lang),
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }

    const outcome = await runPercentSell(
      conversation,
      msgCtx,
      tokenAddress,
      percent,
      origin,
    );
    // When `runPercentSell` staged the confirm card it tracked the
    // bubble for the post-trade sweep — sweeping here would delete
    // the staged card the user is about to tap Confirm on. Sweep
    // only on the non-staging exits (degen submit, early-out errors)
    // where there's no surviving final bubble to protect.
    if (!outcome.stagedFinal) {
      await sweepWorkflow(conversation);
    }
    return;
  }
};

/**
 * Result of `runPercentSell`. `stagedFinal: true` means the function
 * left a confirm bubble on the chat that must survive the caller's
 * post-flow sweep — the conversation wrapper checks this flag before
 * calling `sweepWorkflow`, otherwise the just-tracked staging bubble
 * would be deleted immediately (CodeRabbit #1009).
 */
type PercentSellResult = { stagedFinal: boolean };

/**
 * Shared percent-sell flow used by both the conversation custom path and
 * the inline button callback. Validates wallet/token/balance, runs the
 * proceeds + buffer preflight, and either submits in degen mode or
 * stages a confirm card.
 */
const runPercentSell = async (
  conversation: Conversation<AppContext, AppContext>,
  msgCtx: AppContext,
  tokenAddress: string,
  percent: number,
  origin?: MessageRef,
): Promise<PercentSellResult> => {
  const lang = await convLang(conversation);
  const userId = msgCtx.from?.id;
  const active = userId
    ? await conversation.external((outerCtx) =>
        buildManager(outerCtx.env).getActive(userId),
      )
    : null;
  if (!active) {
    await msgCtx.reply(t(NO_ACTIVE_WALLET_RUN_WALLET_REPLY, lang));
    return { stagedFinal: false };
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
    await replyWithNav(msgCtx, API_UNAVAILABLE(lang));
    return { stagedFinal: false };
  }

  const token = tokenResult.data;

  // Null balance = RPC unavailable; don't coerce to zero.
  if (tokenBalance === null) {
    await msgCtx.reply(t(SELL_UNABLE_TO_VERIFY_TOKEN_BALANCE_REPLY, lang));
    return { stagedFinal: false };
  }

  if (tokenBalance === 0n) {
    await msgCtx.reply(t(SELL_NO_BALANCE_REPLY, lang)(token.ticker));
    return { stagedFinal: false };
  }

  const tokenRaw = tokensForPercent(tokenBalance, percent);
  if (tokenRaw === 0n) {
    await msgCtx.reply(
      t(SELL_PERCENT_ROUNDS_TO_ZERO_TRY_LARGER_REPLY, lang)(
        percent,
        token.ticker,
      ),
    );
    return { stagedFinal: false };
  }

  const quote = await conversation.external((outerCtx) =>
    quoteSellProceeds(
      outerCtx.env,
      tokenAddress,
      tokenRaw,
      active.address,
      token.priceUsd,
    ),
  );
  if (quote === null) {
    await msgCtx.reply(PROCEEDS_UNAVAILABLE(lang));
    return { stagedFinal: false };
  }
  if (quote.proceedsUsd < MIN_USDC_SELL_AMOUNT) {
    await replyWithNav(
      msgCtx,
      t(SELL_PROCEEDS_BELOW_MIN_TRY_LARGER_REPLY, lang)(
        quote.proceedsUsd,
        MIN_USDC_SELL_AMOUNT,
      ),
    );
    return { stagedFinal: false };
  }

  const buffer = await conversation.external((outerCtx) =>
    previewBufferCap(
      outerCtx.env,
      token.ltPair,
      tokenRaw,
      quote.proceedsUsd,
    ),
  );
  if (buffer.kind === "below_min") {
    await msgCtx.reply(
      BUFFER_BELOW_MIN_HTML(buffer.maxProceedsUsd, lang),
      { parse_mode: "HTML" },
    );
    return { stagedFinal: false };
  }

  const effectiveTokenRaw =
    buffer.kind === "capped" ? buffer.reducedTokenAmount : tokenRaw;
  const effectiveProceedsUsd =
    buffer.kind === "capped" ? buffer.reducedProceedsUsd : quote.proceedsUsd;

  const degenMode = await conversation.external(
    (outerCtx): boolean => outerCtx.session.degenMode,
  );
  // AGENTS.md "Buffer-limited sells must be user-visible. Never silently
  // cap — show max available and require confirmation of the reduced
  // amount." Degen mode skips the confirm step on the happy path only;
  // a buffer-capped sell still requires an explicit confirm tap.
  if (degenMode && buffer.kind !== "capped") {
    const description = describeTradeForStatus(
      "sell",
      token.ticker,
      effectiveTokenRaw,
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
          side: "sell",
          description,
          run: () =>
            submitSell({
              ctx: outerCtx,
              token: token.address,
              ticker: token.ticker,
              tokenRaw: effectiveTokenRaw,
            }),
        }),
      );
    } else {
      // No resolvable chat id (rare — inline-mode / channel post).
      // Submit the trade directly and reply with the receipt rather
      // than leaving the user on a status prompt that never updates.
      const outcome = await conversation.external((outerCtx) =>
        submitSell({
          ctx: outerCtx,
          token: token.address,
          ticker: token.ticker,
          tokenRaw: effectiveTokenRaw,
        }),
      );
      await replyConfirmedTradeAndPromptStart(msgCtx, outcome);
    }
    // Degen path's status bubble was sent fresh and never tracked on
    // the workflow stack, so the caller's sweep won't touch it — safe
    // to flag this as "no staged final" and let the wizard sweep
    // intermediate prompts.
    return { stagedFinal: false };
  }

  const { nonce } = await conversation.external(
    (outerCtx): { nonce: string } =>
      stageSell({
        ctx: outerCtx,
        token: token.address,
        ticker: token.ticker,
        tokenRaw: effectiveTokenRaw,
      }),
  );
  const tickerSafe = escapeHtml(token.ticker);
  const tokenSafe = escapeHtml(token.address);
  const tokenLine =
    `\n\nToken: <a href="${trackingPageUrl(token.address)}">${tickerSafe}</a> <code>${tokenSafe}</code>`;
  const header =
    buffer.kind === "capped"
      ? t(SELL_STAGING_BUFFER_CAPPED_HTML, lang)(
          effectiveProceedsUsd,
          quote.proceedsUsd,
          percent,
          tokenLine,
        )
      : t(SELL_STAGING_READY_HTML, lang)(
          percent,
          tickerSafe,
          effectiveProceedsUsd,
          tokenLine,
        );
  const stagingMarkup = { inline_keyboard: confirmKeyboard(nonce, lang) };

  // Edit the originating token-detail card into the staging bubble so
  // the wizard runs in a single bubble; fall back to a fresh reply if
  // the origin is gone (deleted, > 48h, no origin threaded).
  let stagingMessageId: number | null = null;
  if (origin) {
    const edited = await conversation.external((outside) =>
      safeEditMessageById(outside, origin, header, {
        parse_mode: "HTML",
        reply_markup: stagingMarkup,
        link_preview_options: { is_disabled: true },
      }),
    );
    if (edited) stagingMessageId = origin.messageId;
  }
  if (stagingMessageId === null) {
    const stagingMsg = await msgCtx.reply(header, {
      parse_mode: "HTML",
      reply_markup: stagingMarkup,
      link_preview_options: { is_disabled: true },
    });
    stagingMessageId = stagingMsg.message_id;
  }
  // Sweep wizard prompts BEFORE tracking the staging bubble so the
  // caller's post-flow sweep can't delete the just-staged bubble. The
  // staging msg is the only thing we want to live past the wizard
  // exit; everything else (address-prompt history, retry copy) is
  // already swept here.
  await sweepWorkflow(conversation);
  // Staging prompt is stale once the trade lands — push so the
  // post-trade sweep (run inside `confirmTrade` after a receipt-
  // confirmed success) clears it. The Tx-status flow detaches it
  // before editing in place with the receipt, so the receipt survives.
  await trackWorkflowMessage(conversation, stagingMessageId);
  return { stagedFinal: true };
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

  const lang = ctxLang(ctx);
  if (!tokenResult.ok) {
    await ctx.answerCallbackQuery({
      text: API_UNAVAILABLE(lang),
      show_alert: true,
    });
    return;
  }

  const cardText = renderSellTokenCardText(tokenResult.data, tokenBalance, lang);
  await safeEditMessageText(ctx, cardText, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: buildSellTokenKeyboard(
        tokenAddress,
        normaliseSellPresets(ctx.session.sellPresetsPct),
        lang,
      ),
    },
    link_preview_options: { is_disabled: true },
  });
  await ctx.answerCallbackQuery({ text: t(TOAST_REFRESHED, lang) });
};

/**
 * Validate holding then show confirmation (or submit, in degen mode) for
 * a percentage-of-balance sell triggered by an inline keyboard tap.
 */
const handlePercentSell = async (
  ctx: AppContext,
  tokenAddress: string,
  percent: number,
): Promise<void> => {
  const lang = ctxLang(ctx);
  if (!ctx.from) {
    await ctx.answerCallbackQuery();
    return;
  }
  const wm = buildManager(ctx.env);
  const active = await wm.getActive(ctx.from.id);
  if (!active) {
    await ctx.answerCallbackQuery({
      text: t(TOAST_NO_ACTIVE_WALLET_RUN_WALLET, lang),
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
      text: API_UNAVAILABLE(lang),
      show_alert: true,
    });
    return;
  }

  const token = tokenResult.data;

  // Null balance = RPC unavailable; don't coerce to zero.
  if (tokenBalance === null) {
    await ctx.answerCallbackQuery({
      text: t(TOAST_UNABLE_TO_VERIFY_TOKEN_BALANCE, lang),
      show_alert: true,
    });
    return;
  }

  if (tokenBalance === 0n) {
    await ctx.answerCallbackQuery({
      text: t(SELL_NO_BALANCE_REPLY, lang)(token.ticker),
      show_alert: true,
    });
    return;
  }

  const tokenRaw = tokensForPercent(tokenBalance, percent);
  if (tokenRaw === 0n) {
    await ctx.answerCallbackQuery({
      text: t(SELL_PERCENT_ROUNDS_TO_ZERO_REPLY, lang)(percent, token.ticker),
      show_alert: true,
    });
    return;
  }

  const quote = await quoteSellProceeds(
    ctx.env,
    tokenAddress,
    tokenRaw,
    active.address,
    token.priceUsd,
  );
  if (quote === null) {
    await ctx.answerCallbackQuery({
      text: PROCEEDS_UNAVAILABLE(lang),
      show_alert: true,
    });
    return;
  }
  if (quote.proceedsUsd < MIN_USDC_SELL_AMOUNT) {
    await ctx.answerCallbackQuery({
      text: t(SELL_PROCEEDS_BELOW_MIN_REPLY, lang)(
        quote.proceedsUsd,
        MIN_USDC_SELL_AMOUNT,
      ),
      show_alert: true,
    });
    return;
  }

  const buffer = await previewBufferCap(
    ctx.env,
    token.ltPair,
    tokenRaw,
    quote.proceedsUsd,
  );
  if (buffer.kind === "below_min") {
    await ctx.answerCallbackQuery({
      text: t(SELL_LT_BUFFER_TOO_LOW_REPLY, lang)(
        buffer.maxProceedsUsd,
        MIN_USDC_SELL_AMOUNT,
      ),
      show_alert: true,
    });
    return;
  }
  const effectiveTokenRaw =
    buffer.kind === "capped" ? buffer.reducedTokenAmount : tokenRaw;
  const effectiveProceedsUsd =
    buffer.kind === "capped" ? buffer.reducedProceedsUsd : quote.proceedsUsd;

  // Buffer-capped sells always require explicit confirm per AGENTS.md;
  // degen only skips the confirm step on the happy path.
  if (ctx.session.degenMode && buffer.kind !== "capped") {
    await ctx.answerCallbackQuery({ text: t(TOAST_SUBMITTING_ZAP, lang) });
    const cbMsg = ctx.callbackQuery?.message;
    if (cbMsg) {
      await runWithTxStatusUpdates({
        ctx,
        target: {
          api: ctx.api,
          chatId: cbMsg.chat.id,
          messageId: cbMsg.message_id,
        },
        side: "sell",
        description: describeTradeForStatus(
          "sell",
          token.ticker,
          effectiveTokenRaw,
        ),
        run: () =>
          submitSell({
            ctx,
            token: token.address,
            ticker: token.ticker,
            tokenRaw: effectiveTokenRaw,
          }),
      });
      return;
    }
    const outcome = await submitSell({
      ctx,
      token: token.address,
      ticker: token.ticker,
      tokenRaw: effectiveTokenRaw,
    });
    await replyConfirmedTradeAndPromptStart(ctx, outcome);
    return;
  }
  await ctx.answerCallbackQuery();
  const { nonce } = stageSell({
    ctx,
    token: token.address,
    ticker: token.ticker,
    tokenRaw: effectiveTokenRaw,
  });
  const totalBalanceFormatted = formatToken18(tokenBalance);
  const allOf =
    percent === 100 ? t(SELL_PRESET_ALL_OF_SUFFIX, lang)(totalBalanceFormatted) : "";
  const tickerSafe = escapeHtml(token.ticker);
  const tokenSafe = escapeHtml(token.address);
  const tokenLine =
    `\n\nToken: <a href="${trackingPageUrl(token.address)}">${tickerSafe}</a> <code>${tokenSafe}</code>`;
  const header =
    buffer.kind === "capped"
      ? t(SELL_STAGING_BUFFER_CAPPED_PRESET_HTML, lang)(
          effectiveProceedsUsd,
          quote.proceedsUsd,
          percent,
          formatToken18(effectiveTokenRaw),
          totalBalanceFormatted,
          tickerSafe,
          tokenLine,
        )
      : t(SELL_STAGING_READY_PRESET_HTML, lang)(
          percent,
          allOf,
          tickerSafe,
          effectiveProceedsUsd,
          tokenLine,
        );
  const stagingMarkup = { inline_keyboard: confirmKeyboard(nonce, lang) };

  // Edit the token-detail card into the staging bubble in place rather
  // than dropping a fresh staging prompt below it. `cnf:` / `ccl:`
  // target the bubble the user tapped Confirm on, so the edited bubble
  // works identically through the confirm flow.
  const cbMsg = ctx.callbackQuery?.message;
  let stagingMessageId: number | null = null;
  if (cbMsg) {
    try {
      await safeEditMessageText(ctx, header, {
        parse_mode: "HTML",
        reply_markup: stagingMarkup,
        link_preview_options: { is_disabled: true },
      });
      stagingMessageId = cbMsg.message_id;
    } catch (err) {
      logger.debug("sell preset: edit-in-place failed, sending fresh", { err });
    }
  }
  if (stagingMessageId === null) {
    const stagingMsg = await ctx.reply(header, {
      parse_mode: "HTML",
      reply_markup: stagingMarkup,
      link_preview_options: { is_disabled: true },
    });
    stagingMessageId = stagingMsg.message_id;
  }
  trackForPostTradeSweep(ctx, stagingMessageId);
};

export const registerSellCommand = (bot: Bot<AppContext>): void => {
  bot.use(
    createConversation(
      sellLookupConversation as (
        conv: Conversation<AppContext, AppContext>,
        ctx: AppContext,
        ...args: unknown[]
      ) => Promise<void>,
      { id: "sell-lookup", parallel: true },
    ),
  );
  bot.use(
    createConversation(
      sellCustomConversation as (
        conv: Conversation<AppContext, AppContext>,
        ctx: AppContext,
        ...args: unknown[]
      ) => Promise<void>,
      { id: "sell-custom", parallel: true },
    ),
  );

  // Start menu "Sell" button — edit the start bubble into the address
  // prompt and thread that bubble id through the wizard so every step
  // edits the same bubble (rather than dropping a new prompt below the
  // still-visible start menu).
  bot.callbackQuery(START_CALLBACK.sell, async (ctx) => {
    const lang = ctxLang(ctx);
    const result = await editToSubmenu(ctx, {
      text: PROMPT_HTML(lang),
      parseMode: "HTML",
      inlineKeyboard: [backHomeRow(lang)],
      linkPreviewDisabled: true,
    });
    await ctx.answerCallbackQuery();
    const origin: MessageRef | undefined =
      ctx.chat && result.editedMessageId !== undefined
        ? { chatId: ctx.chat.id, messageId: result.editedMessageId }
        : undefined;
    await ctx.conversation.enter("sell-lookup", origin);
  });

  // /sell command — slash entry has no parent bubble to edit, so it
  // falls through to the legacy `replyWithNav` prompt inside the
  // conversation when no origin is passed.
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
    // Mirror track.ts / positions.ts — an unhandled throw used to
    // log-and-swallow with no ACK, leaving the client spinner stuck
    // until Telegram's 30s timeout. Surface the outage via
    // answerCallbackQuery so the press is visibly resolved.
    await handleSellRefresh(ctx, parsed.args[0]).catch(async (err) => {
      logger.error("sell refresh failed", { err });
      await ctx
        .answerCallbackQuery({ text: API_UNAVAILABLE(ctxLang(ctx)), show_alert: true })
        .catch(() => {});
    });
  });

  // Sell N% — percent is encoded as the second arg of the
  // `btsp:<addr>:<percent>` callback. Validated as an integer in
  // [1, 100] (issue #818 widened this from the old fixed-preset set
  // because the keyboard now renders from the user's customised
  // /settings list); out-of-range or non-integer payloads are dropped
  // as malformed so a crafted callback can't bypass the validator.
  bot.callbackQuery(/^btsp:/, async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    const tokenAddress = parsed?.args[0];
    const percentRaw = parsed?.args[1];
    if (!tokenAddress || !percentRaw) {
      await ctx.answerCallbackQuery();
      return;
    }
    const percent = Number(percentRaw);
    if (!isSellPercent(percent)) {
      await ctx.answerCallbackQuery();
      return;
    }
    await handlePercentSell(ctx, tokenAddress, percent).catch(async (err) => {
      logger.error("sell percent handler failed", { err, percent });
      await ctx
        .answerCallbackQuery({ text: API_UNAVAILABLE(ctxLang(ctx)), show_alert: true })
        .catch(() => {});
    });
  });

  // Sell X% — enter custom-percent conversation. Pass the token-detail
  // card as the wizard's origin so every step edits that same bubble
  // instead of stacking new prompts below it.
  bot.callbackQuery(/^btspx:/, async (ctx) => {
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
    await ctx.conversation.enter("sell-custom", parsed.args[0], origin);
  });
};

