import {
  type Conversation,
  createConversation,
} from "@grammyjs/conversations";
import type { Bot } from "grammy";
import { isAddress } from "viem";

import type { AppContext } from "../bot.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import {
  ctxAntiPhishingPhrase,
  resolveAntiPhishingHeader,
  wrapWithCtxPhrase as wrap,
} from "../lib/anti-phishing.js";
import {
  fetchBotReferralStats,
  setBotRewardsWallet,
  type BotReferralStats,
} from "../lib/api.js";
import { BOT_NAME } from "../lib/branding.js";
import {
  haltAndForward,
  isOtherSlashCommand,
} from "../lib/conversation-commands.js";
import {
  backHomeMarkup,
  backHomeRow,
  editToSubmenu,
  type MessageRef,
  safeEditMessageById,
} from "../lib/nav.js";
import { formatUsdc } from "../lib/format.js";
import { logger } from "../lib/logger.js";
import { getReferralIdentityWallet } from "../lib/onboarding.js";
import { PinManager } from "../lib/pin.js";
import { WalletManager } from "../lib/wallet.js";
import {
  sweepWorkflow,
  trackWorkflowMessage,
} from "../lib/workflow-stack-conversation.js";

const DEFAULT_BOT_USERNAME = BOT_NAME;

const NON_PRIVATE_CHAT_REPLY =
  "Referral flows are private-DM only — your wallet address would leak in a group. Open a direct chat with the bot to use /referral.";

const NO_USER_REPLY =
  "Referrals require a personal Telegram account — this message has no user attached.";

const NO_WALLET_REPLY =
  "No active wallet yet — run /start to create one before sharing your referral link.";

const OUTAGE_REPLY =
  "Data temporarily unavailable — try again in a moment.";

/**
 * Short callback codes for the /referral surface. Prefixed `rf:` so
 * they never collide with the start-menu (`st:*`), wallet (`w*`), or
 * positions (`pp:*`) namespaces, and each code stays well inside
 * Telegram's 64-byte callback_data budget.
 */
export const REFERRAL_CALLBACK = {
  changeRewardsWallet: "rf:cw",
} as const;

const isPrivateChat = (ctx: AppContext): boolean =>
  ctx.chat?.type === "private";

const buildManager = (env: AppContext["env"]): WalletManager =>
  new WalletManager(env.WALLET_KV, env.MASTER_KEY);

const buildPinManager = (env: AppContext["env"]): PinManager =>
  new PinManager(env.WALLET_KV, { saltRounds: env.PIN_SALT_ROUNDS });

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
  reply_markup: {
    inline_keyboard: { text: string; callback_data: string }[][];
  };
}

/**
 * Telegram usernames are 5-32 chars from `[A-Za-z0-9_]` per BotFather
 * rules, so they're always URL-safe. Defensive validation here guards
 * against the (unlikely) case where Telegram returns something
 * unexpected — falling back to the numeric userId is safer than
 * minting a malformed deeplink that 404s on every tap.
 */
const TELEGRAM_USERNAME_RE = /^[A-Za-z0-9_]{5,32}$/;

const referralCodeFor = (
  userId: number,
  rawUsername: string | undefined,
): string => {
  const username = rawUsername?.trim();
  if (username && TELEGRAM_USERNAME_RE.test(username)) return username;
  return String(userId);
};

const buildLink = (
  env: AppContext["env"],
  userId: number,
  rawUsername: string | undefined,
): string => {
  const botUsername = env.BOT_USERNAME?.trim() || DEFAULT_BOT_USERNAME;
  return `https://t.me/${botUsername}?start=ref_${referralCodeFor(userId, rawUsername)}`;
};

/**
 * Render the two safety banners that surface above the referral card
 * when the indexer flags failed-payment or dropped-attribution events
 * on this user's rewards wallet. Both banners default off (zero
 * counts) until the BotFeeRouter contract is deployed and the
 * indexer is subscribing to its events — see
 * `apps/api/src/routes/bot/referrals.ts` for the data path.
 */
const renderBanners = (stats: BotReferralStats): string[] => {
  const banners: string[] = [];
  if (stats.badPaymentCount > 0) {
    banners.push(
      [
        "<b>⚠️ Rewards wallet rejecting USDC transfers</b>",
        `${stats.badPaymentCount} referral payment${stats.badPaymentCount === 1 ? "" : "s"} rolled into treasury and are not recoverable.`,
        "Update your rewards wallet to fix future payments.",
      ].join("\n"),
    );
  }
  if (stats.attributionLossCount > 0) {
    banners.push(
      [
        "<b>⚠️ Attribution dropped for some referees</b>",
        `${stats.attributionLossCount} user${stats.attributionLossCount === 1 ? "" : "s"} hit your link before you finished setup; their attribution was not assigned.`,
        "Check that your rewards wallet is set so this doesn't happen again.",
      ].join("\n"),
    );
  }
  return banners;
};

const renderReferralHtml = (
  link: string,
  stats: BotReferralStats,
  phrase: string | null | undefined,
): string => {
  const earned = formatUsdc(stats.lifetimeEarnedUsdc);
  const sections = [
    escapeHtml(resolveAntiPhishingHeader(phrase)),
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
    `<code>${escapeHtml(stats.rewardsWallet)}</code>`,
    "",
    `Referred users: ${stats.referredCount}`,
    `Lifetime earned: $${escapeHtml(earned)} USDC`,
  ];
  const banners = renderBanners(stats);
  if (banners.length > 0) {
    return [...banners, "", ...sections].join("\n");
  }
  return sections.join("\n");
};

const buildKeyboard = (): ReferralView["reply_markup"] => ({
  inline_keyboard: [
    [
      {
        text: "Change rewards wallet",
        callback_data: REFERRAL_CALLBACK.changeRewardsWallet,
      },
    ],
    backHomeRow(),
  ],
});

/**
 * Build the referral view for the user's stable referral-identity
 * wallet (NOT their currently-active wallet — see
 * `getReferralIdentityWallet`). Returns a discriminated union so
 * callers can render the appropriate response for each failure mode
 * without juggling sentinel strings.
 */
const buildView = async (
  env: AppContext["env"],
  userId: number,
  username: string | undefined,
  phrase: string | null | undefined,
): Promise<
  | { ok: true; view: ReferralView }
  | { ok: false; kind: "no_wallet" | "outage" }
> => {
  const wm = buildManager(env);
  const identity = await getReferralIdentityWallet(env, wm, userId);
  if (!identity) return { ok: false, kind: "no_wallet" };

  const stats = await fetchBotReferralStats(env, identity);
  if (!stats.ok) {
    // `invalid_address` is unreachable here — the address comes from
    // our own wallet manager / persisted profile — but treat it as an
    // outage on the off chance the api regresses, rather than
    // surfacing a confusing "Invalid wallet" message to the user.
    logger.warn("fetchBotReferralStats failed", {
      userId,
      kind: stats.kind,
    });
    return { ok: false, kind: "outage" };
  }

  const link = buildLink(env, userId, username);
  return {
    ok: true,
    view: {
      text: renderReferralHtml(link, stats.data, phrase),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: buildKeyboard(),
    },
  };
};

const sendReferral = async (
  ctx: AppContext,
  userId: number,
  username: string | undefined,
): Promise<void> => {
  const result = await buildView(
    ctx.env,
    userId,
    username,
    ctx.session.antiPhishingPhrase,
  );
  if (!result.ok) {
    await ctx.reply(
      result.kind === "no_wallet" ? NO_WALLET_REPLY : OUTAGE_REPLY,
    );
    return;
  }
  await ctx.reply(result.view.text, {
    parse_mode: result.view.parse_mode,
    link_preview_options: result.view.link_preview_options,
    reply_markup: result.view.reply_markup,
  });
};

const REWARDS_WALLET_WARNING = [
  "<b>Changing your rewards wallet does NOT redirect already-attributed referees.</b>",
  "",
  "Past referees keep paying the previously-set address forever, by on-chain attribution. To redirect future earnings from existing referees, you must control the previously-set address.",
  "",
  "Set the new wallet to a long-lived address you control (hardware wallet or main custodial wallet) — avoid exchange deposit addresses or rotating addresses.",
  "",
  "Send the new rewards wallet address (0x-prefixed, 40 hex chars).",
].join("\n");

/**
 * Well-known burn / null addresses. `0x0` is the EVM null sink;
 * `0xdEaD…dEaD` is the de-facto community burn (used by countless
 * token deployers including Uniswap's `MINIMUM_LIQUIDITY` lock).
 * USDC sent to either is unrecoverable forever — surface a warning
 * before persisting so a fat-finger doesn't silently torch every
 * future referral cut. Lowercased for comparison.
 */
const KNOWN_BURN_ADDRESSES: ReadonlySet<string> = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead",
]);

const isKnownBurnAddress = (addr: string): boolean =>
  KNOWN_BURN_ADDRESSES.has(addr.toLowerCase());

/**
 * Best-effort delete of a user-sent message (PIN, address, or burn
 * confirm) from chat history. Mirrors the same hygiene as the /wallet
 * PIN flows so the prompt replacing itself in-place isn't left with
 * the user's prior input still visible below it. Benign 400s (already
 * gone, outside the 48h deleteMessage window) are swallowed so the
 * conversation flow continues uninterrupted.
 */
const sweepUserMessage = async (
  ctx: AppContext,
  chatId: number,
  messageId: number,
): Promise<void> => {
  try {
    await ctx.api.deleteMessage(chatId, messageId);
  } catch {
    // intentionally swallowed — see jsdoc
  }
};

/**
 * Show a wizard prompt: edit the origin bubble (the referral card the
 * user tapped [Change rewards wallet] from) when available, otherwise
 * fall back to a fresh tracked reply. The single-bubble path keeps the
 * change-rewards-wallet wizard from stacking warning → address-retry →
 * PIN-ask → confirm-PIN-ask → retry bubbles down the chat.
 */
const showPrompt = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  origin: MessageRef | undefined,
  text: string,
  parseMode?: "HTML",
): Promise<void> => {
  const wrapped = wrap(ctx, text);
  if (origin) {
    const edited = await conversation.external((outside) =>
      safeEditMessageById(outside, origin, wrapped, {
        parse_mode: parseMode,
        link_preview_options: { is_disabled: true },
        reply_markup: backHomeMarkup(),
      }),
    );
    if (edited) return;
  }
  const msg = await ctx.reply(wrapped, {
    parse_mode: parseMode,
    link_preview_options: { is_disabled: true },
    reply_markup: backHomeMarkup(),
  });
  await trackWorkflowMessage(conversation, msg.message_id);
};

/**
 * Run the PIN set-or-verify flow inline so the rewards-wallet change
 * is gated on the same 6-digit PIN that protects wallet exports and
 * withdrawals. First-time users are walked through a PIN set; users
 * with a PIN already set are verified. Returns true only when the
 * PIN check landed clean.
 */
const runPinGate = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  userId: number,
  chatId: number,
  origin: MessageRef | undefined,
): Promise<boolean> => {
  const pinAlreadySet = await conversation.external((outside) =>
    buildPinManager(outside.env).isPinSet(userId),
  );

  if (!pinAlreadySet) {
    await showPrompt(
      conversation,
      ctx,
      origin,
      "No PIN set yet. Send a new 6-digit PIN (digits only) to protect rewards-wallet changes.",
    );
    let candidate: string | null = null;
    while (candidate === null) {
      const msg = await conversation.waitFor("message:text");
      const text = msg.message.text.trim();
      await conversation.external((outside) =>
        sweepUserMessage(outside, chatId, msg.message.message_id),
      );
      if (isOtherSlashCommand(text)) await haltAndForward(conversation);
      if (!PinManager.isValidPinFormat(text)) {
        await showPrompt(
          conversation,
          ctx,
          origin,
          "PIN must be exactly 6 digits. Send again.",
        );
        continue;
      }
      candidate = text;
    }
    await showPrompt(
      conversation,
      ctx,
      origin,
      "Confirm — send the same 6 digits again.",
    );
    while (true) {
      const msg = await conversation.waitFor("message:text");
      const text = msg.message.text.trim();
      await conversation.external((outside) =>
        sweepUserMessage(outside, chatId, msg.message.message_id),
      );
      if (isOtherSlashCommand(text)) await haltAndForward(conversation);
      if (text !== candidate) {
        await showPrompt(
          conversation,
          ctx,
          origin,
          "PINs do not match. Send the confirmation PIN again.",
        );
        continue;
      }
      break;
    }
    const candidateFinal: string = candidate;
    await conversation.external((outside) =>
      buildPinManager(outside.env).setPin(userId, candidateFinal),
    );
    return true;
  }

  await showPrompt(
    conversation,
    ctx,
    origin,
    "Send your 6-digit PIN to authorise the rewards-wallet change.",
  );
  while (true) {
    const msg = await conversation.waitFor("message:text");
    const text = msg.message.text.trim();
    await conversation.external((outside) =>
      sweepUserMessage(outside, chatId, msg.message.message_id),
    );
    if (isOtherSlashCommand(text)) await haltAndForward(conversation);
    const result = await conversation.external((outside) =>
      buildPinManager(outside.env).verifyPin(userId, text),
    );
    if (result.ok) return true;
    if (result.reason === "locked" || result.reason === "locked-now") {
      const mins = Math.max(
        1,
        Math.ceil((result.retryAt - Date.now()) / 60_000),
      );
      await ctx.reply(
        wrap(ctx,
          `Too many wrong PIN attempts — locked for ~${mins} min. Rewards-wallet change cancelled.`,
        ),
      );
      return false;
    }
    if (result.reason === "unset") {
      await ctx.reply(
        wrap(ctx,
          "PIN state lost — re-run /referral → Change rewards wallet.",
        ),
      );
      return false;
    }
    await showPrompt(
      conversation,
      ctx,
      origin,
      `Wrong PIN. ${result.attemptsRemaining} attempts remaining. Try again.`,
    );
  }
};

/**
 * Change-rewards-wallet conversation. Shows the warning that past
 * attributions don't redirect (per `apps/telegram-bot/AGENTS.md`
 * /referral spec), prompts for the new address, runs the PIN gate,
 * persists via the api, and replies with the updated /referral view.
 */
const changeRewardsWalletConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  origin?: MessageRef,
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  await sweepWorkflow(conversation);

  // KV key for the rewards-wallet record is the user's stable
  // referral-identity wallet, not their current active wallet —
  // otherwise the user could switch active wallet mid-flow and have
  // the change land against a different KV entry than `/referral`
  // displays. See `getReferralIdentityWallet`.
  const identity = await conversation.external((outside) =>
    getReferralIdentityWallet(
      outside.env,
      buildManager(outside.env),
      userId,
    ),
  );
  if (!identity) {
    await ctx.reply(NO_WALLET_REPLY);
    await sweepWorkflow(conversation);
    return;
  }

  // Anti-phishing header is mandatory on every outbound user-facing
  // message (AGENTS.md "Security Model"). The static `wrap()` helper
  // is plain-text only — this reply uses parse_mode=HTML so the user's
  // phrase must be HTML-escaped before concatenation to avoid breaking
  // Telegram's parser if a phrase contains `<` or `&`.
  const warningText = [
    escapeHtml(resolveAntiPhishingHeader(ctxAntiPhishingPhrase(ctx))),
    "",
    REWARDS_WALLET_WARNING,
  ].join("\n");
  // Initial warning is rendered with parse_mode=HTML and a pre-built
  // anti-phishing header (the inner `wrap()` would double-prepend it),
  // so this step uses the explicit edit/reply path rather than
  // `showPrompt`. Subsequent retry prompts route through `showPrompt`
  // since their copy is plain text.
  let warningShown = false;
  if (origin) {
    warningShown = await conversation.external((outside) =>
      safeEditMessageById(outside, origin, warningText, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: backHomeMarkup(),
      }),
    );
  }
  if (!warningShown) {
    const warningMsg = await ctx.reply(warningText, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: backHomeMarkup(),
    });
    await trackWorkflowMessage(conversation, warningMsg.message_id);
  }

  let candidate: string | null = null;
  while (candidate === null) {
    const msg = await conversation.waitFor("message:text");
    const text = msg.message.text.trim();
    if (isOtherSlashCommand(text)) await haltAndForward(conversation);
    // Delete the user's address message immediately — the prompt
    // bubble is about to be edited in place to ask for the PIN, and
    // leaving the prior input hovering below the new prompt is the
    // exact stale-state confusion this flow is trying to avoid.
    // Mirrors the PIN sweep below.
    await conversation.external((outside) =>
      sweepUserMessage(outside, chatId, msg.message.message_id),
    );
    if (!isAddress(text, { strict: false })) {
      await showPrompt(
        conversation,
        ctx,
        origin,
        "Not a valid HyperEVM address. Send a 0x-prefixed 40-char hex address.",
      );
      continue;
    }
    const lowered = text.toLowerCase();
    if (isKnownBurnAddress(lowered)) {
      // AGENTS.md /referral → Rewards wallet: "The bot warns if the
      // user attempts to set the rewards wallet to … a known burn
      // address." Gate the persist behind an explicit `confirm` so a
      // mis-paste can't permanently route earnings into a null sink.
      await showPrompt(
        conversation,
        ctx,
        origin,
        [
          "⚠️ That address is a known burn / null address.",
          "Every USDC payment sent here is permanently unrecoverable — every future referral cut would be lost forever.",
          "",
          "Send 'confirm' to proceed anyway, tap Home to exit, or send a different address.",
        ].join("\n"),
      );
      const confirmMsg = await conversation.waitFor("message:text");
      const confirmText = confirmMsg.message.text.trim();
      if (isOtherSlashCommand(confirmText))
        await haltAndForward(conversation);
      // Same hygiene as the address input above — once consumed, the
      // user's reply doesn't need to sit below the (in-place edited)
      // prompt that will follow.
      await conversation.external((outside) =>
        sweepUserMessage(outside, chatId, confirmMsg.message.message_id),
      );
      if (confirmText.toLowerCase() !== "confirm") {
        // Treat anything else as a fresh address attempt — loop back
        // through the validator so the user can recover from the
        // warning without restarting the wizard.
        if (!isAddress(confirmText, { strict: false })) {
          await showPrompt(
            conversation,
            ctx,
            origin,
            "Aborted. Send 'confirm' or a new 0x-prefixed address, or tap Home to exit.",
          );
          continue;
        }
        const next = confirmText.toLowerCase();
        if (isKnownBurnAddress(next)) {
          await showPrompt(
            conversation,
            ctx,
            origin,
            "That's still a known burn address. Send 'confirm' to proceed, tap Home to exit, or a different address.",
          );
          continue;
        }
        candidate = next;
        continue;
      }
    }
    candidate = lowered;
  }
  const newRewardsWallet: string = candidate;

  const pinOk = await runPinGate(conversation, ctx, userId, chatId, origin);
  if (!pinOk) {
    await sweepWorkflow(conversation);
    return;
  }

  const result = await conversation.external((outside) =>
    setBotRewardsWallet(outside.env, identity, newRewardsWallet),
  );
  if (!result.ok) {
    await ctx.reply(
      wrap(ctx,
        result.kind === "unavailable"
          ? "API temporarily unavailable — try again in a moment."
          : "Could not update rewards wallet. Try again later.",
      ),
    );
    await sweepWorkflow(conversation);
    return;
  }

  // Render the refreshed /referral view straight into the origin
  // bubble so the user lands on it without a fresh "Updated…" toast
  // bubble + new view stacking up beneath it. Falls back to the
  // legacy two-message reply path when the origin is gone.
  const refreshed = await conversation.external((outside) =>
    buildView(
      outside.env,
      userId,
      outside.from?.username,
      outside.session.antiPhishingPhrase,
    ),
  );
  let landed = false;
  if (origin && refreshed.ok) {
    landed = await conversation.external((outside) =>
      safeEditMessageById(outside, origin, refreshed.view.text, {
        parse_mode: refreshed.view.parse_mode,
        link_preview_options: refreshed.view.link_preview_options,
        reply_markup: refreshed.view.reply_markup,
      }),
    );
  }
  if (!landed) {
    await ctx.reply(
      wrap(ctx,
        `Rewards wallet updated to ${result.data.rewardsWallet}.`,
      ),
    );
    await sendReferral(ctx, userId, ctx.from?.username);
  }
  await sweepWorkflow(conversation);
};

export const registerReferralCommand = (bot: Bot<AppContext>): void => {
  bot.use(
    createConversation(
      changeRewardsWalletConversation as (
        conv: Conversation<AppContext, AppContext>,
        ctx: AppContext,
        ...args: unknown[]
      ) => Promise<void>,
      { id: "referral-change-rewards-wallet", parallel: true },
    ),
  );

  bot.command("referral", async (ctx) => {
    if (!ctx.from) {
      await ctx.reply(NO_USER_REPLY);
      return;
    }
    if (!isPrivateChat(ctx)) {
      await ctx.reply(NON_PRIVATE_CHAT_REPLY);
      return;
    }
    await sendReferral(ctx, ctx.from.id, ctx.from.username);
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
    const result = await buildView(
      ctx.env,
      ctx.from.id,
      ctx.from.username,
      ctx.session.antiPhishingPhrase,
    );
    if (!result.ok) {
      await ctx.answerCallbackQuery({
        text: result.kind === "no_wallet" ? NO_WALLET_REPLY : OUTAGE_REPLY,
        show_alert: true,
      });
      return;
    }
    await editToSubmenu(ctx, {
      text: result.view.text,
      parseMode: "HTML",
      inlineKeyboard: result.view.reply_markup.inline_keyboard,
      linkPreviewDisabled: true,
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(REFERRAL_CALLBACK.changeRewardsWallet, async (ctx) => {
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
    const origin: MessageRef | undefined = ctx.callbackQuery.message
      ? {
          chatId: ctx.callbackQuery.message.chat.id,
          messageId: ctx.callbackQuery.message.message_id,
        }
      : undefined;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("referral-change-rewards-wallet", origin);
  });
};
