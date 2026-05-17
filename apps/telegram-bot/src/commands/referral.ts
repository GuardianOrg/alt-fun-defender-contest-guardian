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
  OUTAGE_REPLY as I18N_OUTAGE_REPLY,
  PIN_DO_NOT_MATCH_REPLY,
  PIN_INVALID_FORMAT_REPLY,
  PIN_LOCKED_REPLY,
  PIN_STATE_LOST_REPLY,
  PIN_WRONG_RETRY_REPLY,
  REFERRAL_CHANGE_REWARDS_WALLET_ACTION_LABEL,
  REFERRAL_CHANGE_REWARDS_WALLET_RETRY_HINT,
  REFERRAL_ABORTED_RETRY_PROMPT,
  REFERRAL_BURN_ADDRESS_WARNING_REPLY,
  REFERRAL_BURN_CONFIRM_PROMPT,
  REFERRAL_BURN_PAYMENT_LOST_WARNING,
  REFERRAL_CHANGE_REWARDS_WALLET_BUTTON,
  REFERRAL_CHECK_REWARDS_WALLET_HINT,
  REFERRAL_COULD_NOT_UPDATE_REPLY,
  REFERRAL_CUSTOM_BUTTON,
  REFERRAL_HEADER_ATTRIBUTION_DROPPED,
  REFERRAL_HEADER_CHANGE_DOES_NOT_REDIRECT,
  REFERRAL_HEADER_CHANGE_REWARDS_WALLET,
  REFERRAL_HEADER_REWARDS_REJECTING,
  REFERRAL_HEADER_YOUR_REFERRAL,
  REFERRAL_INVALID_ADDRESS_REPLY,
  REFERRAL_LIFETIME_EARNED_LABEL,
  REFERRAL_LINK_LABEL,
  REFERRAL_LONG_LIVED_HINT,
  REFERRAL_REFERRED_USERS_LABEL,
  REFERRAL_NO_USER_REPLY as I18N_REFERRAL_NO_USER_REPLY,
  REFERRAL_NO_WALLET_REPLY as I18N_REFERRAL_NO_WALLET_REPLY,
  REFERRAL_NON_PRIVATE_CHAT_REPLY as I18N_REFERRAL_NON_PRIVATE_CHAT_REPLY,
  REFERRAL_PAST_REFEREES_WARNING,
  REFERRAL_PICK_OR_CUSTOM_HINT,
  REFERRAL_PIN_CONFIRM_PROMPT,
  REFERRAL_PRIVATE_DM_ONLY_REPLY,
  REFERRAL_REWARDS_WALLET_LABEL,
  REFERRAL_SEND_NEW_ADDRESS_PROMPT,
  REFERRAL_SET_PIN_PROMPT,
  REFERRAL_SHARE_LINK_LEAD,
  REFERRAL_STILL_BURN_RETRY_PROMPT,
  REFERRAL_UPDATE_REWARDS_WALLET_HINT,
  REFERRAL_VERIFY_PIN_PROMPT,
  REFERRAL_WALLET_NO_LONGER_AVAILABLE_REPLY,
  TAP_TO_COPY_HINT,
  TOAST_MISSING_USER,
} from "../lib/i18n.js";
import {
  backHomeMarkup,
  backHomeRow,
  editToSubmenu,
  type MessageRef,
  replyWithNav,
  safeEditMessageById,
} from "../lib/nav.js";
import { formatUsdc } from "../lib/format.js";
import { logger } from "../lib/logger.js";
import { getReferralIdentityWallet } from "../lib/onboarding.js";
import { PinManager } from "../lib/pin.js";
import { type StoredWallet, WalletManager } from "../lib/wallet.js";
import {
  sweepWorkflow,
  trackWorkflowMessage,
} from "../lib/workflow-stack-conversation.js";

const DEFAULT_BOT_USERNAME = BOT_NAME;

const NON_PRIVATE_CHAT_REPLY = I18N_REFERRAL_NON_PRIVATE_CHAT_REPLY.English;

const NO_USER_REPLY = I18N_REFERRAL_NO_USER_REPLY.English;

const NO_WALLET_REPLY = I18N_REFERRAL_NO_WALLET_REPLY.English;

const OUTAGE_REPLY = I18N_OUTAGE_REPLY.English;

/**
 * Short callback codes for the /referral surface. Prefixed `rf:` so
 * they never collide with the start-menu (`st:*`), wallet (`w*`), or
 * positions (`pp:*`) namespaces, and each code stays well inside
 * Telegram's 64-byte callback_data budget.
 *
 * `changeRewardsWallet` opens the picker view. The picker offers one
 * button per existing custodial wallet (`pickRewardsWalletPrefix` +
 * walletId — `rf:cw:w:w_xxxxxx` = 16 bytes) plus a `Custom` button
 * (`pickRewardsWalletCustom`) that enters the legacy address-entry
 * wizard for an arbitrary HyperEVM address.
 */
export const REFERRAL_CALLBACK = {
  changeRewardsWallet: "rf:cw",
  pickRewardsWalletCustom: "rf:cw:c",
  pickRewardsWalletPrefix: "rf:cw:w:",
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
        REFERRAL_HEADER_REWARDS_REJECTING.English,
        `${stats.badPaymentCount} referral payment${stats.badPaymentCount === 1 ? "" : "s"} rolled into treasury and are not recoverable.`,
        REFERRAL_UPDATE_REWARDS_WALLET_HINT.English,
      ].join("\n"),
    );
  }
  if (stats.attributionLossCount > 0) {
    banners.push(
      [
        REFERRAL_HEADER_ATTRIBUTION_DROPPED.English,
        `${stats.attributionLossCount} user${stats.attributionLossCount === 1 ? "" : "s"} hit your link before you finished setup; their attribution was not assigned.`,
        REFERRAL_CHECK_REWARDS_WALLET_HINT.English,
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
    REFERRAL_HEADER_YOUR_REFERRAL.English,
    "",
    REFERRAL_SHARE_LINK_LEAD.English,
    "",
    REFERRAL_LINK_LABEL.English,
    `<code>${escapeHtml(link)}</code>`,
    TAP_TO_COPY_HINT.English,
    "",
    REFERRAL_REWARDS_WALLET_LABEL.English,
    `<code>${escapeHtml(stats.rewardsWallet)}</code>`,
    "",
    REFERRAL_REFERRED_USERS_LABEL.English(stats.referredCount),
    REFERRAL_LIFETIME_EARNED_LABEL.English(escapeHtml(earned)),
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
        text: REFERRAL_CHANGE_REWARDS_WALLET_BUTTON.English,
        callback_data: REFERRAL_CALLBACK.changeRewardsWallet,
      },
    ],
    backHomeRow(),
  ],
});

/**
 * Shortened address rendering for the rewards-wallet picker buttons —
 * matches the format the wallets api description uses (`0x5A2e...F444`,
 * three ASCII dots, not the `…` U+2026 ellipsis used by some other
 * surfaces) so the button label stays consistent with the api docs and
 * remains greppable as plain ASCII.
 */
const shortenWalletAddress = (addr: string): string =>
  `${addr.slice(0, 6)}...${addr.slice(-4)}`;

/**
 * Label rendered on a wallet picker button — uses the user-set label
 * when present, falls back to the shortened address otherwise. Mirrors
 * the AGENTS.md `/referral → Rewards wallet` picker spec.
 */
const pickerButtonLabel = (w: StoredWallet): string =>
  w.label && w.label.trim().length > 0
    ? w.label
    : shortenWalletAddress(w.address);

/**
 * Build the rewards-wallet picker keyboard. Existing custodial wallets
 * render two-per-row (single column on the trailing row if the count
 * is odd), followed by a dedicated `Custom` row and the standard
 * Back / Home row. The picker is always shown even when the user has
 * zero wallets — in that case only Custom + Back/Home render, which
 * still gives them a path through to the address-entry wizard.
 *
 * When `currentRewardsWallet` matches a custodial wallet address
 * (case-insensitive, since EVM addresses are case-insensitive on the
 * wire), that button's label is wrapped in `• … •` bullet markers to
 * mirror the slippage-preset selected-state indicator from
 * `keyboards/settings-actions.ts :: buildSettingsKeyboard`.
 */
const buildPickerKeyboard = (
  wallets: StoredWallet[],
  currentRewardsWallet?: string | null,
): { text: string; callback_data: string }[][] => {
  const currentLower = currentRewardsWallet?.toLowerCase();
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < wallets.length; i += 2) {
    const row: { text: string; callback_data: string }[] = [];
    for (let j = i; j < Math.min(i + 2, wallets.length); j++) {
      const w = wallets[j]!;
      const label = pickerButtonLabel(w);
      const isCurrent =
        currentLower !== undefined &&
        currentLower !== null &&
        w.address.toLowerCase() === currentLower;
      row.push({
        text: isCurrent ? `• ${label} •` : label,
        callback_data: `${REFERRAL_CALLBACK.pickRewardsWalletPrefix}${w.id}`,
      });
    }
    rows.push(row);
  }
  rows.push([
    {
      text: REFERRAL_CUSTOM_BUTTON.English,
      callback_data: REFERRAL_CALLBACK.pickRewardsWalletCustom,
    },
  ]);
  rows.push(backHomeRow());
  return rows;
};

const PICKER_INTRO = [
  REFERRAL_HEADER_CHANGE_REWARDS_WALLET.English,
  "",
  REFERRAL_HEADER_CHANGE_DOES_NOT_REDIRECT.English,
  "",
  REFERRAL_PAST_REFEREES_WARNING.English,
  "",
  REFERRAL_PICK_OR_CUSTOM_HINT.English,
].join("\n");

const renderPickerHtml = (phrase: string | null | undefined): string =>
  [escapeHtml(resolveAntiPhishingHeader(phrase)), "", PICKER_INTRO].join("\n");

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
    await replyWithNav(
      ctx,
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
  REFERRAL_HEADER_CHANGE_DOES_NOT_REDIRECT.English,
  "",
  REFERRAL_PAST_REFEREES_WARNING.English,
  "",
  REFERRAL_LONG_LIVED_HINT.English,
  "",
  REFERRAL_SEND_NEW_ADDRESS_PROMPT.English,
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
      REFERRAL_SET_PIN_PROMPT.English,
    );
    let candidate: string | null = null;
    while (candidate === null) {
      const msg = await conversation.waitFor("message:text");
      const text = msg.message.text.trim();
      if (isOtherSlashCommand(text)) await haltAndForward(conversation);
      await conversation.external((outside) =>
        sweepUserMessage(outside, chatId, msg.message.message_id),
      );
      if (!PinManager.isValidPinFormat(text)) {
        await showPrompt(
          conversation,
          ctx,
          origin,
          PIN_INVALID_FORMAT_REPLY.English,
        );
        continue;
      }
      candidate = text;
    }
    await showPrompt(
      conversation,
      ctx,
      origin,
      REFERRAL_PIN_CONFIRM_PROMPT.English,
    );
    while (true) {
      const msg = await conversation.waitFor("message:text");
      const text = msg.message.text.trim();
      if (isOtherSlashCommand(text)) await haltAndForward(conversation);
      await conversation.external((outside) =>
        sweepUserMessage(outside, chatId, msg.message.message_id),
      );
      if (text !== candidate) {
        await showPrompt(
          conversation,
          ctx,
          origin,
          PIN_DO_NOT_MATCH_REPLY.English,
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
    REFERRAL_VERIFY_PIN_PROMPT.English,
  );
  while (true) {
    const msg = await conversation.waitFor("message:text");
    const text = msg.message.text.trim();
    if (isOtherSlashCommand(text)) await haltAndForward(conversation);
    await conversation.external((outside) =>
      sweepUserMessage(outside, chatId, msg.message.message_id),
    );
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
        wrap(
          ctx,
          PIN_LOCKED_REPLY.English(
            mins,
            REFERRAL_CHANGE_REWARDS_WALLET_ACTION_LABEL.English,
          ),
        ),
      );
      return false;
    }
    if (result.reason === "unset") {
      await ctx.reply(
        wrap(
          ctx,
          PIN_STATE_LOST_REPLY.English(
            REFERRAL_CHANGE_REWARDS_WALLET_RETRY_HINT.English,
          ),
        ),
      );
      return false;
    }
    await showPrompt(
      conversation,
      ctx,
      origin,
      PIN_WRONG_RETRY_REPLY.English(result.attemptsRemaining),
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
    await ctx.reply(wrap(ctx, NO_WALLET_REPLY));
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
        REFERRAL_INVALID_ADDRESS_REPLY.English,
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
          REFERRAL_BURN_ADDRESS_WARNING_REPLY.English,
          REFERRAL_BURN_PAYMENT_LOST_WARNING.English,
          "",
          REFERRAL_BURN_CONFIRM_PROMPT.English,
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
            REFERRAL_ABORTED_RETRY_PROMPT.English,
          );
          continue;
        }
        const next = confirmText.toLowerCase();
        if (isKnownBurnAddress(next)) {
          await showPrompt(
            conversation,
            ctx,
            origin,
            REFERRAL_STILL_BURN_RETRY_PROMPT.English,
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
          : REFERRAL_COULD_NOT_UPDATE_REPLY.English,
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

/**
 * Pick-known-wallet conversation. Reached when the user taps one of the
 * existing-wallet buttons on the rewards-wallet picker. The address is
 * already known (it's one of the user's custodial wallets), so the
 * flow skips the address-entry + burn-warning steps that
 * `changeRewardsWalletConversation` runs and goes straight from the
 * picker into the PIN gate, then persists the choice and re-renders
 * the refreshed /referral view in place of the picker.
 */
const pickKnownRewardsWalletConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  args?: { walletId: string; origin?: MessageRef },
): Promise<void> => {
  if (!ctx.from || !ctx.chat || !args) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const { walletId, origin } = args;
  await sweepWorkflow(conversation);

  const identity = await conversation.external((outside) =>
    getReferralIdentityWallet(
      outside.env,
      buildManager(outside.env),
      userId,
    ),
  );
  if (!identity) {
    await showPrompt(conversation, ctx, origin, NO_WALLET_REPLY);
    await sweepWorkflow(conversation);
    return;
  }

  const picked = await conversation.external((outside) =>
    buildManager(outside.env).getWallet(userId, walletId),
  );
  if (!picked) {
    await showPrompt(
      conversation,
      ctx,
      origin,
      REFERRAL_WALLET_NO_LONGER_AVAILABLE_REPLY.English,
    );
    await sweepWorkflow(conversation);
    return;
  }
  const newRewardsWallet = picked.address.toLowerCase();

  const pinOk = await runPinGate(conversation, ctx, userId, chatId, origin);
  if (!pinOk) {
    await sweepWorkflow(conversation);
    return;
  }

  const result = await conversation.external((outside) =>
    setBotRewardsWallet(outside.env, identity, newRewardsWallet),
  );
  if (!result.ok) {
    if (result.kind === "unavailable") {
      await showPrompt(conversation, ctx, origin, OUTAGE_REPLY);
    } else {
      await ctx.reply(
        wrap(ctx, REFERRAL_COULD_NOT_UPDATE_REPLY.English),
      );
    }
    await sweepWorkflow(conversation);
    return;
  }

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
  bot.use(
    createConversation(
      pickKnownRewardsWalletConversation as (
        conv: Conversation<AppContext, AppContext>,
        ctx: AppContext,
        ...args: unknown[]
      ) => Promise<void>,
      { id: "referral-pick-known-wallet", parallel: true },
    ),
  );

  bot.command("referral", async (ctx) => {
    if (!ctx.from) {
      await ctx.reply(wrap(ctx, NO_USER_REPLY));
      return;
    }
    if (!isPrivateChat(ctx)) {
      await ctx.reply(wrap(ctx, NON_PRIVATE_CHAT_REPLY));
      return;
    }
    await sendReferral(ctx, ctx.from.id, ctx.from.username);
  });

  bot.callbackQuery(START_CALLBACK.referral, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery({ text: TOAST_MISSING_USER.English });
      return;
    }
    if (!isPrivateChat(ctx)) {
      await ctx.answerCallbackQuery({
        text: REFERRAL_PRIVATE_DM_ONLY_REPLY.English,
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
      await ctx.answerCallbackQuery({ text: TOAST_MISSING_USER.English });
      return;
    }
    if (!isPrivateChat(ctx)) {
      await ctx.answerCallbackQuery({
        text: REFERRAL_PRIVATE_DM_ONLY_REPLY.English,
        show_alert: true,
      });
      return;
    }
    const wm = buildManager(ctx.env);
    const wallets = await wm.listWallets(ctx.from.id);
    // Resolve the user's current rewards wallet so we can mark the
    // matching picker button with the slippage-style `• … •` selected
    // indicator. A failure here (no identity wallet yet, api outage)
    // degrades cleanly to an unmarked picker — the picker itself must
    // remain reachable so the user can still set a wallet for the
    // first time.
    const identity = await getReferralIdentityWallet(ctx.env, wm, ctx.from.id);
    let currentRewardsWallet: string | null = null;
    if (identity) {
      const stats = await fetchBotReferralStats(ctx.env, identity);
      if (stats.ok) {
        currentRewardsWallet = stats.data.rewardsWallet;
      } else {
        logger.warn("fetchBotReferralStats failed in picker", {
          userId: ctx.from.id,
          kind: stats.kind,
        });
      }
    }
    await editToSubmenu(ctx, {
      text: renderPickerHtml(ctx.session.antiPhishingPhrase),
      parseMode: "HTML",
      inlineKeyboard: buildPickerKeyboard(wallets, currentRewardsWallet),
      linkPreviewDisabled: true,
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(REFERRAL_CALLBACK.pickRewardsWalletCustom, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery({ text: TOAST_MISSING_USER.English });
      return;
    }
    if (!isPrivateChat(ctx)) {
      await ctx.answerCallbackQuery({
        text: REFERRAL_PRIVATE_DM_ONLY_REPLY.English,
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

  bot.callbackQuery(
    new RegExp(
      `^${REFERRAL_CALLBACK.pickRewardsWalletPrefix.replace(/:/g, "\\:")}(w_[0-9a-z]{6})$`,
    ),
    async (ctx) => {
      if (!ctx.from) {
        await ctx.answerCallbackQuery({ text: TOAST_MISSING_USER.English });
        return;
      }
      if (!isPrivateChat(ctx)) {
        await ctx.answerCallbackQuery({
          text: REFERRAL_PRIVATE_DM_ONLY_REPLY.English,
          show_alert: true,
        });
        return;
      }
      const data = ctx.callbackQuery.data ?? "";
      const walletId = data.slice(
        REFERRAL_CALLBACK.pickRewardsWalletPrefix.length,
      );
      const origin: MessageRef | undefined = ctx.callbackQuery.message
        ? {
            chatId: ctx.callbackQuery.message.chat.id,
            messageId: ctx.callbackQuery.message.message_id,
          }
        : undefined;
      await ctx.answerCallbackQuery();
      await ctx.conversation.enter("referral-pick-known-wallet", {
        walletId,
        origin,
      });
    },
  );
};
