import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import {
  START_CALLBACK,
  buildStartMenuKeyboard,
} from "../keyboards/start-menu.js";
import { replyWithActionCard } from "../lib/action-card.js";
import { replyWithTrackCardViaLoadingPlaceholder } from "./track.js";
import {
  ctxAntiPhishingPhrase,
  resolveAntiPhishingHeader,
} from "../lib/anti-phishing.js";
import { BOT_NAME } from "../lib/branding.js";
import {
  DEFAULT_LANGUAGE,
  type Language,
  POSITIONS_NO_ACTIVE_WALLET_REPLY,
  REFRESH_PRIVATE_DM_ONLY_REPLY,
  START_BALANCE_LABEL,
  START_BALANCE_REFRESHED_TOAST,
  START_BALANCE_UNAVAILABLE_TOAST,
  START_COULD_NOT_CREATE_WALLET_REPLY,
  START_GAS_BALANCE_LABEL,
  START_NO_USER_REPLY as I18N_START_NO_USER_REPLY,
  START_NON_PRIVATE_CHAT_REPLY as I18N_START_NON_PRIVATE_CHAT_REPLY,
  START_ONCE_FUNDED_REFRESH_HINT,
  START_WALLET_ADDRESS_LABEL,
  START_WELCOME_LEAD,
  TAP_TO_COPY_HINT,
  getCtxLanguage,
  t,
} from "../lib/i18n.js";
import { logger } from "../lib/logger.js";
import {
  START_VIEW_ID,
  clearNavStack,
  registerView,
  setCurrentView,
  type SubmenuView,
} from "../lib/nav.js";
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

const nonPrivateChatReply = (ctx: AppContext): string =>
  t(I18N_START_NON_PRIVATE_CHAT_REPLY, getCtxLanguage(ctx));

const noUserReply = (ctx: AppContext): string =>
  t(I18N_START_NO_USER_REPLY, getCtxLanguage(ctx));

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
  lang: Language = DEFAULT_LANGUAGE,
): string => {
  const usdc = formatUsdc6(usdcBalance);
  const hype = formatHype18(hypeBalance);
  return [
    escapeHtml(resolveAntiPhishingHeader(phrase, lang)),
    "",
    t(START_WELCOME_LEAD, lang)(BOT_NAME),
    "",
    t(START_WALLET_ADDRESS_LABEL, lang),
    `<code>${escapeHtml(address)}</code>`,
    t(TAP_TO_COPY_HINT, lang),
    "",
    t(START_BALANCE_LABEL, lang)(escapeHtml(usdc)),
    t(START_GAS_BALANCE_LABEL, lang)(escapeHtml(hype)),
    "",
    t(START_ONCE_FUNDED_REFRESH_HINT, lang),
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
  lang: Language = DEFAULT_LANGUAGE,
): Promise<RenderedStart> => ({
  text: renderWelcomeHtml(address, usdcBalance, hypeBalance, phrase, lang),
  reply_markup: {
    inline_keyboard: buildStartMenuKeyboard(
      resolveBuyUsdcUrl(env, address),
      lang,
    ),
  },
  parse_mode: "HTML",
  // Without this, Telegram renders a large preview card for the URL
  // button's host on mobile, pushing the keyboard off-screen.
  link_preview_options: { is_disabled: true },
});

/**
 * Send a fresh /start view as a new chat message after a successful
 * trade so the user has the home menu directly under the receipt
 * without having to retype `/start`. Best-effort: returns silently when
 * the snapshot can't be built (no active wallet, RPC degraded) or when
 * Telegram rejects the send. The receipt above is the load-bearing
 * surface; the start prompt is purely a navigation convenience.
 *
 * Uses `api.sendMessage` against the explicit `chatId` rather than
 * `ctx.reply` so the post-trade caller in `runWithTxStatusUpdates` can
 * fire it without depending on `ctx.chat` (the only chat ref available
 * at that point is the edit target's chatId).
 */
export const sendStartPromptAfterTrade = async (
  ctx: AppContext,
  chatId: number | undefined,
): Promise<void> => {
  if (chatId === undefined) return;
  try {
    const snap = await buildStartSnapshot(ctx);
    if (!snap) return;
    await ctx.api.sendMessage(chatId, snap.text, {
      parse_mode: snap.parseMode,
      reply_markup: { inline_keyboard: snap.keyboard },
      link_preview_options: snap.linkPreviewDisabled
        ? { is_disabled: true }
        : undefined,
    });
  } catch (err) {
    logger.debug("post-trade start prompt failed", { err });
  }
};

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
    getCtxLanguage(ctx),
  );
  return {
    text: rendered.text,
    parseMode: rendered.parse_mode,
    keyboard: rendered.reply_markup.inline_keyboard,
    linkPreviewDisabled: true,
  };
};

/**
 * Build the /start view as a `SubmenuView` payload — the shape the
 * nav-view registry hands back to `renderSubmenuInPlace` when a Back
 * navigation pops a snapshot tagged with `{ id: "start" }`. Returns
 * `null` for the same reasons `buildStartSnapshot` does (no active
 * wallet, missing user); the Back handler then falls back to the
 * legacy frozen snapshot.
 */
const buildStartViewPayload = async (
  ctx: AppContext,
): Promise<SubmenuView | null> => {
  const snap = await buildStartSnapshot(ctx);
  if (!snap) return null;
  return {
    text: snap.text,
    parseMode: snap.parseMode,
    inlineKeyboard: snap.keyboard,
    linkPreviewDisabled: snap.linkPreviewDisabled,
    view: { id: START_VIEW_ID },
  };
};

// Register the start view once at module load so the nav-view
// registry can re-render it on Back / Home pops without going
// through the `StartRenderer` callback chain. Idempotent on
// re-registration so test bots that import this module twice (rare,
// but happens in hot-reload setups) don't collide.
registerView(START_VIEW_ID, buildStartViewPayload);

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

const walletCreateFailed = (ctx: AppContext): string =>
  t(START_COULD_NOT_CREATE_WALLET_REPLY, getCtxLanguage(ctx));

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
      await ctx.reply(noUserReply(ctx));
      return;
    }
    if (!isPrivateChat(ctx)) {
      await ctx.reply(nonPrivateChatReply(ctx));
      return;
    }
    const userId = ctx.from.id;
    // /start is the home entry point — every prior nav snapshot is now
    // stale (the user is being re-seated on the welcome screen, not
    // returning to whatever sub-menu they were in before). Clearing
    // here keeps a later Back tap from popping into a screen that no
    // longer matches the user's context. The deeplink-action branches
    // below render straight into a token card without going through
    // the welcome view, but they are equally fresh entry points and
    // must not inherit a stale stack either.
    clearNavStack(ctx.session);
    // Clear the bubble's view-tag with the stack: the deeplink-action
    // branches below open a fresh action / track card (not a registered
    // view), and inheriting the prior bubble's `navCurrentView` would
    // make a subsequent `editToSubmenu` from there tag its parent
    // snapshot with the wrong view id — Back would then rebuild a
    // screen the user never came from. The welcome-screen path resets
    // this to `{ id: START_VIEW_ID }` after rendering; deeplink paths
    // leave it cleared (correct — those cards have no registered
    // builder yet). CodeRabbit #1070.
    setCurrentView(ctx.session, undefined);
    // Username → userId mapping refreshes on every /start so a sharer
    // who changes their Telegram handle later still resolves cleanly
    // through `ref_<username>` deeplinks. No-op when the user has no
    // username (optional in Telegram).
    await recordUsername(ctx.env.WALLET_KV, ctx.from.username, userId);

    const existingProfile = await readProfile(ctx.env.WALLET_KV, userId);
    const isFirstStart = existingProfile === null;

    const address = await ensureActiveAddress(ctx.env, userId);
    if (!address) {
      await ctx.reply(walletCreateFailed(ctx));
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
          referralIdentityWallet: address.toLowerCase() as Address,
        });
      }
      if (actionParam.action === "track") {
        // Sweep the synthetic `/start track_<addr>` user bubble BEFORE
        // sending the loading placeholder so the placeholder lands in
        // the slot the synthetic message just vacated — otherwise the
        // user sees "/start" wedged above a fresh "⏳ Loading…" bubble.
        // Best-effort: deletion failure is benign (48h window, no
        // rights) and we'd still rather ship the card.
        try {
          await ctx.deleteMessage();
        } catch {
          // ignore
        }
        // Replace the deleted /start with a loading prompt that edits
        // in-place into the rendered token detail card. The helper
        // owns the placeholder → final-card transition end-to-end so
        // the loading text is gone the moment the card lands.
        // `replyWithTrackCardViaLoadingPlaceholder` already surfaces
        // friendly fallback copy in the placeholder slot on `not_found`
        // / `unavailable`, so no extra `replyWithNav` is needed here.
        await replyWithTrackCardViaLoadingPlaceholder(ctx, actionParam.token);
        // Sweep the prior /positions card (the source of the deeplink)
        // so the user is not scrolled past a stale positions list above
        // the freshly-loaded track card. Best-effort and fire-and-
        // forget: a missing pointer just means the user never ran
        // /positions in this chat, and a deleteMessage failure is
        // benign (already gone / outside 48h window).
        if (ctx.chat) {
          const byChat = ctx.session.lastPositionsMessageByChat;
          const key = String(ctx.chat.id);
          const prevPositionsId = byChat?.[key];
          if (byChat && typeof prevPositionsId === "number") {
            delete byChat[key];
            void ctx.api
              .deleteMessage(ctx.chat.id, prevPositionsId)
              .catch(() => {});
          }
        }
      } else {
        await replyWithActionCard(
          ctx,
          address,
          actionParam.action,
          actionParam.token,
        );
        // Sweep the synthetic `/start <action>_<addr>` user bubble that
        // Telegram injects when an action deeplink is tapped — the user
        // never typed it, and leaving it above the token card just
        // clutters the chat. Best-effort: incoming-message deletion in
        // private DMs is allowed within 48h, and we'd rather keep the
        // card visible than surface a transient deleteMessage failure.
        void ctx.deleteMessage().catch(() => {});
      }
      return;
    }

    if (isFirstStart) {
      // Referrer is captured only on the very first /start. If this
      // first call has no deeplink, `referrer` stays null forever —
      // every later /start short-circuits via `isFirstStart === false`
      // above, so a user who onboarded bare can't retroactively bind
      // themselves to a referrer. `resolveReferrer` also blocks the
      // self-referral case (`ref_<own userId/username>`), so a user
      // can't farm the referrer cut of their own bot fee.
      const param = parseStartParam(rawParam);
      let referrer: Address | null = null;
      if (param !== null) {
        referrer = await resolveReferrer(
          ctx.env,
          buildManager(ctx.env),
          param,
          userId,
        );
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
        referralIdentityWallet: address.toLowerCase() as Address,
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
      getCtxLanguage(ctx),
    );
    await ctx.reply(rendered.text, {
      parse_mode: rendered.parse_mode,
      reply_markup: rendered.reply_markup,
      link_preview_options: rendered.link_preview_options,
    });
    // The new bubble shows the start view — record it so a forward
    // nav from one of the start-menu buttons attaches `{ id: "start" }`
    // onto its parent snapshot, letting Back re-render fresh balances
    // instead of restoring the welcome card frozen at click time.
    setCurrentView(ctx.session, { id: START_VIEW_ID });
  });

  bot.callbackQuery(START_CALLBACK.refresh, async (ctx) => {
    if (!ctx.from || !ctx.callbackQuery.message) {
      await ctx.answerCallbackQuery();
      return;
    }
    const lang = getCtxLanguage(ctx);
    if (!isPrivateChat(ctx)) {
      await ctx.answerCallbackQuery({
        text: t(REFRESH_PRIVATE_DM_ONLY_REPLY, lang),
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
        text: t(POSITIONS_NO_ACTIVE_WALLET_REPLY, lang),
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
      lang,
    );
    await safeEditMessageText(ctx, rendered.text, {
      parse_mode: rendered.parse_mode,
      reply_markup: rendered.reply_markup,
      link_preview_options: rendered.link_preview_options,
    });
    setCurrentView(ctx.session, { id: START_VIEW_ID });
    await ctx.answerCallbackQuery({
      text:
        usdcBalance === null && hypeBalance === null
          ? t(START_BALANCE_UNAVAILABLE_TOAST, lang)
          : t(START_BALANCE_REFRESHED_TOAST, lang),
    });
  });
};
