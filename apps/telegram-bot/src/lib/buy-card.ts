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

const EMPTY_KEYBOARD: InlineKeyboardMarkup = { inline_keyboard: [] };

/**
 * Edit the previously-shipped buy card (or error fallback) for this chat
 * in place with the Loading placeholder copy, returning the reused
 * message id so the final card can edit the same slot again. Each
 * address paste replaces the prior intercept output: stacking a new card
 * above the stale one leaves the user staring at two conflicting
 * screens, and delete-then-resend leaves a flash of empty chat between
 * the two calls.
 *
 * Returns `null` when no prior card is tracked or when the edit fails
 * (message already gone, outside 48h, racing delete, etc.) so the caller
 * falls back to a fresh `sendMessage`. Keyed by `chatId` so a user
 * alternating between two chats keeps each chat's last card tracked
 * independently — a single-slot field would lose chat A's card the
 * moment the user pasted in chat B and let stale cards stack again on
 * the return trip.
 */
const reusePreviousBuyCardForLoading = async (
  ctx: AppContext,
  loadingText: string,
): Promise<number | null> => {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return null;
  const byChat = ctx.session.lastBuyCardMessageByChat;
  if (!byChat) return null;
  const key = String(chatId);
  const prevMessageId = byChat[key];
  if (typeof prevMessageId !== "number") return null;
  try {
    await ctx.api.editMessageText(chatId, prevMessageId, loadingText, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: EMPTY_KEYBOARD,
    });
    return prevMessageId;
  } catch {
    // Edit failed (stale id / outside 48h / racing delete) — drop the
    // pointer and let the caller send a fresh placeholder.
    delete byChat[key];
    return null;
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
 * Reuses the prior intercept message in this chat via `editMessageText`
 * (rather than delete + send) so the second paste in a row morphs the
 * existing card into Loading and then into the new card without the
 * screen blinking through an empty slot. Falls back to a fresh send when
 * the prior message is gone (outside 48h, racing delete) or no card is
 * tracked yet.
 */
export const showBuyCardForAddress = async (
  ctx: AppContext,
  address: string,
  options: { onPlaceholderReady?: () => void } = {},
): Promise<void> => {
  const loadingText = buildLoadingText(address);
  const reusedId = await reusePreviousBuyCardForLoading(ctx, loadingText);
  // When we reuse the prior card slot, synthesise a Message stub for
  // `finaliseBuyCard` — only `message_id` is read, and the in-place edit
  // path keeps the same id alive across the fetch.
  const placeholder: Message =
    reusedId !== null
      ? ({ message_id: reusedId } as Message)
      : await (async () => {
          const sent = await ctx.reply(loadingText, {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
          });
          rememberBuyCardMessage(ctx, sent);
          return sent;
        })();

  // The Loading slot is now on screen (either reused or freshly sent),
  // so it's safe for the caller to clean up the user's pasted address
  // without leaving the chat momentarily blank.
  options.onPlaceholderReady?.();

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
    // Sweep the user's pasted address only AFTER the Loading slot is
    // on screen — deleting first leaves a beat of blank chat where the
    // paste used to be, defeating the whole point of the placeholder.
    // Best-effort and fire-and-forget: Telegram returns 400 if the
    // message is already gone, and we'd rather still ship the card than
    // abort on a transient deleteMessage failure.
    await showBuyCardForAddress(ctx, addr, {
      onPlaceholderReady: () => {
        void ctx.deleteMessage().catch(() => {
          // Already gone / outside 48h window / no rights — fall through.
        });
      },
    });
  });
};
