import {
  type Conversation,
  createConversation,
} from "@grammyjs/conversations";
import { InputFile, type Bot } from "grammy";

import type { AppContext } from "../bot.js";
import {
  buildBuyTokenKeyboard,
  buildSellTokenKeyboard,
  normaliseBuyPresets,
  normaliseSellPresets,
} from "../keyboards/buy-sell-token.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import type { InlineKeyboard } from "../keyboards/wallet-actions.js";
import {
  extractTokenAddress,
  fetchToken,
  fetchTrades,
  type Trade,
  type TokenInfo,
} from "../lib/api.js";
import { encodeCallback, parseCallback } from "../lib/callbacks.js";
import {
  haltAndForward,
  isOtherSlashCommand,
} from "../lib/conversation-commands.js";
import { buildTrackChartPng } from "../lib/chart.js";
import { logger } from "../lib/logger.js";
import {
  backHomeMarkup,
  backHomeRow,
  editToSubmenu,
  type MessageRef,
  replyWithNav,
  safeEditMessageById,
} from "../lib/nav.js";
import { fetchErc20Balance, fetchUsdcBalance } from "../lib/rpc.js";
import {
  formatToken18,
  formatUsdc6,
  renderBuyTokenCardText,
  renderSellTokenCardText,
  renderTrackTokenCardText,
} from "../lib/token-card.js";
import { WalletManager } from "../lib/wallet.js";
import { pushWorkflowMessage } from "../lib/workflow-stack.js";
import {
  sweepWorkflow,
  trackWorkflowMessage,
} from "../lib/workflow-stack-conversation.js";

/** Number of trades shown under the token card per AGENTS.md /track spec. */
const TRADES_PER_CARD = 20;

/**
 * Telegram photo-caption budget — 1024 visible chars after HTML entity
 * parsing (see https://core.telegram.org/bots/api#sendphoto). The /track
 * payload is sent as a single photo+caption message when the chart
 * renders, so the card + trade rows must fit inside this envelope. When
 * the full body overflows we shed trade rows (oldest first via slice)
 * until it fits — the chart is the headline, losing tail trades is
 * acceptable, losing the chart isn't.
 */
const CAPTION_BUDGET = 1024;

/**
 * Upper bound on how long we'll wait for the chart image before sending
 * the /track text reply without it. The renderer fans out to an HTTP
 * fetch + a wasm-backed PNG conversion, either of which can blow past
 * the user's perception threshold on a cold-isolate Worker. Capping the
 * wait keeps the text card responsive — a missing chart is recoverable
 * (user can refresh), a multi-second silent /track is not.
 */
const CHART_TIMEOUT_MS = 5_000;

const ALT_FUN_TOKEN_BASE = "https://alt.fun/token";

/**
 * Short callback codes scoped to /track. `trkb` and `trks` carry a
 * token address (8+1+42=51 bytes, safely under the 64-byte budget).
 */
const TRACK_CMD = {
  buy: "trkb",
  sell: "trks",
} as const;

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

const buildManager = (env: AppContext["env"]): WalletManager =>
  new WalletManager(env.WALLET_KV, env.MASTER_KEY);

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const shortAddress = (addr: string): string =>
  addr.length >= 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;

/**
 * Render a single trade row. USDC amounts are formatted off the raw
 * 6-decimal string so we never lose precision through Number coercion
 * for the larger trades on the curve. The trader address is HTML-escaped
 * before interpolation — Telegram parses replies as HTML and a stray
 * `<` from a malformed indexer payload would otherwise drop the entire
 * message with a 400.
 */
const renderTradeRow = (trade: Trade, nowSec: number): string => {
  const trader = escapeHtml(shortAddress(trade.trader));
  let usdc: bigint;
  let tokens: bigint;
  try {
    usdc = BigInt(trade.usdcAmount);
    tokens = BigInt(trade.tokenAmount);
  } catch {
    // Malformed numeric strings would otherwise crash the formatter and
    // strand a whole /track view over one bad row. Skip the amount but
    // keep the row so the user still sees the trade happened.
    return `${trade.isBuy ? "🟢 BUY" : "🔴 SELL"} • ${trader} • —`;
  }
  const tsSec = Number.parseInt(trade.timestamp, 10);
  const rel = Number.isFinite(tsSec) ? formatRelative(nowSec - tsSec) : "—";
  const side = trade.isBuy ? "🟢 BUY" : "🔴 SELL";
  return `${side} ${formatUsdc6(usdc)} (${formatToken18(tokens)}) • ${trader} • ${rel}`;
};

/** Relative-time formatter for trade rows. Caps at days for older entries. */
const formatRelative = (deltaSec: number): string => {
  if (!Number.isFinite(deltaSec) || deltaSec < 0) return "just now";
  if (deltaSec < 60) return `${Math.floor(deltaSec)}s ago`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86_400)}d ago`;
};

/**
 * Compose the full /track HTML body: token card + recent trades. Kept
 * pure (no ctx, no fetches) so it can be exercised directly from tests
 * without the grammY harness. `maxTrades` caps the number of rows so
 * callers can render a shorter body that fits the photo-caption budget
 * (defaults to the full `TRADES_PER_CARD` for the text path).
 */
export const renderTrackBody = (
  token: TokenInfo,
  trades: Trade[],
  nowSec: number = Math.floor(Date.now() / 1000),
  maxTrades: number = TRADES_PER_CARD,
): string => {
  const card = renderTrackTokenCardText(token);
  const capped = trades.slice(0, Math.max(0, maxTrades));
  if (capped.length === 0) {
    return `${card}\n\n<b>Recent trades</b>\n<i>No trades yet.</i>`;
  }
  const rows = capped
    .map((t) => renderTradeRow(t, nowSec))
    .join("\n");
  return `${card}\n\n<b>Recent trades</b>\n${rows}`;
};

/**
 * Count visible chars after Telegram's HTML-entity parser strips tags
 * and decodes the three escaped entities we emit (`&amp;`, `&lt;`,
 * `&gt;`). Mirrors the budget Telegram applies to photo captions so we
 * can fit-test a candidate body before issuing `sendPhoto`.
 */
const countVisibleChars = (html: string): number =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .length;

/**
 * Render the /track body for the photo-caption path: starts at the
 * full trade count and sheds rows until the visible-char count fits
 * within `CAPTION_BUDGET`. The card alone is well under the budget on
 * every observed token, so this loop always terminates with at least
 * the card rendered.
 */
export const renderTrackCaption = (
  token: TokenInfo,
  trades: Trade[],
  nowSec: number = Math.floor(Date.now() / 1000),
): string => {
  for (let n = Math.min(trades.length, TRADES_PER_CARD); n >= 0; n--) {
    const body = renderTrackBody(token, trades, nowSec, n);
    if (countVisibleChars(body) <= CAPTION_BUDGET) return body;
  }
  // Even the no-trades card overflows (pathological — would require a
  // token name + status string > 1KB). Return it anyway; Telegram will
  // reject and the caller logs + falls back to the text send path.
  return renderTrackBody(token, [], nowSec, 0);
};

const buildTrackKeyboard = (tokenAddress: string): InlineKeyboard => [
  [
    {
      text: "Buy →",
      callback_data: encodeCallback(TRACK_CMD.buy, tokenAddress),
    },
    {
      text: "Sell →",
      callback_data: encodeCallback(TRACK_CMD.sell, tokenAddress),
    },
  ],
  [
    {
      text: "Open on Alt Fun",
      url: `${ALT_FUN_TOKEN_BASE}/${tokenAddress}`,
    },
  ],
  backHomeRow(),
];

interface TrackRender {
  /** Full body for the text-only path (chart unavailable). */
  text: string;
  /** Trimmed body for the photo-caption path (≤ Telegram caption budget). */
  caption: string;
  keyboard: InlineKeyboard;
  chartPng: Uint8Array | null;
  tokenName: string;
}

/**
 * Fetch token + trades and assemble the rendered /track payload.
 * Returns a typed outcome instead of throwing so callers can decide
 * how to surface each failure mode (toast vs. reply).
 */
const buildTrack = async (
  env: AppContext["env"],
  address: string,
): Promise<
  | { ok: true; render: TrackRender }
  | { ok: false; kind: "not_found" | "unavailable" }
> => {
  const tokenResult = await fetchToken(env, address);
  if (!tokenResult.ok) {
    if (
      tokenResult.kind === "not_found" ||
      tokenResult.kind === "invalid_address"
    ) {
      return { ok: false, kind: "not_found" };
    }
    return { ok: false, kind: "unavailable" };
  }
  // Trades + chart failures degrade gracefully — the token card is
  // still useful on its own. Trades run in parallel with a *bounded*
  // chart render: the chart promise races a `CHART_TIMEOUT_MS` timeout
  // so a slow wasm-init or upstream `/chart` fetch can't gate the
  // text reply (CodeRabbit #731). Chart errors are swallowed inside
  // `buildTrackChartPng` for the same reason — the user always gets
  // the text card.
  const chartPromise: Promise<Uint8Array | null> = Promise.race([
    buildTrackChartPng(env, address, tokenResult.data.name),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), CHART_TIMEOUT_MS)),
  ]);
  const [tradesResult, chartPng] = await Promise.all([
    fetchTrades(env, address, TRADES_PER_CARD),
    chartPromise,
  ]);
  const trades = tradesResult.ok ? tradesResult.data : [];
  return {
    ok: true,
    render: {
      text: renderTrackBody(tokenResult.data, trades),
      caption: renderTrackCaption(tokenResult.data, trades),
      keyboard: buildTrackKeyboard(tokenResult.data.address),
      chartPng,
      tokenName: tokenResult.data.name,
    },
  };
};

/**
 * Edit an origin bubble to one of the prompt/retry texts. Mirrors the
 * buy/sell variant so /track's start-menu entry runs in the same bubble
 * the user tapped, rather than dropping a fresh prompt below it.
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
 * Conversation: collect token address → render /track view. Mirrors
 * the /buy and /sell lookup flow so the prompt copy and cancel
 * semantics are identical across commands.
 *
 * When `origin` is provided the wizard runs inside the start-menu
 * bubble: prompt + retry texts edit the same bubble in place, and the
 * final text card edits it one last time. The chart photo (if any) is
 * still sent as a separate Telegram message because edit-from-text-to-
 * photo isn't supported in this bubble shape.
 */
const trackLookupConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  origin?: MessageRef,
): Promise<void> => {
  await sweepWorkflow(conversation);

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

    const result = await conversation.external((outerCtx) =>
      buildTrack(outerCtx.env, addr),
    );
    if (!result.ok) {
      if (result.kind === "not_found") {
        await showRetry(msgCtx, TOKEN_NOT_FOUND_HTML);
        continue;
      }
      await msgCtx.reply(API_UNAVAILABLE);
      await sweepWorkflow(conversation);
      return;
    }
    if (activeOrigin) {
      if (result.render.chartPng) {
        // Bubble type can't change from text to photo via
        // editMessageText, so when the chart renders we delete the
        // origin and send the merged photo+caption message as a fresh
        // reply. The delete failure mode is benign (origin gone, edit
        // window expired) — `sendTrackReply` still lands the merged
        // message either way.
        const ref = activeOrigin;
        await conversation.external(async (outside) => {
          try {
            await outside.api.deleteMessage(ref.chatId, ref.messageId);
          } catch (err) {
            logger.debug("track: origin delete before photo failed", { err });
          }
        });
        await sendTrackReply(msgCtx, result.render);
      } else {
        const edited = await conversation.external((outside) =>
          safeEditMessageById(
            outside,
            activeOrigin as MessageRef,
            result.render.text,
            {
              parse_mode: "HTML",
              reply_markup: { inline_keyboard: result.render.keyboard },
              link_preview_options: { is_disabled: true },
            },
          ),
        );
        if (!edited) {
          // Origin gone — fall back to the legacy fresh-reply path.
          await sendTrackReply(msgCtx, result.render);
        }
      }
    } else {
      await sendTrackReply(msgCtx, result.render);
    }
    await sweepWorkflow(conversation);
    return;
  }
};

/**
 * Send the /track view as a single Telegram message: photo + caption +
 * inline keyboard when the chart renders, plain text otherwise. The
 * caption is pre-trimmed to fit Telegram's 1024-char photo-caption
 * budget by `renderTrackCaption`; the text path uses the full body so
 * users on tokens whose chart failed still see all 20 trade rows.
 * A photo failure (Telegram 400 on a malformed PNG, e.g.) falls back
 * to the text path so the user always sees the card.
 */
const sendTrackReply = async (
  ctx: AppContext,
  render: TrackRender,
): Promise<void> => {
  if (render.chartPng) {
    try {
      await ctx.replyWithPhoto(
        new InputFile(render.chartPng, `${render.tokenName || "chart"}.png`),
        {
          caption: render.caption,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: render.keyboard },
        },
      );
      return;
    } catch (err) {
      logger.warn("track chart send failed", { err });
    }
  }
  await ctx.reply(render.text, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: render.keyboard },
    link_preview_options: { is_disabled: true },
  });
};

/**
 * Render the full /track view as a fresh reply in the current chat —
 * chart photo (if available) first, then the text card with its action
 * keyboard. Shared between the `/track <addr>` slash entry and the
 * `/start track_<addr>` deeplink fired by the inline ticker links on
 * each open `/positions` row.
 */
export const replyWithTrackCard = async (
  ctx: AppContext,
  tokenAddress: string,
): Promise<"ok" | "not_found" | "unavailable"> => {
  const result = await buildTrack(ctx.env, tokenAddress);
  if (!result.ok) return result.kind;
  await sendTrackReply(ctx, result.render);
  return "ok";
};

/** Render /track for a known address as a direct reply (no conversation). */
const replyTrack = async (
  ctx: AppContext,
  address: string,
): Promise<void> => {
  const result = await buildTrack(ctx.env, address);
  if (!result.ok) {
    await ctx.reply(
      result.kind === "not_found" ? TOKEN_NOT_FOUND_HTML : API_UNAVAILABLE,
      {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      },
    );
    return;
  }
  await sendTrackReply(ctx, result.render);
};

/** Send a fresh buy card for the tracked token. Mirrors the /buy entry view. */
const handleTrackBuy = async (
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
  // Replace the /track card in place with the buy card so Back lands
  // the user back on the /track view via the snapshot pushed below.
  const result = await editToSubmenu(ctx, {
    text: renderBuyTokenCardText(tokenResult.data, usdcBalance),
    parseMode: "HTML",
    inlineKeyboard: buildBuyTokenKeyboard(
      tokenAddress,
      normaliseBuyPresets(
        ctx.session.buyPresetsUsdc,
        ctx.session.defaultBuyUsdc,
      ),
    ),
    linkPreviewDisabled: true,
  });
  await ctx.answerCallbackQuery();
  // Track the rendered card so the post-trade sweep clears it once a
  // buy lands. Read the id `editToSubmenu` returned — on the happy
  // path that's the original (edited) message, but on the benign-400
  // fallback the original was deleted and the id now points at the
  // fresh reply.
  if (ctx.chat && result.editedMessageId !== undefined) {
    pushWorkflowMessage(ctx.session, ctx.chat.id, result.editedMessageId);
  }
};

/** Send a fresh sell card for the tracked token. Mirrors the /sell entry view. */
const handleTrackSell = async (
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
  const result = await editToSubmenu(ctx, {
    text: renderSellTokenCardText(tokenResult.data, tokenBalance),
    parseMode: "HTML",
    inlineKeyboard: buildSellTokenKeyboard(
      tokenAddress,
      normaliseSellPresets(ctx.session.sellPresetsPct),
    ),
    linkPreviewDisabled: true,
  });
  await ctx.answerCallbackQuery();
  if (ctx.chat && result.editedMessageId !== undefined) {
    pushWorkflowMessage(ctx.session, ctx.chat.id, result.editedMessageId);
  }
};

export const registerTrackCommand = (bot: Bot<AppContext>): void => {
  bot.use(
    createConversation(
      trackLookupConversation as (
        conv: Conversation<AppContext, AppContext>,
        ctx: AppContext,
        ...args: unknown[]
      ) => Promise<void>,
      { id: "track-lookup", parallel: true },
    ),
  );

  // Start-menu "Track" button — edit the start bubble into the address
  // prompt, then run the wizard in that same bubble. Falls through to
  // the legacy reply flow when the bubble can't be edited.
  bot.callbackQuery(START_CALLBACK.track, async (ctx) => {
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
    await ctx.conversation.enter("track-lookup", origin);
  });

  /**
   * `/track` — with an inline address arg, render immediately; without
   * one, fall back to the prompt-driven lookup conversation.
   */
  bot.command("track", async (ctx) => {
    const arg = typeof ctx.match === "string" ? ctx.match.trim() : "";
    if (arg !== "") {
      const addr = extractTokenAddress(arg);
      if (addr) {
        await replyTrack(ctx, addr);
        return;
      }
    }
    await ctx.conversation.enter("track-lookup");
  });

  bot.callbackQuery(new RegExp(`^${TRACK_CMD.buy}:`), async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    if (!parsed?.args[0]) {
      await ctx.answerCallbackQuery();
      return;
    }
    await handleTrackBuy(ctx, parsed.args[0]).catch(async (err) => {
      logger.error("track buy handler failed", { err });
      // Surface the outage explicitly rather than acking silently — a
      // silent ack on an unhandled throw looks identical to a no-op
      // button on the client, which masks real failures.
      await ctx
        .answerCallbackQuery({ text: API_UNAVAILABLE, show_alert: true })
        .catch(() => {});
    });
  });

  bot.callbackQuery(new RegExp(`^${TRACK_CMD.sell}:`), async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    if (!parsed?.args[0]) {
      await ctx.answerCallbackQuery();
      return;
    }
    await handleTrackSell(ctx, parsed.args[0]).catch(async (err) => {
      logger.error("track sell handler failed", { err });
      await ctx
        .answerCallbackQuery({ text: API_UNAVAILABLE, show_alert: true })
        .catch(() => {});
    });
  });
};
