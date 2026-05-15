import type { Bot } from "grammy";
import type { InlineKeyboardMarkup, Message } from "grammy/types";

import type { AppContext } from "../bot.js";
import {
  buildBuyTokenKeyboard,
  normaliseBuyPresets,
} from "../keyboards/buy-sell-token.js";
import { extractTokenAddress, fetchToken } from "./api.js";
import { fetchUsdcBalance } from "./rpc.js";
import { renderBuyTokenCardText } from "./token-card.js";
import { WalletManager } from "./wallet.js";

const shortAddress = (addr: string): string =>
  addr.length >= 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;

const buildLoadingText = (addr: string): string =>
  `⏳ Loading <code>${shortAddress(addr)}</code>…`;

const TOKEN_NOT_FOUND_HTML =
  "❌ <b>Token not found.</b>\n\n" +
  "Make sure you have the correct contract address. You can find it on:\n" +
  "• <a href=\"https://alt.fun\">alt.fun</a> — tap the token → copy address\n" +
  "• <a href=\"https://hyperevmscan.io\">hyperevmscan.io</a> — search the token → copy address";

const API_UNAVAILABLE =
  "Data temporarily unavailable — try again in a moment.";

/**
 * Delete the previously-shipped buy card (or error fallback) for this
 * chat, if one is still tracked on the session. Each address paste
 * replaces the prior intercept output: stacking a new card above the
 * stale one leaves the user staring at two conflicting screens.
 *
 * Best-effort: Telegram returns 400 when the message is already gone
 * (user wiped it, or it aged past the 48h delete window) and the new
 * card must still ship. Keyed by `chatId` so a user alternating between
 * two chats keeps each chat's last card tracked independently — a
 * single-slot field would lose chat A's card the moment the user pasted
 * in chat B and let stale cards stack again on the return trip.
 */
const replacePreviousBuyCard = async (ctx: AppContext): Promise<void> => {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const byChat = ctx.session.lastBuyCardMessageByChat;
  if (!byChat) return;
  const key = String(chatId);
  const prevMessageId = byChat[key];
  if (typeof prevMessageId !== "number") return;
  delete byChat[key];
  try {
    await ctx.api.deleteMessage(chatId, prevMessageId);
  } catch {
    // Already gone / outside 48h / no rights — fall through.
  }
};

const rememberBuyCardMessage = (ctx: AppContext, sent: Message): void => {
  const chatId = ctx.chat?.id;
  // Skip when Telegram didn't echo back a numeric message_id (in tests
  // the stubbed `sendMessage` returns `result: true`; in prod the real
  // Message always carries one). Recording undefined would crash the
  // next deleteMessage call with a bad-arg error.
  if (chatId === undefined || typeof sent.message_id !== "number") return;
  const byChat = ctx.session.lastBuyCardMessageByChat ?? {};
  byChat[String(chatId)] = sent.message_id;
  ctx.session.lastBuyCardMessageByChat = byChat;
};

/**
 * Edit the loading placeholder in place with the final card text +
 * keyboard. Falls back to a fresh `ctx.reply` when the placeholder
 * doesn't carry a numeric `message_id` (test stubs that echo
 * `result: true`) or when Telegram rejects the edit (rate-limit, racing
 * delete, stale id). The fallback re-tracks the new message via
 * `rememberBuyCardMessage` so subsequent intercepts still replace the
 * card they actually see.
 */
const finaliseBuyCard = async (
  ctx: AppContext,
  placeholder: Message,
  text: string,
  options: {
    reply_markup?: InlineKeyboardMarkup;
    link_preview_options?: { is_disabled: boolean };
  } = {},
): Promise<void> => {
  const chatId = ctx.chat?.id;
  const messageId = placeholder.message_id;
  if (chatId !== undefined && typeof messageId === "number") {
    try {
      await ctx.api.editMessageText(chatId, messageId, text, {
        parse_mode: "HTML",
        ...options,
      });
      return;
    } catch {
      // Edit failed — drop the (now stale) placeholder pointer and fall
      // through to a fresh send so the user still sees the card.
      const byChat = ctx.session.lastBuyCardMessageByChat;
      if (byChat) delete byChat[String(chatId)];
    }
  }
  const sent = await ctx.reply(text, {
    parse_mode: "HTML",
    ...options,
  });
  rememberBuyCardMessage(ctx, sent);
};

/**
 * Fetch the token and the user's active-wallet USDC balance, then reply
 * with the canonical buy card (same text + keyboard as the `/buy` lookup
 * flow). Used by the address-intercept paths so a contract address
 * pasted at any prompt — or as a bare message outside any flow — lands
 * the user on the buy menu without retyping or re-running `/buy`.
 *
 * Ships a `⏳ Loading 0x1234…abcd…` placeholder before the upstream
 * fetches (`fetchToken` + `fetchUsdcBalance`) so the user sees an
 * immediate response in the slot the prior buy card occupied, then
 * edits the placeholder in place with the final card (or error copy)
 * once the data lands. Without this, the user's pasted address is
 * deleted instantly but the new card takes a beat to arrive, leaving
 * the chat momentarily blank with no signal that the paste was
 * accepted.
 *
 * On any failure the placeholder is edited to the same user-facing
 * copy the buy lookup conversation surfaces (token-not-found vs.
 * api-unavailable), so the pivot looks identical to a normal `/buy`
 * lookup.
 *
 * Replaces (delete + send) any prior intercept message in this chat so
 * the second paste in a row swaps the card in place instead of stacking
 * a new one above the stale one.
 */
export const showBuyCardForAddress = async (
  ctx: AppContext,
  address: string,
): Promise<void> => {
  await replacePreviousBuyCard(ctx);
  const placeholder = await ctx.reply(buildLoadingText(address), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
  rememberBuyCardMessage(ctx, placeholder);

  const tokenResult = await fetchToken(ctx.env, address);
  if (!tokenResult.ok) {
    if (
      tokenResult.kind === "not_found" ||
      tokenResult.kind === "invalid_address"
    ) {
      await finaliseBuyCard(ctx, placeholder, TOKEN_NOT_FOUND_HTML, {
        link_preview_options: { is_disabled: true },
      });
      return;
    }
    await finaliseBuyCard(ctx, placeholder, API_UNAVAILABLE);
    return;
  }

  const token = tokenResult.data;
  const userId = ctx.from?.id;
  const active = userId
    ? await new WalletManager(ctx.env.WALLET_KV, ctx.env.MASTER_KEY).getActive(
        userId,
      )
    : null;
  const usdcBalance = active
    ? await fetchUsdcBalance(ctx.env, active.address)
    : null;

  const cardText = renderBuyTokenCardText(token, usdcBalance);
  const buyPresets = normaliseBuyPresets(
    ctx.session.buyPresetsUsdc,
    ctx.session.defaultBuyUsdc,
  );
  await finaliseBuyCard(ctx, placeholder, cardText, {
    reply_markup: {
      inline_keyboard: buildBuyTokenKeyboard(token.address, buyPresets),
    },
    link_preview_options: { is_disabled: true },
  });
};

/**
 * Bare-text address intercept: outside any active conversation and any
 * slash command, a private-DM message that contains a contract address
 * pivots to the buy card. Issue #821.
 *
 * Private-DM only — the buy card surfaces the active wallet's USDC
 * balance, which must never auto-render into a group transcript.
 * Conversations plugin and `bot.command(...)` handlers run first; this
 * is the tail of the middleware chain so it only fires for plain text
 * outside any other matched flow.
 */
export const registerAddressBuyIntercept = (bot: Bot<AppContext>): void => {
  bot.on("message:text", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;
    const addr = extractTokenAddress(text);
    if (!addr) return;
    // Sweep the user's pasted address before the card lands — the
    // address is redundant once the token card is on screen and would
    // otherwise sit above it as visual clutter. Mirrors the conversation
    // intercept path, where `tryAddressBuyIntercept`'s `sweepWorkflow`
    // already wipes the user's reply via the workflow stack. Best-
    // effort: Telegram returns 400 if the message is already gone, and
    // we'd rather still ship the card than abort on a transient
    // deleteMessage failure.
    try {
      await ctx.deleteMessage();
    } catch {
      // Already gone / outside 48h window / no rights — fall through.
    }
    await showBuyCardForAddress(ctx, addr);
  });
};
