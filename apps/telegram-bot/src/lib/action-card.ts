import type { Address } from "viem";

import type { AppContext } from "../bot.js";
import type { InlineKeyboard } from "../keyboards/wallet-actions.js";
import {
  buildBuyTokenKeyboard,
  buildSellTokenKeyboard,
  normaliseBuyPresets,
  normaliseSellPresets,
} from "../keyboards/buy-sell-token.js";
import { fetchToken } from "./api.js";
import {
  ACTION_TOKEN_OUTAGE_REPLY,
  BUYS_PAUSED_MINT_PAUSED_REPLY,
  getCtxLanguage,
  t,
} from "./i18n.js";
import { backHomeRow, editToSubmenu } from "./nav.js";
import { fetchErc20Balance, fetchUsdcBalance } from "./rpc.js";
import {
  renderBuyTokenCardText,
  renderSellTokenCardText,
} from "./token-card.js";

export const actionTokenOutage = (ctx: AppContext): string =>
  t(ACTION_TOKEN_OUTAGE_REPLY, getCtxLanguage(ctx));

interface ActionCardView {
  text: string;
  inlineKeyboard: InlineKeyboard;
}

const buildActionView = async (
  ctx: AppContext,
  walletAddress: string,
  action: "buy" | "sell",
  token: Address,
): Promise<ActionCardView | null> => {
  // RPC rejections (balance fetch timeout, fetchToken throw) must
  // funnel through the same `null` outage branch the callsite already
  // handles — letting them bubble out of the callback strands the
  // Telegram spinner and surfaces a raw stack trace to the user.
  try {
    const [tokenResult, balance] = await Promise.all([
      fetchToken(ctx.env, token),
      action === "buy"
        ? fetchUsdcBalance(ctx.env, walletAddress)
        : fetchErc20Balance(ctx.env, token, walletAddress),
    ]);
    if (!tokenResult.ok) return null;
    const lang = getCtxLanguage(ctx);
    if (action === "buy") {
      if (tokenResult.data.mintPaused) {
        return {
          text: t(BUYS_PAUSED_MINT_PAUSED_REPLY, lang)(""),
          inlineKeyboard: [backHomeRow(lang)],
        };
      }
      return {
        text: renderBuyTokenCardText(tokenResult.data, balance, lang),
        inlineKeyboard: buildBuyTokenKeyboard(
          token,
          normaliseBuyPresets(
            ctx.session.buyPresetsUsdc,
            ctx.session.defaultBuyUsdc,
          ),
          lang,
        ),
      };
    }
    return {
      text: renderSellTokenCardText(tokenResult.data, balance, lang),
      inlineKeyboard: buildSellTokenKeyboard(
        token,
        normaliseSellPresets(ctx.session.sellPresetsPct),
        lang,
      ),
    };
  } catch {
    return null;
  }
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
    await ctx.reply(actionTokenOutage(ctx));
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
