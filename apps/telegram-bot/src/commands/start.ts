import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import {
  START_CALLBACK,
  buildStartMenuKeyboard,
} from "../keyboards/start-menu.js";
import { replyWithActionCard } from "../lib/action-card.js";
import { replyWithTrackCard } from "./track.js";
import {
  ctxAntiPhishingPhrase,
  resolveAntiPhishingHeader,
} from "../lib/anti-phishing.js";
import { BOT_NAME } from "../lib/branding.js";
import { logger } from "../lib/logger.js";
import {
  parseActionStartParam,
  parseStartParam,
  readProfile,
  recordUsername,
  resolveReferrer,
  writeDefaultRewardsWallet,
  writeProfile,
} from "../lib/onboarding.js";
import { resolveBuyUsdcUrl } from "../lib/relay.js";
import { fetchNativeBalance, fetchUsdcBalance } from "../lib/rpc.js";
import { formatHype18, formatUsdc6 } from "../lib/token-card.js";
import { WalletManager } from "../lib/wallet.js";
import type { Address } from "viem";

const NON_PRIVATE_CHAT_REPLY =
  "Wallet flows are private-DM only — your wallet address would leak in a group. Open a direct chat with the bot to use /start.";

const NO_USER_REPLY =
  "Wallets require a personal Telegram account — this message has no user attached.";

const isPrivateChat = (ctx: AppContext): boolean =>
  ctx.chat?.type === "private";

const buildManager = (env: AppContext["env"]): WalletManager =>
  new WalletManager(env.WALLET_KV, env.MASTER_KEY);

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Render the welcome message body as HTML so the wallet address can
 * be wrapped in `<code>` — Telegram makes that span tap-to-copy in
 * the mobile and desktop clients. Address is hex, so no HTML escape
 * is strictly required, but `escapeHtml` keeps the call shape uniform
 * for future fields that might carry user content.
 */
const renderWelcomeHtml = (
  address: string,
  usdcBalance: bigint | null,
  hypeBalance: bigint | null,
  phrase: string | null | undefined,
): string => {
  const usdc = formatUsdc6(usdcBalance);
  const hype = formatHype18(hypeBalance);
  return [
    escapeHtml(resolveAntiPhishingHeader(phrase)),
    "",
    `Welcome to ${BOT_NAME} — the bot for trading alt fun tokens on HyperEVM.`,
    "",
    "Your wallet address:",
    `<code>${escapeHtml(address)}</code>`,
    "(Tap to copy)",
    "",
    `Balance: ${escapeHtml(usdc)} USDC`,
    `Gas balance: ${escapeHtml(hype)} HYPE`,
    "",
    "Once funded, tap Refresh and your balance will appear here.",
  ].join("\n");
};

interface RenderedStart {
  text: string;
  reply_markup: { inline_keyboard: ReturnType<typeof buildStartMenuKeyboard> };
  parse_mode: "HTML";
  link_preview_options: { is_disabled: true };
}

const renderStart = async (
  env: AppContext["env"],
  address: string,
  usdcBalance: bigint | null,
  hypeBalance: bigint | null,
  phrase: string | null | undefined,
): Promise<RenderedStart> => ({
  text: renderWelcomeHtml(address, usdcBalance, hypeBalance, phrase),
  reply_markup: {
    inline_keyboard: buildStartMenuKeyboard(
      resolveBuyUsdcUrl(env, address),
    ),
  },
  parse_mode: "HTML",
  // Without this, Telegram renders a large preview card for the URL
  // button's host on mobile, pushing the keyboard off-screen.
  link_preview_options: { is_disabled: true },
});

/**
 * Build the /start snapshot for the nav system without sending or
 * editing any message. Used by `lib/nav.ts` to handle Home and the
 * empty-stack Back fallback — both must restore the same view a fresh
 * `/start` would produce. Returns `null` when there's no active wallet
 * to surface (caller falls back to a toast).
 */
export const buildStartSnapshot = async (
  ctx: AppContext,
): Promise<{
  text: string;
  parseMode: "HTML";
  keyboard: ReturnType<typeof buildStartMenuKeyboard>;
  linkPreviewDisabled: true;
} | null> => {
  if (!ctx.from) return null;
  const wm = buildManager(ctx.env);
  const active = await wm.getActive(ctx.from.id);
  if (!active) return null;
  const [usdcBalance, hypeBalance] = await Promise.all([
    fetchUsdcBalance(ctx.env, active.address),
    fetchNativeBalance(ctx.env, active.address),
  ]);
  const rendered = await renderStart(
    ctx.env,
    active.address,
    usdcBalance,
    hypeBalance,
    ctxAntiPhishingPhrase(ctx),
  );
  return {
    text: rendered.text,
    parseMode: rendered.parse_mode,
    keyboard: rendered.reply_markup.inline_keyboard,
    linkPreviewDisabled: true,
  };
};

/**
 * Resolve the user's active wallet address, auto-creating the first
 * wallet if the user has none. Returns `null` only when wallet
 * creation throws — the cap branch can't trigger here because we
 * only call `createWallet` when the user is at zero wallets.
 *
 * `ChatDO` (see `chat-do.ts`) serialises every update for a given
 * chat through a single event loop, so the read-modify-write here
 * cannot interleave with another `/start` from the same user.
 */
const ensureActiveAddress = async (
  env: AppContext["env"],
  userId: number,
): Promise<string | null> => {
  const wm = buildManager(env);
  const existing = await wm.getActive(userId);
  if (existing) return existing.address;
  try {
    const created = await wm.createWallet(userId);
    return created.address;
  } catch (err) {
    logger.error("auto-create wallet on /start failed", { userId, err });
    return null;
  }
};

const WALLET_CREATE_FAILED =
  "Could not create your wallet — please try /start again in a moment.";

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
    const isBenign =
      e.error_code === 400 &&
      (desc.includes("message to edit not found") ||
        desc.includes("message not found") ||
        desc.includes("message is not modified"));
    if (!isBenign) throw err;
  }
};

export const registerStartCommand = (bot: Bot<AppContext>): void => {
  bot.command("start", async (ctx) => {
    if (!ctx.from) {
      await ctx.reply(NO_USER_REPLY);
      return;
    }
    if (!isPrivateChat(ctx)) {
      await ctx.reply(NON_PRIVATE_CHAT_REPLY);
      return;
    }
    const userId = ctx.from.id;
    // Username → userId mapping refreshes on every /start so a sharer
    // who changes their Telegram handle later still resolves cleanly
    // through `ref_<username>` deeplinks. No-op when the user has no
    // username (optional in Telegram).
    await recordUsername(ctx.env.WALLET_KV, ctx.from.username, userId);

    const existingProfile = await readProfile(ctx.env.WALLET_KV, userId);
    const isFirstStart = existingProfile === null;

    const address = await ensureActiveAddress(ctx.env, userId);
    if (!address) {
      await ctx.reply(WALLET_CREATE_FAILED);
      return;
    }

    const rawParam = typeof ctx.match === "string" ? ctx.match : undefined;
    const actionParam = parseActionStartParam(rawParam);
    if (actionParam !== null) {
      // Deeplink from `/positions` inline `Buy` / `Sell` / `Track`
      // anchor — skip the welcome screen and route straight to the
      // matching card. First-start callers still get the wallet +
      // profile created above; we just don't re-render the welcome
      // message on top of the action card. No referrer is captured
      // from action payloads (those carry a token address, not a
      // referral handle).
      if (isFirstStart) {
        await writeDefaultRewardsWallet(ctx.env, address as Address);
        await writeProfile(ctx.env.WALLET_KV, userId, {
          createdAt: Date.now(),
          referrer: null,
        });
      }
      if (actionParam.action === "track") {
        await replyWithTrackCard(ctx, actionParam.token);
      } else {
        await replyWithActionCard(
          ctx,
          address,
          actionParam.action,
          actionParam.token,
        );
      }
      return;
    }

    if (isFirstStart) {
      // Resolve referrer AFTER the wallet exists so a self-referral
      // (`ref_<own userId>`) maps to the new user's own active wallet
      // — the spec allows self-referral and on day one their rewards
      // wallet equals the custodial wallet just minted above.
      const param = parseStartParam(rawParam);
      let referrer: Address | null = null;
      if (param !== null) {
        referrer = await resolveReferrer(ctx.env, buildManager(ctx.env), param);
      }
      // Default rewards wallet is set unconditionally on first /start
      // — whether or not a deeplink came in. Guarantees /referral
      // always renders against a concrete address and that any user
      // this person later refers starts paying out from their first
      // trade. Failure here is non-fatal (api falls back to wallet
      // address) — see `writeDefaultRewardsWallet`.
      await writeDefaultRewardsWallet(ctx.env, address as Address);
      await writeProfile(ctx.env.WALLET_KV, userId, {
        createdAt: Date.now(),
        referrer,
      });
    }

    const [usdcBalance, hypeBalance] = await Promise.all([
      fetchUsdcBalance(ctx.env, address),
      fetchNativeBalance(ctx.env, address),
    ]);
    const rendered = await renderStart(
      ctx.env,
      address,
      usdcBalance,
      hypeBalance,
      ctxAntiPhishingPhrase(ctx),
    );
    await ctx.reply(rendered.text, {
      parse_mode: rendered.parse_mode,
      reply_markup: rendered.reply_markup,
      link_preview_options: rendered.link_preview_options,
    });
  });

  bot.callbackQuery(START_CALLBACK.refresh, async (ctx) => {
    if (!ctx.from || !ctx.callbackQuery.message) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!isPrivateChat(ctx)) {
      await ctx.answerCallbackQuery({
        text: "Refresh is private-DM only.",
        show_alert: true,
      });
      return;
    }
    const wm = buildManager(ctx.env);
    const active = await wm.getActive(ctx.from.id);
    if (!active) {
      // Edge case: user deleted every wallet between `/start` and
      // tapping Refresh. Surface a clean toast rather than silently
      // re-creating one — the user's intent here is "show me my
      // current balance", not "make a new wallet".
      await ctx.answerCallbackQuery({
        text: "No active wallet. Run /wallet to create one.",
        show_alert: true,
      });
      return;
    }
    const [usdcBalance, hypeBalance] = await Promise.all([
      fetchUsdcBalance(ctx.env, active.address),
      fetchNativeBalance(ctx.env, active.address),
    ]);
    const rendered = await renderStart(
      ctx.env,
      active.address,
      usdcBalance,
      hypeBalance,
      ctxAntiPhishingPhrase(ctx),
    );
    await safeEditMessageText(ctx, rendered.text, {
      parse_mode: rendered.parse_mode,
      reply_markup: rendered.reply_markup,
      link_preview_options: rendered.link_preview_options,
    });
    await ctx.answerCallbackQuery({
      text:
        usdcBalance === null && hypeBalance === null
          ? "Balance unavailable"
          : "Balance refreshed",
    });
  });
};
