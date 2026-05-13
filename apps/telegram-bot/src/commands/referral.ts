import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import { ANTI_PHISHING_HEADER } from "../lib/anti-phishing.js";
import { fetchReferralStats } from "../lib/api.js";
import { formatUsdc } from "../lib/format.js";
import { logger } from "../lib/logger.js";
import { WalletManager } from "../lib/wallet.js";

const DEFAULT_BOT_USERNAME = "AltFunBot";

const NON_PRIVATE_CHAT_REPLY =
  "Referral flows are private-DM only — your wallet address would leak in a group. Open a direct chat with the bot to use /referral.";

const NO_USER_REPLY =
  "Referrals require a personal Telegram account — this message has no user attached.";

const NO_WALLET_REPLY =
  "No active wallet yet — run /start to create one before sharing your referral link.";

const OUTAGE_REPLY =
  "Data temporarily unavailable — try again in a moment.";

const isPrivateChat = (ctx: AppContext): boolean =>
  ctx.chat?.type === "private";

const buildManager = (env: AppContext["env"]): WalletManager =>
  new WalletManager(env.WALLET_KV, env.MASTER_KEY);

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

interface ReferralView {
  text: string;
  parse_mode: "HTML";
  link_preview_options: { is_disabled: true };
}

const buildLink = (env: AppContext["env"], userId: number): string => {
  const username = env.BOT_USERNAME?.trim() || DEFAULT_BOT_USERNAME;
  return `https://t.me/${username}?start=ref_${userId}`;
};

const renderReferralHtml = (
  link: string,
  rewardsWallet: string,
  referredWallets: number,
  referredVolumeUsdc: string,
): string => {
  const volume = formatUsdc(referredVolumeUsdc);
  return [
    escapeHtml(ANTI_PHISHING_HEADER),
    "",
    "<b>Your referral</b>",
    "",
    "Share your link to earn a cut of every trade your referees make.",
    "",
    "Your referral link:",
    `<code>${escapeHtml(link)}</code>`,
    "(Tap to copy)",
    "",
    "Your rewards wallet:",
    `<code>${escapeHtml(rewardsWallet)}</code>`,
    "",
    `Referred wallets: ${referredWallets}`,
    `Referred volume: $${escapeHtml(volume)} USDC`,
  ].join("\n");
};

/**
 * Build the referral view for the user's active wallet. Returns a
 * discriminated union so callers can render the appropriate response
 * for each failure mode without juggling sentinel strings.
 */
const buildView = async (
  env: AppContext["env"],
  userId: number,
): Promise<
  | { ok: true; view: ReferralView }
  | { ok: false; kind: "no_wallet" | "outage" }
> => {
  const wm = buildManager(env);
  const active = await wm.getActive(userId);
  if (!active) return { ok: false, kind: "no_wallet" };

  const stats = await fetchReferralStats(env, active.address);
  if (!stats.ok) {
    // `invalid_address` is unreachable here — the address comes from
    // our own wallet manager — but treat it as an outage on the off
    // chance the api regresses, rather than surfacing a confusing
    // "Invalid wallet" message to the user.
    logger.warn("fetchReferralStats failed", {
      userId,
      kind: stats.kind,
    });
    return { ok: false, kind: "outage" };
  }

  const link = buildLink(env, userId);
  return {
    ok: true,
    view: {
      text: renderReferralHtml(
        link,
        active.address,
        stats.data.referredWallets,
        stats.data.referredVolume,
      ),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    },
  };
};

const sendReferral = async (
  ctx: AppContext,
  userId: number,
): Promise<void> => {
  const result = await buildView(ctx.env, userId);
  if (!result.ok) {
    await ctx.reply(
      result.kind === "no_wallet" ? NO_WALLET_REPLY : OUTAGE_REPLY,
    );
    return;
  }
  await ctx.reply(result.view.text, {
    parse_mode: result.view.parse_mode,
    link_preview_options: result.view.link_preview_options,
  });
};

export const registerReferralCommand = (bot: Bot<AppContext>): void => {
  bot.command("referral", async (ctx) => {
    if (!ctx.from) {
      await ctx.reply(NO_USER_REPLY);
      return;
    }
    if (!isPrivateChat(ctx)) {
      await ctx.reply(NON_PRIVATE_CHAT_REPLY);
      return;
    }
    await sendReferral(ctx, ctx.from.id);
  });

  bot.callbackQuery(START_CALLBACK.referral, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery({ text: "Missing user." });
      return;
    }
    if (!isPrivateChat(ctx)) {
      await ctx.answerCallbackQuery({
        text: "Referral is private-DM only.",
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    await sendReferral(ctx, ctx.from.id);
  });
};
