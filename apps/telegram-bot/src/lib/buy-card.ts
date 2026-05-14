import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import {
  buildBuyTokenKeyboard,
  normaliseBuyPresets,
} from "../keyboards/buy-sell-token.js";
import { extractTokenAddress, fetchToken } from "./api.js";
import { fetchUsdcBalance } from "./rpc.js";
import { renderBuyTokenCardText } from "./token-card.js";
import { WalletManager } from "./wallet.js";

const TOKEN_NOT_FOUND_HTML =
  "❌ <b>Token not found.</b>\n\n" +
  "Make sure you have the correct contract address. You can find it on:\n" +
  "• <a href=\"https://alt.fun\">alt.fun</a> — tap the token → copy address\n" +
  "• <a href=\"https://hyperevmscan.io\">hyperevmscan.io</a> — search the token → copy address";

const API_UNAVAILABLE =
  "Data temporarily unavailable — try again in a moment.";

/**
 * Fetch the token and the user's active-wallet USDC balance, then reply
 * with the canonical buy card (same text + keyboard as the `/buy` lookup
 * flow). Used by the address-intercept paths so a contract address
 * pasted at any prompt — or as a bare message outside any flow — lands
 * the user on the buy menu without retyping or re-running `/buy`.
 *
 * On any failure the helper surfaces the same user-facing copy the buy
 * lookup conversation does (token-not-found vs. api-unavailable), so the
 * pivot looks identical to a normal `/buy` lookup.
 */
export const showBuyCardForAddress = async (
  ctx: AppContext,
  address: string,
): Promise<void> => {
  const tokenResult = await fetchToken(ctx.env, address);
  if (!tokenResult.ok) {
    if (
      tokenResult.kind === "not_found" ||
      tokenResult.kind === "invalid_address"
    ) {
      await ctx.reply(TOKEN_NOT_FOUND_HTML, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
      return;
    }
    await ctx.reply(API_UNAVAILABLE);
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
  await ctx.reply(cardText, {
    parse_mode: "HTML",
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
    await showBuyCardForAddress(ctx, addr);
  });
};
