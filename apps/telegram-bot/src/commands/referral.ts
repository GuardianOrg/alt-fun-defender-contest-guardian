import {
  type Conversation,
  createConversation,
} from "@grammyjs/conversations";
import type { Bot } from "grammy";
import { isAddress } from "viem";

import type { AppContext } from "../bot.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import {
  resolveAntiPhishingHeader,
  wrapWithCtxPhrase as wrap,
} from "../lib/anti-phishing.js";
import {
  fetchBotReferralStats,
  setBotRewardsWallet,
  type BotReferralStats,
} from "../lib/api.js";
import { BOT_NAME } from "../lib/branding.js";
import { closeButtonRow } from "../lib/close.js";
import { formatUsdc } from "../lib/format.js";
import { logger } from "../lib/logger.js";
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
    closeButtonRow(),
  ],
});

/**
 * Build the referral view for the user's active wallet. Returns a
 * discriminated union so callers can render the appropriate response
 * for each failure mode without juggling sentinel strings.
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
  const active = await wm.getActive(userId);
  if (!active) return { ok: false, kind: "no_wallet" };

  const stats = await fetchBotReferralStats(env, active.address);
  if (!stats.ok) {
    // `invalid_address` is unreachable here — the address comes from
    // our own wallet manager — but treat it as an outage on the off
    // chance the api regresses, rather than surfacing a confusing
    // "Invalid wallet" message to the user.
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
  "Send the new rewards wallet address (0x-prefixed, 40 hex chars), or /cancel.",
].join("\n");

const isCancel = (text: string): boolean => text.trim() === "/cancel";

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
 * Best-effort delete of a user-sent PIN message from the chat so the
 * PIN doesn't sit in chat history. Mirrors the same hygiene as the
 * /wallet PIN flows. Benign 400s (already gone, outside the 48h
 * deleteMessage window) are swallowed so the conversation flow
 * continues uninterrupted.
 */
const sweepPinMessage = async (
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
): Promise<boolean> => {
  const pinAlreadySet = await conversation.external((outside) =>
    buildPinManager(outside.env).isPinSet(userId),
  );

  if (!pinAlreadySet) {
    const askMsg = await ctx.reply(
      wrap(ctx,
        "No PIN set yet. Send a new 6-digit PIN (digits only) to protect rewards-wallet changes, or /cancel.",
      ),
    );
    await trackWorkflowMessage(conversation, askMsg.message_id);
    let candidate: string | null = null;
    while (candidate === null) {
      const msg = await conversation.waitFor("message:text");
      const text = msg.message.text.trim();
      await conversation.external((outside) =>
        sweepPinMessage(outside, chatId, msg.message.message_id),
      );
      if (isCancel(text)) {
        await ctx.reply(
          wrap(ctx, "Rewards-wallet change cancelled."),
        );
        return false;
      }
      if (!PinManager.isValidPinFormat(text)) {
        const retry = await ctx.reply(
          wrap(ctx,
            "PIN must be exactly 6 digits. Send again or /cancel.",
          ),
        );
        await trackWorkflowMessage(conversation, retry.message_id);
        continue;
      }
      candidate = text;
    }
    const confirmAsk = await ctx.reply(
      wrap(ctx, "Confirm — send the same 6 digits again."),
    );
    await trackWorkflowMessage(conversation, confirmAsk.message_id);
    while (true) {
      const msg = await conversation.waitFor("message:text");
      const text = msg.message.text.trim();
      await conversation.external((outside) =>
        sweepPinMessage(outside, chatId, msg.message.message_id),
      );
      if (isCancel(text)) {
        await ctx.reply(
          wrap(ctx, "Rewards-wallet change cancelled."),
        );
        return false;
      }
      if (text !== candidate) {
        const retry = await ctx.reply(
          wrap(ctx,
            "PINs do not match. Send the confirmation PIN again or /cancel.",
          ),
        );
        await trackWorkflowMessage(conversation, retry.message_id);
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

  const askMsg = await ctx.reply(
    wrap(ctx,
      "Send your 6-digit PIN to authorise the rewards-wallet change, or /cancel.",
    ),
  );
  await trackWorkflowMessage(conversation, askMsg.message_id);
  while (true) {
    const msg = await conversation.waitFor("message:text");
    const text = msg.message.text.trim();
    await conversation.external((outside) =>
      sweepPinMessage(outside, chatId, msg.message.message_id),
    );
    if (isCancel(text)) {
      await ctx.reply(
        wrap(ctx, "Rewards-wallet change cancelled."),
      );
      return false;
    }
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
    const retry = await ctx.reply(
      wrap(ctx,
        `Wrong PIN. ${result.attemptsRemaining} attempts remaining. Try again or /cancel.`,
      ),
    );
    await trackWorkflowMessage(conversation, retry.message_id);
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
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  await sweepWorkflow(conversation);

  const active = await conversation.external((outside) =>
    buildManager(outside.env).getActive(userId),
  );
  if (!active) {
    await ctx.reply(NO_WALLET_REPLY);
    await sweepWorkflow(conversation);
    return;
  }

  const warningMsg = await ctx.reply(REWARDS_WALLET_WARNING, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
  await trackWorkflowMessage(conversation, warningMsg.message_id);

  let candidate: string | null = null;
  while (candidate === null) {
    const msg = await conversation.waitFor("message:text");
    await trackWorkflowMessage(conversation, msg.message.message_id);
    const text = msg.message.text.trim();
    if (isCancel(text)) {
      await ctx.reply(
        wrap(ctx, "Rewards-wallet change cancelled."),
      );
      await sweepWorkflow(conversation);
      return;
    }
    if (!isAddress(text, { strict: false })) {
      const retry = await ctx.reply(
        wrap(ctx,
          "Not a valid HyperEVM address. Send a 0x-prefixed 40-char hex address, or /cancel.",
        ),
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    const lowered = text.toLowerCase();
    if (isKnownBurnAddress(lowered)) {
      // AGENTS.md /referral → Rewards wallet: "The bot warns if the
      // user attempts to set the rewards wallet to … a known burn
      // address." Gate the persist behind an explicit `confirm` so a
      // mis-paste can't permanently route earnings into a null sink.
      const warn = await ctx.reply(
        wrap(ctx,
          [
            "⚠️ That address is a known burn / null address.",
            "Every USDC payment sent here is permanently unrecoverable — every future referral cut would be lost forever.",
            "",
            "Send 'confirm' to proceed anyway, /cancel to abort, or send a different address.",
          ].join("\n"),
        ),
      );
      await trackWorkflowMessage(conversation, warn.message_id);
      const confirmMsg = await conversation.waitFor("message:text");
      await trackWorkflowMessage(conversation, confirmMsg.message.message_id);
      const confirmText = confirmMsg.message.text.trim();
      if (isCancel(confirmText)) {
        await ctx.reply(
          wrap(ctx, "Rewards-wallet change cancelled."),
        );
        await sweepWorkflow(conversation);
        return;
      }
      if (confirmText.toLowerCase() !== "confirm") {
        // Treat anything else as a fresh address attempt — loop back
        // through the validator so the user can recover from the
        // warning without restarting the wizard.
        if (!isAddress(confirmText, { strict: false })) {
          const retry = await ctx.reply(
            wrap(ctx,
              "Aborted. Send 'confirm', /cancel, or a new 0x-prefixed address.",
            ),
          );
          await trackWorkflowMessage(conversation, retry.message_id);
          continue;
        }
        const next = confirmText.toLowerCase();
        if (isKnownBurnAddress(next)) {
          const retry = await ctx.reply(
            wrap(ctx,
              "That's still a known burn address. Send 'confirm' to proceed, /cancel to abort, or a different address.",
            ),
          );
          await trackWorkflowMessage(conversation, retry.message_id);
          continue;
        }
        candidate = next;
        continue;
      }
    }
    candidate = lowered;
  }
  const newRewardsWallet: string = candidate;

  const pinOk = await runPinGate(conversation, ctx, userId, chatId);
  if (!pinOk) {
    await sweepWorkflow(conversation);
    return;
  }

  const result = await conversation.external((outside) =>
    setBotRewardsWallet(outside.env, active.address, newRewardsWallet),
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

  await ctx.reply(
    wrap(ctx,
      `Rewards wallet updated to ${result.data.rewardsWallet}.`,
    ),
  );
  await sendReferral(ctx, userId, ctx.from?.username);
  await sweepWorkflow(conversation);
};

export const registerReferralCommand = (bot: Bot<AppContext>): void => {
  bot.use(
    createConversation(
      changeRewardsWalletConversation,
      "referral-change-rewards-wallet",
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
    await ctx.answerCallbackQuery();
    await sendReferral(ctx, ctx.from.id, ctx.from.username);
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
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("referral-change-rewards-wallet");
  });
};
