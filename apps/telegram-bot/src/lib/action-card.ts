import type { Address } from "viem";

import type { AppContext } from "../bot.js";
import {
  buildBuyTokenKeyboard,
  buildSellTokenKeyboard,
  normaliseDefaultBuyUsdc,
  normaliseDefaultSellUsdc,
} from "../keyboards/buy-sell-token.js";
import { fetchToken } from "./api.js";
import { fetchErc20Balance, fetchUsdcBalance } from "./rpc.js";
import {
  renderBuyTokenCardText,
  renderSellTokenCardText,
} from "./token-card.js";

export const ACTION_TOKEN_OUTAGE =
  "Token data temporarily unavailable — try again in a moment.";

/**
 * Render the buy or sell card for `token` and reply in the current chat.
 * Shared between the `/start buy_<addr>` deeplink path (legacy referral
 * surface) and the `/positions` inline `[Buy]` / `[Sell]` callback rows,
 * so a tap inside the positions message lands a card in-chat rather than
 * bouncing the user through a t.me deeplink.
 */
export const replyWithActionCard = async (
  ctx: AppContext,
  walletAddress: string,
  action: "buy" | "sell",
  token: Address,
): Promise<void> => {
  const [tokenResult, balance] = await Promise.all([
    fetchToken(ctx.env, token),
    action === "buy"
      ? fetchUsdcBalance(ctx.env, walletAddress)
      : fetchErc20Balance(ctx.env, token, walletAddress),
  ]);
  if (!tokenResult.ok) {
    await ctx.reply(ACTION_TOKEN_OUTAGE);
    return;
  }
  if (action === "buy") {
    await ctx.reply(renderBuyTokenCardText(tokenResult.data, balance), {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: buildBuyTokenKeyboard(
          token,
          normaliseDefaultBuyUsdc(ctx.session.defaultBuyUsdc),
        ),
      },
      link_preview_options: { is_disabled: true },
    });
    return;
  }
  await ctx.reply(renderSellTokenCardText(tokenResult.data, balance), {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: buildSellTokenKeyboard(
        token,
        normaliseDefaultSellUsdc(ctx.session.defaultBuyUsdc),
      ),
    },
    link_preview_options: { is_disabled: true },
  });
};
