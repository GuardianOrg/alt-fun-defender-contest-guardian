import type { Address } from "viem";

import type { AppContext } from "../bot.js";
import {
  buildBuyTokenKeyboard,
  buildSellTokenKeyboard,
  normaliseBuyPresets,
  normaliseSellPresets,
} from "../keyboards/buy-sell-token.js";
import { fetchToken } from "./api.js";
import { editToSubmenu } from "./nav.js";
import { fetchErc20Balance, fetchUsdcBalance } from "./rpc.js";
import {
  renderBuyTokenCardText,
  renderSellTokenCardText,
} from "./token-card.js";

export const ACTION_TOKEN_OUTAGE =
  "Token data temporarily unavailable — try again in a moment.";

interface ActionCardView {
  text: string;
  inlineKeyboard: ReturnType<typeof buildBuyTokenKeyboard>;
}

const buildActionView = async (
  ctx: AppContext,
  walletAddress: string,
  action: "buy" | "sell",
  token: Address,
): Promise<ActionCardView | null> => {
  const [tokenResult, balance] = await Promise.all([
    fetchToken(ctx.env, token),
    action === "buy"
      ? fetchUsdcBalance(ctx.env, walletAddress)
      : fetchErc20Balance(ctx.env, token, walletAddress),
  ]);
  if (!tokenResult.ok) return null;
  if (action === "buy") {
    return {
      text: renderBuyTokenCardText(tokenResult.data, balance),
      inlineKeyboard: buildBuyTokenKeyboard(
        token,
        normaliseBuyPresets(
          ctx.session.buyPresetsUsdc,
          ctx.session.defaultBuyUsdc,
        ),
      ),
    };
  }
  return {
    text: renderSellTokenCardText(tokenResult.data, balance),
    inlineKeyboard: buildSellTokenKeyboard(
      token,
      normaliseSellPresets(ctx.session.sellPresetsPct),
    ),
  };
};

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
  const view = await buildActionView(ctx, walletAddress, action, token);
  if (!view) {
    await ctx.reply(ACTION_TOKEN_OUTAGE);
    return;
  }
  await ctx.reply(view.text, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: view.inlineKeyboard },
    link_preview_options: { is_disabled: true },
  });
};

/**
 * Edit-in-place variant of `replyWithActionCard` for callback handlers
 * that navigate from one panel into the buy/sell card on the same chat
 * bubble. Pushes the current message snapshot onto the nav stack so
 * Back returns to the original view (e.g. /positions → Buy → buy card,
 * Back → positions).
 *
 * On token-fetch outage, surfaces the outage as a toast rather than
 * leaving the user on a half-replaced screen.
 */
export const editToActionCard = async (
  ctx: AppContext,
  walletAddress: string,
  action: "buy" | "sell",
  token: Address,
): Promise<boolean> => {
  const view = await buildActionView(ctx, walletAddress, action, token);
  if (!view) return false;
  await editToSubmenu(ctx, {
    text: view.text,
    parseMode: "HTML",
    inlineKeyboard: view.inlineKeyboard,
    linkPreviewDisabled: true,
  });
  return true;
};
