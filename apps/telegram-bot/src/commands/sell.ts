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
  isCancel,
  isOtherSlashCommand,
} from "../lib/conversation-commands.js";
import {
  confirmKeyboard,
  renderConfirmReply,
  stageSell,
  submitSell,
} from "../lib/execute.js";
import { logger } from "../lib/logger.js";
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

/**
 * Shown when both the `BotFeeRouter` simulation and the priceUsd
 * heuristic come back empty (sim reverted/unavailable + no indexer
 * price). Fail-closed: never confirm a sell whose proceeds we cannot
 * estimate, since `MIN_USDC_SELL_AMOUNT` would otherwise be silently
 * bypassed. Surfaces the same retry copy AGENTS.md uses for the
 * upstream-unavailable case.
 */
const PROCEEDS_UNAVAILABLE =
  "Unable to estimate proceeds right now — please try again in a moment.";

/**
 * Shown when the LT's idle USDC buffer would not even support the
 * `MIN_USDC_SELL_AMOUNT` floor. The user has to wait for BounceTech's
 * automation layer to replenish the buffer (~10s per AGENTS.md). Same
 * tone as the buffer-low confirm copy so the user understands this is
 * transient.
 */
const BUFFER_BELOW_MIN_HTML = (maxUsd: number): string =>
  `❌ <b>LT buffer too low to sell.</b>\n\n` +
  `Max sell right now is ≈$${maxUsd.toFixed(2)}, which is below the $${MIN_USDC_SELL_AMOUNT} minimum. ` +
  `BounceTech replenishes the buffer in ~10s — try again shortly.`;

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
 * Conversation: collect token address → show sell card with user's balance.
 * Loops on not-found / invalid input; aborts on API unavailability.
 */
const sellLookupConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
): Promise<void> => {
  await sweepWorkflow(conversation);

  const promptMsg = await ctx.reply(PROMPT_HTML, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
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
    const tokenBalance =
      active && userId
        ? await conversation.external((outerCtx) =>
            fetchErc20Balance(outerCtx.env, token.address, active.address),
          )
        : null;

    const cardText = renderSellTokenCardText(token, tokenBalance);
    const sellPresets = await conversation.external((outerCtx) =>
      normaliseSellPresets(outerCtx.session.sellPresetsPct),
    );
    const cardMsg = await msgCtx.reply(cardText, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: buildSellTokenKeyboard(token.address, sellPresets),
      },
      link_preview_options: { is_disabled: true },
    });
    await sweepWorkflow(conversation);
    // Push the card onto the now-empty stack so the post-trade sweep
    // in `confirmTrade` deletes it once the user's sell lands; the
    // card's mcap/balance are stale the moment the trade commits.
    await trackWorkflowMessage(conversation, cardMsg.message_id);
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
): Promise<void> => {
  await sweepWorkflow(conversation);

  const promptMsg = await ctx.reply(
    "Enter a percent of your position to sell (1–100):\n\nSend /cancel to exit.",
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

    const percent = parsePercentInput(text);
    if (percent === null) {
      const retry = await msgCtx.reply(
        "Please enter a whole number between 1 and 100 (e.g. 35).",
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }

    await runPercentSell(conversation, msgCtx, tokenAddress, percent);
    await sweepWorkflow(conversation);
    return;
  }
};

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
): Promise<void> => {
  const userId = msgCtx.from?.id;
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
    return;
  }

  if (tokenBalance === 0n) {
    await msgCtx.reply(`You hold no ${token.ticker}.`);
    return;
  }

  const tokenRaw = tokensForPercent(tokenBalance, percent);
  if (tokenRaw === 0n) {
    await msgCtx.reply(
      `${percent}% of your ${token.ticker} balance rounds to zero — try a larger percent.`,
    );
    return;
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
    await msgCtx.reply(PROCEEDS_UNAVAILABLE);
    return;
  }
  if (quote.proceedsUsd < MIN_USDC_SELL_AMOUNT) {
    await msgCtx.reply(
      `Estimated proceeds ≈$${quote.proceedsUsd.toFixed(2)} would be below the $${MIN_USDC_SELL_AMOUNT} minimum. Increase the percent or send /cancel.`,
    );
    return;
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
    await msgCtx.reply(BUFFER_BELOW_MIN_HTML(buffer.maxProceedsUsd), {
      parse_mode: "HTML",
    });
    return;
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
    await msgCtx.reply(
      `⚡ <b>Degen mode — submitting ${percent}% sell of ${token.ticker} (≈$${effectiveProceedsUsd.toFixed(2)})…</b>`,
      { parse_mode: "HTML" },
    );
    const outcome = await conversation.external((outerCtx) =>
      submitSell({
        ctx: outerCtx,
        token: token.address,
        ticker: token.ticker,
        tokenRaw: effectiveTokenRaw,
      }),
    );
    await msgCtx.reply(renderConfirmReply(outcome), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    return;
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
  const header =
    buffer.kind === "capped"
      ? `⚠️ <b>Buffer low — capping sell at $${effectiveProceedsUsd.toFixed(2)}</b> ` +
        `(reduced from ≈$${quote.proceedsUsd.toFixed(2)} for ${percent}%).\n` +
        `Buffer replenishes in ~10s; sell in chunks for the remainder.\n\n` +
        `Tap <b>Confirm</b> within 60s to submit the reduced amount.`
      : `✅ <b>Ready to sell ${percent}% of ${token.ticker} (≈$${effectiveProceedsUsd.toFixed(2)})</b>\n\n` +
        `Tap <b>Confirm</b> within 60s to submit.`;
  const stagingMsg = await msgCtx.reply(header, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: confirmKeyboard(nonce) },
  });
  // Staging prompt is stale once the trade lands — push so the
  // post-trade sweep clears it alongside the originating card.
  await trackWorkflowMessage(conversation, stagingMsg.message_id);
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
    reply_markup: {
      inline_keyboard: buildSellTokenKeyboard(
        tokenAddress,
        normaliseSellPresets(ctx.session.sellPresetsPct),
      ),
    },
    link_preview_options: { is_disabled: true },
  });
  await ctx.answerCallbackQuery({ text: "Refreshed" });
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

  const tokenRaw = tokensForPercent(tokenBalance, percent);
  if (tokenRaw === 0n) {
    await ctx.answerCallbackQuery({
      text: `${percent}% of your ${token.ticker} balance rounds to zero.`,
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
      text: PROCEEDS_UNAVAILABLE,
      show_alert: true,
    });
    return;
  }
  if (quote.proceedsUsd < MIN_USDC_SELL_AMOUNT) {
    await ctx.answerCallbackQuery({
      text: `Estimated proceeds ≈$${quote.proceedsUsd.toFixed(2)} would be below the $${MIN_USDC_SELL_AMOUNT} minimum.`,
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
      text: `LT buffer too low — max sell ≈$${buffer.maxProceedsUsd.toFixed(2)} < $${MIN_USDC_SELL_AMOUNT} min. Retry in ~10s.`,
      show_alert: true,
    });
    return;
  }
  const effectiveTokenRaw =
    buffer.kind === "capped" ? buffer.reducedTokenAmount : tokenRaw;
  const effectiveProceedsUsd =
    buffer.kind === "capped" ? buffer.reducedProceedsUsd : quote.proceedsUsd;

  // Track the token-detail card the user just tapped on so the
  // post-trade sweep clears it once the sell commits.
  if (ctx.callbackQuery?.message) {
    trackForPostTradeSweep(ctx, ctx.callbackQuery.message.message_id);
  }

  // Buffer-capped sells always require explicit confirm per AGENTS.md;
  // degen only skips the confirm step on the happy path.
  if (ctx.session.degenMode && buffer.kind !== "capped") {
    await ctx.answerCallbackQuery({ text: "⚡ Submitting…" });
    const outcome = await submitSell({
      ctx,
      token: token.address,
      ticker: token.ticker,
      tokenRaw: effectiveTokenRaw,
    });
    await ctx.reply(renderConfirmReply(outcome), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    return;
  }
  await ctx.answerCallbackQuery();
  const { nonce } = stageSell({
    ctx,
    token: token.address,
    ticker: token.ticker,
    tokenRaw: effectiveTokenRaw,
  });
  const allOf = percent === 100 ? ` all ${formatToken18(tokenBalance)}` : "";
  const header =
    buffer.kind === "capped"
      ? `⚠️ <b>Buffer low — capping sell at $${effectiveProceedsUsd.toFixed(2)}</b> ` +
        `(reduced from ≈$${quote.proceedsUsd.toFixed(2)} for ${percent}%).\n` +
        `Selling ${formatToken18(effectiveTokenRaw)} of ${formatToken18(tokenBalance)} ${token.ticker}. ` +
        `Buffer replenishes in ~10s; sell in chunks for the remainder.\n\n` +
        `Tap <b>Confirm</b> within 60s to submit the reduced amount.`
      : `✅ <b>Ready to sell ${percent}%${allOf} of ${token.ticker} (≈$${effectiveProceedsUsd.toFixed(2)})</b>\n\n` +
        `Tap <b>Confirm</b> within 60s to submit.`;
  const stagingMsg = await ctx.reply(header, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: confirmKeyboard(nonce) },
  });
  trackForPostTradeSweep(ctx, stagingMsg.message_id);
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
    // Mirror track.ts / positions.ts — an unhandled throw used to
    // log-and-swallow with no ACK, leaving the client spinner stuck
    // until Telegram's 30s timeout. Surface the outage via
    // answerCallbackQuery so the press is visibly resolved.
    await handleSellRefresh(ctx, parsed.args[0]).catch(async (err) => {
      logger.error("sell refresh failed", { err });
      await ctx
        .answerCallbackQuery({ text: API_UNAVAILABLE, show_alert: true })
        .catch(() => {});
    });
  });

  // Sell 10% / 25% / 50% / 100% — percent is encoded as the second arg
  // of the `btsp:<addr>:<percent>` callback. Only the four preset
  // percents are accepted; anything else is dropped as a malformed
  // payload (would otherwise let a crafted callback bypass the
  // keyboard's percent set).
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
        .answerCallbackQuery({ text: API_UNAVAILABLE, show_alert: true })
        .catch(() => {});
    });
  });

  // Sell X% — enter custom-percent conversation
  bot.callbackQuery(/^btspx:/, async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    if (!parsed?.args[0]) {
      await ctx.answerCallbackQuery();
      return;
    }
    // Push the originating token-detail card onto the workflow stack
    // before entering the wizard, so the post-trade sweep deletes it
    // once the user's eventual sell lands.
    if (ctx.callbackQuery.message) {
      trackForPostTradeSweep(ctx, ctx.callbackQuery.message.message_id);
    }
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("sell-custom", parsed.args[0]);
  });
};

