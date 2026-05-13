import {
  type Conversation,
  createConversation,
} from "@grammyjs/conversations";
import { InputFile, type Bot } from "grammy";

import type { AppContext } from "../bot.js";
import {
  buildBuyTokenKeyboard,
  buildSellTokenKeyboard,
  normaliseDefaultBuyUsdc,
  normaliseDefaultSellUsdc,
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
import { buildTrackChartPng } from "../lib/chart.js";
import { logger } from "../lib/logger.js";
import { fetchErc20Balance, fetchUsdcBalance } from "../lib/rpc.js";
import {
  formatToken18,
  formatUsdc6,
  renderBuyTokenCardText,
  renderSellTokenCardText,
  renderTrackTokenCardText,
} from "../lib/token-card.js";
import { WalletManager } from "../lib/wallet.js";

/** Number of trades shown under the token card per AGENTS.md /track spec. */
const TRADES_PER_CARD = 20;

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
 * without the grammY harness.
 */
export const renderTrackBody = (
  token: TokenInfo,
  trades: Trade[],
  nowSec: number = Math.floor(Date.now() / 1000),
): string => {
  const card = renderTrackTokenCardText(token);
  if (trades.length === 0) {
    return `${card}\n\n<b>Recent trades</b>\n<i>No trades yet.</i>`;
  }
  const rows = trades
    .slice(0, TRADES_PER_CARD)
    .map((t) => renderTradeRow(t, nowSec))
    .join("\n");
  return `${card}\n\n<b>Recent trades</b>\n${rows}`;
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
];

interface TrackRender {
  text: string;
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
      keyboard: buildTrackKeyboard(tokenResult.data.address),
      chartPng,
      tokenName: tokenResult.data.name,
    },
  };
};

/**
 * Conversation: collect token address → render /track view. Mirrors
 * the /buy and /sell lookup flow so the prompt copy and cancel
 * semantics are identical across commands.
 */
const trackLookupConversation = async (
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

    const result = await conversation.external((outerCtx) =>
      buildTrack(outerCtx.env, addr),
    );
    if (!result.ok) {
      if (result.kind === "not_found") {
        await msgCtx.reply(TOKEN_NOT_FOUND_HTML, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
        continue;
      }
      await msgCtx.reply(API_UNAVAILABLE);
      return;
    }
    await sendTrackReply(msgCtx, result.render);
    return;
  }
};

/**
 * Send the chart image (when available) then the token card + trades.
 * Telegram's photo-caption budget is 1024 chars — far short of the
 * card-plus-20-trades body — so the image and text are sent as two
 * separate messages with the buttons attached to the text. A photo
 * failure (Telegram 400 on a malformed PNG, e.g.) is logged and
 * swallowed so the user still gets the text card.
 */
const sendTrackReply = async (
  ctx: AppContext,
  render: TrackRender,
): Promise<void> => {
  if (render.chartPng) {
    try {
      await ctx.replyWithPhoto(
        new InputFile(render.chartPng, `${render.tokenName || "chart"}.png`),
      );
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

export const registerTrackCommand = (bot: Bot<AppContext>): void => {
  bot.use(createConversation(trackLookupConversation, "track-lookup"));

  // Start-menu "Track" button — enter the lookup flow directly,
  // matching the /buy and /sell button behaviour. Replaces the
  // earlier "type /track <contract>" hint toast.
  bot.callbackQuery(START_CALLBACK.track, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("track-lookup");
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
