/**
 * `/withdraw <asset> <amount> <address>` — moves funds out of the
 * active custodial wallet to an external EVM address. Native HYPE and
 * USDC only in v1; tokens held in bonding-curve positions are exited
 * via `/sell` first, never withdrawn directly.
 *
 * Flow (AGENTS.md `/withdraw`):
 *   1. Pre-flight: withdrawal lock check, args parse, basic validation.
 *      Both block before the PIN prompt so a wrong-lock state never
 *      consumes a brute-force attempt.
 *   2. PIN verification through `PinManager.verifyPin` — counter +
 *      30-minute lockout shared with the other PIN-gated flows.
 *   3. Stage a `pendingWithdraw` intent in `ctx.session` with a 60-second
 *      `expiresAt` and a one-shot nonce. The Confirm button carries the
 *      nonce in its callback_data so a stale or replayed tap is a no-op.
 *   4. On Confirm: decrypt the active wallet's key, submit the tx
 *      (`executeWithdraw`), and reply with the explorer link.
 *
 * The slash-command form parses inline args. Both the `/start → Withdraw`
 * button and `/wallet → Withdraw` button enter the same wizard
 * conversation, which prompts step-by-step for the same three inputs.
 */

import {
  type Conversation,
  createConversation,
} from "@grammyjs/conversations";
import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import {
  type InlineCallbackButton,
  WALLET_CALLBACK,
} from "../keyboards/wallet-actions.js";
import { withAntiPhishing } from "../lib/anti-phishing.js";
import {
  haltAndForward,
  isOtherSlashCommand,
  tryAddressBuyIntercept,
} from "../lib/conversation-commands.js";
import {
  backHomeMarkup,
  backHomeRow,
  editToSubmenu,
  type MessageRef,
  safeEditMessageById,
} from "../lib/nav.js";
import {
  WITHDRAW_LOCKED_REPLY as I18N_WITHDRAW_LOCKED_REPLY,
  WITHDRAW_NO_ACTIVE_WALLET_REPLY as I18N_WITHDRAW_NO_ACTIVE_WALLET_REPLY,
  WITHDRAW_NO_PIN_REPLY as I18N_WITHDRAW_NO_PIN_REPLY,
  WITHDRAW_NO_USER_REPLY as I18N_WITHDRAW_NO_USER_REPLY,
  WITHDRAW_NON_PRIVATE_CHAT_REPLY as I18N_WITHDRAW_NON_PRIVATE_CHAT_REPLY,
  WITHDRAW_USAGE_HINT_REPLY,
} from "../lib/i18n.js";
import { PinManager } from "../lib/pin.js";
import { fetchNativeBalance, fetchUsdcBalance } from "../lib/rpc.js";
import { SecurityState } from "../lib/security-state.js";
import {
  executeWithdraw,
  formatAmount,
  isWithdrawAsset,
  parseAmount,
  parseDestination,
  type Hex,
  type WithdrawAsset,
} from "../lib/withdraw.js";
import { explorerTxUrl } from "../lib/trade.js";
import { WalletManager } from "../lib/wallet.js";
import {
  sweepWorkflow,
  trackWorkflowMessage,
} from "../lib/workflow-stack-conversation.js";

const NO_USER_REPLY = I18N_WITHDRAW_NO_USER_REPLY.English;

const NON_PRIVATE_CHAT_REPLY = I18N_WITHDRAW_NON_PRIVATE_CHAT_REPLY.English;

const NO_ACTIVE_WALLET_REPLY = I18N_WITHDRAW_NO_ACTIVE_WALLET_REPLY.English;

const WITHDRAW_LOCKED_REPLY = I18N_WITHDRAW_LOCKED_REPLY.English;

const NO_PIN_REPLY = I18N_WITHDRAW_NO_PIN_REPLY.English;

const USAGE_HINT = WITHDRAW_USAGE_HINT_REPLY.English;

/** Match the trade-confirmation window in `lib/execute.ts`. */
const CONFIRM_WINDOW_MS = 60_000;

const isPrivateChat = (ctx: AppContext): boolean =>
  ctx.chat?.type === "private";

const buildPinManager = (env: AppContext["env"]): PinManager =>
  new PinManager(env.WALLET_KV, { saltRounds: env.PIN_SALT_ROUNDS });

const buildSecurityState = (env: AppContext["env"]): SecurityState =>
  new SecurityState(env.WALLET_KV);

const buildWalletManager = (env: AppContext["env"]): WalletManager =>
  new WalletManager(env.WALLET_KV, env.MASTER_KEY);

const newNonce = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
};

const sweepMessage = async (
  ctx: AppContext,
  chatId: number,
  messageId: number,
): Promise<void> => {
  try {
    await ctx.api.deleteMessage(chatId, messageId);
  } catch {
    // Same rationale as `commands/security.ts :: sweepPinMessage` — the
    // 48h delete window plus user-deleted-already cases are both benign.
  }
};

interface ParsedArgs {
  asset: WithdrawAsset;
  amountRaw: bigint;
  to: Hex;
}

type ParseResult =
  | { ok: true; args: ParsedArgs }
  | { ok: false; reason: string };

const parseInlineArgs = (raw: string): ParseResult => {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 3) return { ok: false, reason: USAGE_HINT };
  const [assetRaw, amountRaw, addressRaw] = parts as [string, string, string];
  const assetUpper = assetRaw.toUpperCase();
  if (!isWithdrawAsset(assetUpper)) {
    return { ok: false, reason: `Unsupported asset "${assetRaw}". ${USAGE_HINT}` };
  }
  const amount = parseAmount(amountRaw, assetUpper);
  if (amount === null) {
    return {
      ok: false,
      reason: `Invalid amount "${amountRaw}" — must be a positive decimal within the asset's precision.`,
    };
  }
  const to = parseDestination(addressRaw);
  if (to === null) {
    return {
      ok: false,
      reason: `Invalid destination address "${addressRaw}" — must be a 0x-prefixed 40-character hex string.`,
    };
  }
  return { ok: true, args: { asset: assetUpper, amountRaw: amount, to } };
};

/**
 * Read the active wallet's balance for the chosen asset. Returns `null`
 * on any RPC failure so the caller can render a clean "unavailable"
 * fallback — matches the rest of the bot's RPC error handling policy.
 */
const fetchAssetBalance = async (
  env: AppContext["env"],
  asset: WithdrawAsset,
  address: string,
): Promise<bigint | null> =>
  asset === "HYPE"
    ? fetchNativeBalance(env, address)
    : fetchUsdcBalance(env, address);

/**
 * `conversation.external` requires a JSON-serialisable return value —
 * `bigint` is not. Stringify inside the external call and parse back so
 * the conversations plugin can replay the result on later turns.
 */
const fetchAssetBalanceExternal = async (
  conversation: Conversation<AppContext, AppContext>,
  asset: WithdrawAsset,
  address: string,
): Promise<bigint | null> => {
  const stringified = await conversation.external((outside) =>
    fetchAssetBalance(outside.env, asset, address).then((v) =>
      v === null ? null : v.toString(),
    ),
  );
  return stringified === null ? null : BigInt(stringified);
};

export interface AssetBalances {
  usdc: bigint | null;
  hype: bigint | null;
}

/**
 * Read USDC and HYPE balances in parallel for the asset-picker prompt.
 * Same `conversation.external` + bigint-stringify pattern as the
 * single-asset helper — both legs degrade to `null` independently so
 * one RPC blip doesn't suppress the other balance from the prompt.
 */
const fetchBothBalancesExternal = async (
  conversation: Conversation<AppContext, AppContext>,
  address: string,
): Promise<AssetBalances> => {
  const stringified = await conversation.external((outside) =>
    Promise.all([
      fetchUsdcBalance(outside.env, address),
      fetchNativeBalance(outside.env, address),
    ]).then(([usdc, hype]) => ({
      usdc: usdc === null ? null : usdc.toString(),
      hype: hype === null ? null : hype.toString(),
    })),
  );
  return {
    usdc: stringified.usdc === null ? null : BigInt(stringified.usdc),
    hype: stringified.hype === null ? null : BigInt(stringified.hype),
  };
};

const formatBalance = (
  balance: bigint | null,
  asset: WithdrawAsset,
): string =>
  balance === null
    ? "unavailable"
    : `${formatAmount(balance, asset)} ${asset}`;

/**
 * Asset-picker callback codes. Wizard `waitForCallbackQuery` filter
 * matches exactly these so a stray `nav:b` / `nav:h` tap falls through
 * to the global nav handler instead of being mis-decoded as an asset
 * pick. Kept under the same `wd*` namespace as the staged-confirm
 * (`wdc:`) and cancel (`wdcl:`) codes so the audit surface for
 * withdraw callbacks is a single grep.
 */
const WITHDRAW_ASSET_CALLBACK = {
  usdc: "wda:usdc",
  hype: "wda:hype",
} as const;

const ASSET_PICKER_PATTERN = /^wda:(usdc|hype)$/;

const renderAssetPrompt = (balances: AssetBalances): string =>
  [
    "Which asset?",
    "",
    `You have ${formatBalance(balances.usdc, "USDC")} and ${formatBalance(balances.hype, "HYPE")}.`,
  ].join("\n");

/**
 * USDC on the left per product spec — the most common withdraw asset
 * sits under the thumb, mirroring the buy / sell preset ordering on the
 * trade cards. Back/Home row is appended so a user who taps the wizard
 * by mistake can exit without sending a stray text.
 */
const assetPickerKeyboard = (): InlineCallbackButton[][] => [
  [
    { text: "USDC", callback_data: WITHDRAW_ASSET_CALLBACK.usdc },
    { text: "HYPE", callback_data: WITHDRAW_ASSET_CALLBACK.hype },
  ],
  backHomeRow(),
];

const assetFromCallback = (data: string): WithdrawAsset | null => {
  const m = ASSET_PICKER_PATTERN.exec(data);
  if (!m) return null;
  return m[1] === "usdc" ? "USDC" : "HYPE";
};

const renderSummary = (args: ParsedArgs, balance: bigint | null): string => {
  const lines = [
    "Withdraw summary",
    "",
    `• Asset: ${args.asset}`,
    `• Amount: ${formatAmount(args.amountRaw, args.asset)} ${args.asset}`,
    `• Available balance: ${formatBalance(balance, args.asset)}`,
    `• Destination: ${args.to}`,
  ];
  if (balance !== null && args.amountRaw > balance) {
    lines.push(
      "",
      "⚠️ Amount exceeds available balance — withdraw will fail.",
    );
  }
  lines.push("", "Tap Confirm Withdraw within 60s to submit.");
  return lines.join("\n");
};

const confirmKeyboard = (
  nonce: string,
): Array<Array<{ text: string; callback_data: string }>> => [
  [
    { text: "✅ Confirm Withdraw", callback_data: `wdc:${nonce}` },
    { text: "✖ Cancel", callback_data: `wdcl:${nonce}` },
  ],
];

const renderError = (
  result: Exclude<Awaited<ReturnType<typeof executeWithdraw>>, { ok: true }>,
): string => {
  if (result.kind === "insufficient_funds") {
    return "Insufficient balance for the requested amount + gas.";
  }
  if (result.kind === "reverted") {
    return `Transaction reverted${result.reason ? `: ${result.reason}` : ""}.`;
  }
  return `RPC unavailable${result.reason ? `: ${result.reason}` : ""} — try again in a moment.`;
};

/**
 * Verify the user's PIN inside a conversation. Loops on wrong PIN until
 * the user `/cancel`s or hits the lockout. Returns `true` only on a
 * clean verify; every failure mode replies a user-facing message and
 * returns `false` so the caller can abort the flow.
 */
const verifyPinForWithdraw = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  userId: number,
  chatId: number,
): Promise<boolean> => {
  const askMsg = await ctx.reply(
    withAntiPhishing(
      "Send your 6-digit PIN to authorise the withdraw.",
    ),
    { reply_markup: backHomeMarkup() },
  );
  await trackWorkflowMessage(conversation, askMsg.message_id);
  while (true) {
    const msg = await conversation.waitFor("message:text");
    const text = msg.message.text.trim();
    // PIN reply is swept individually for security; not tracked on the
    // workflow stack (already gone by the time a later sweep would run).
    await conversation.external((outside) =>
      sweepMessage(outside, chatId, msg.message.message_id),
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
        withAntiPhishing(
          `Too many wrong PIN attempts — locked for ~${mins} min. Withdraw cancelled.`,
        ),
      );
      return false;
    }
    if (result.reason === "unset") {
      await ctx.reply(withAntiPhishing(NO_PIN_REPLY));
      return false;
    }
    const retry = await ctx.reply(
      withAntiPhishing(
        `Wrong PIN. ${result.attemptsRemaining} attempts remaining. Try again.`,
      ),
      { reply_markup: backHomeMarkup() },
    );
    await trackWorkflowMessage(conversation, retry.message_id);
  }
};

/**
 * The `interceptBuy` flag lets non-address prompts (asset, amount) pivot
 * to the buy menu when a user pastes a contract address — see issue #821.
 * The destination-address prompt must keep it off: a 0x-prefixed input
 * there is the user's withdraw target, not a token to buy.
 */
const promptArg = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  prompt: string,
  interceptBuy = false,
): Promise<string | null> => {
  const promptMsg = await ctx.reply(withAntiPhishing(prompt), {
    reply_markup: backHomeMarkup(),
  });
  await trackWorkflowMessage(conversation, promptMsg.message_id);
  const reply = await conversation.waitFor("message:text");
  const text = reply.message.text.trim();
  if (isOtherSlashCommand(text)) await haltAndForward(conversation);
  if (interceptBuy && (await tryAddressBuyIntercept(conversation, text))) {
    return null;
  }
  await trackWorkflowMessage(conversation, reply.message.message_id);
  return text;
};

/**
 * Wizard variant entered from a button (no inline args). Prompts for
 * asset → amount → address, then funnels into the same PIN + confirm
 * staging path as the slash-command form. Kept inside this command file
 * because the prompt copy is withdraw-specific and not reusable.
 */
const withdrawWizardConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  origin?: MessageRef,
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  await sweepWorkflow(conversation);

  // Resolve the active wallet up front: the asset prompt now displays
  // both balances inline (so the user picks the asset they actually hold
  // without sending a text), which needs the address before any reply.
  // If no active wallet exists the rest of the wizard cannot proceed —
  // bail now rather than rendering an asset picker that PIN time will
  // reject anyway.
  const active = await conversation.external((outside) =>
    buildWalletManager(outside.env).getActive(userId),
  );
  if (!active) {
    await ctx.reply(withAntiPhishing(NO_ACTIVE_WALLET_REPLY));
    await sweepWorkflow(conversation);
    return;
  }

  const balances = await fetchBothBalancesExternal(
    conversation,
    active.address,
  );

  // When entered from a start-menu (or /wallet) button, edit the
  // origin bubble into the asset picker rather than dropping a fresh
  // prompt below the still-visible parent menu. Subsequent wizard
  // steps (amount, address, PIN) remain as their own messages because
  // they're transient prompts the existing sweep already cleans up.
  let editedOriginAsAsset = false;
  if (origin) {
    editedOriginAsAsset = await conversation.external((outside) =>
      safeEditMessageById(
        outside,
        origin,
        withAntiPhishing(renderAssetPrompt(balances)),
        { reply_markup: { inline_keyboard: assetPickerKeyboard() } },
      ),
    );
  }
  if (!editedOriginAsAsset) {
    const assetPromptMsg = await ctx.reply(
      withAntiPhishing(renderAssetPrompt(balances)),
      { reply_markup: { inline_keyboard: assetPickerKeyboard() } },
    );
    await trackWorkflowMessage(conversation, assetPromptMsg.message_id);
  } else if (origin) {
    // The origin bubble is the asset picker; track it so the
    // completion sweep clears it alongside the other transient prompts.
    await trackWorkflowMessage(conversation, origin.messageId);
  }

  // Filter is exact-match on the two asset codes; `next: true` lets
  // non-matching updates (Back / Home taps on this keyboard, and a
  // pasted contract address that the global address-buy intercept
  // claims — issue #821) flow through to the rest of the middleware
  // chain instead of being silently dropped.
  const pickCtx = await conversation.waitForCallbackQuery(
    ASSET_PICKER_PATTERN,
    { next: true },
  );
  const asset = assetFromCallback(pickCtx.callbackQuery.data ?? "");
  if (!asset) {
    // Pattern matched but decoding failed — shouldn't happen, but bail
    // cleanly instead of crashing the wizard.
    await sweepWorkflow(conversation);
    return;
  }
  await pickCtx.answerCallbackQuery();
  const balance = asset === "USDC" ? balances.usdc : balances.hype;

  let amountRaw: bigint | null = null;
  while (amountRaw === null) {
    const raw = await promptArg(
      conversation,
      ctx,
      `How much ${asset}? Your ${asset} balance is ${formatBalance(balance, asset)}. Send a positive amount (e.g. 0.1).`,
      true,
    );
    if (raw === null) {
      await sweepWorkflow(conversation);
      return;
    }
    const parsed = parseAmount(raw, asset);
    if (parsed === null) {
      const retry = await ctx.reply(
        withAntiPhishing(
          "Invalid amount — must be a positive decimal within the asset's precision. Send again.",
        ),
        { reply_markup: backHomeMarkup() },
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    amountRaw = parsed;
  }

  let to: Hex | null = null;
  while (to === null) {
    const raw = await promptArg(
      conversation,
      ctx,
      "Destination address? Send a 0x-prefixed EVM address.",
    );
    if (raw === null) {
      await sweepWorkflow(conversation);
      return;
    }
    const parsed = parseDestination(raw);
    if (parsed === null) {
      const retry = await ctx.reply(
        withAntiPhishing(
          "Invalid address — must be 0x followed by 40 hex characters. Send again.",
        ),
        { reply_markup: backHomeMarkup() },
      );
      await trackWorkflowMessage(conversation, retry.message_id);
      continue;
    }
    to = parsed;
  }

  await runPreFlightAndStage(
    conversation,
    ctx,
    userId,
    chatId,
    { asset, amountRaw, to },
  );
  await sweepWorkflow(conversation);
};

/**
 * Shared back-half of the flow: PIN verification → stage pending
 * intent → emit summary message with the Confirm/Cancel keyboard. Used
 * by both the slash-command path (after `parseInlineArgs`) and the
 * wizard path (after prompting for each input). The actual on-chain
 * submission happens in the `wdc:` callback handler.
 */
const runPreFlightAndStage = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  userId: number,
  chatId: number,
  args: ParsedArgs,
): Promise<void> => {
  // All KV reads must run via `conversation.external((outside) => …)` so
  // the conversations plugin captures the result and replays consistently
  // on later turns. Reading `ctx.env` directly inside a replay can land
  // on a partially-initialised shadow ctx (the middleware that attaches
  // `env` runs on the live request, not on every replay).
  const active = await conversation.external((outside) =>
    buildWalletManager(outside.env).getActive(userId),
  );
  if (!active) {
    await ctx.reply(withAntiPhishing(NO_ACTIVE_WALLET_REPLY));
    return;
  }

  const lock = await conversation.external((outside) =>
    buildSecurityState(outside.env).getWithdrawLock(userId),
  );
  if (lock.enabled) {
    await ctx.reply(withAntiPhishing(WITHDRAW_LOCKED_REPLY));
    return;
  }

  const pinSet = await conversation.external((outside) =>
    buildPinManager(outside.env).isPinSet(userId),
  );
  if (!pinSet) {
    await ctx.reply(withAntiPhishing(NO_PIN_REPLY));
    return;
  }

  const ok = await verifyPinForWithdraw(conversation, ctx, userId, chatId);
  if (!ok) return;

  const balance = await fetchAssetBalanceExternal(
    conversation,
    args.asset,
    active.address,
  );

  const nonce = newNonce();
  const expiresAt = Date.now() + CONFIRM_WINDOW_MS;
  await conversation.external((outside) => {
    outside.session.pendingWithdraw = {
      asset: args.asset,
      to: args.to,
      amountRaw: args.amountRaw.toString(),
      nonce,
      expiresAt,
    };
  });

  await ctx.reply(withAntiPhishing(renderSummary(args, balance)), {
    reply_markup: { inline_keyboard: confirmKeyboard(nonce) },
  });
};

/**
 * Slash-command-only variant of `runPreFlightAndStage`: parses the
 * inline args first, then funnels into the same back-half. Wrapped in
 * its own conversation so the PIN prompt + reply loop integrates with
 * grammY's conversations plugin.
 */
const withdrawCommandConversation = async (
  conversation: Conversation<AppContext, AppContext>,
  ctx: AppContext,
  argsRaw: string,
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  await sweepWorkflow(conversation);
  const parsed = parseInlineArgs(argsRaw);
  if (!parsed.ok) {
    await ctx.reply(withAntiPhishing(parsed.reason));
    return;
  }
  await runPreFlightAndStage(
    conversation,
    ctx,
    ctx.from.id,
    ctx.chat.id,
    parsed.args,
  );
  await sweepWorkflow(conversation);
};

export const registerWithdrawCommand = (bot: Bot<AppContext>): void => {
  bot.use(
    createConversation(
      withdrawWizardConversation as (
        conv: Conversation<AppContext, AppContext>,
        ctx: AppContext,
        ...args: unknown[]
      ) => Promise<void>,
      { id: "withdraw-wizard", parallel: true },
    ),
  );
  bot.use(
    createConversation(withdrawCommandConversation, {
      id: "withdraw-command",
      parallel: true,
    }),
  );

  bot.command("withdraw", async (ctx) => {
    if (!ctx.from) {
      await ctx.reply(withAntiPhishing(NO_USER_REPLY));
      return;
    }
    if (!isPrivateChat(ctx)) {
      await ctx.reply(withAntiPhishing(NON_PRIVATE_CHAT_REPLY));
      return;
    }
    const raw = typeof ctx.match === "string" ? ctx.match : "";
    if (raw.trim() === "") {
      // No args → run the wizard instead of just replying with usage,
      // so first-time users have a guided path.
      await ctx.conversation.enter("withdraw-wizard");
      return;
    }
    await ctx.conversation.enter("withdraw-command", raw);
  });

  const enterWizard = async (ctx: AppContext): Promise<void> => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!isPrivateChat(ctx)) {
      await ctx.answerCallbackQuery({
        text: "Withdrawals are private-DM only.",
        show_alert: true,
      });
      return;
    }
    // Edit the originating bubble (start menu or /wallet panel) into a
    // brief "loading" placeholder, pushing the parent snapshot onto the
    // nav stack so [← Back] returns to it. The wizard then overwrites
    // this same bubble with the asset picker once balances are fetched
    // — keeping the flow in one stable chat bubble instead of dropping
    // a fresh asset picker below the still-visible parent menu.
    const result = await editToSubmenu(ctx, {
      text: "Loading withdraw…",
      parseMode: "HTML",
      inlineKeyboard: [backHomeRow()],
      linkPreviewDisabled: true,
    });
    await ctx.answerCallbackQuery();
    const origin: MessageRef | undefined =
      ctx.chat && result.editedMessageId !== undefined
        ? { chatId: ctx.chat.id, messageId: result.editedMessageId }
        : undefined;
    await ctx.conversation.enter("withdraw-wizard", origin);
  };

  bot.callbackQuery(START_CALLBACK.withdraw, enterWizard);
  bot.callbackQuery(WALLET_CALLBACK.withdraw, enterWizard);

  /**
   * Cancel — clear the staged intent so a later stale Confirm tap on
   * the same nonce is a no-op. Tolerates a missing/expired intent
   * silently; the user's intent was to abort either way.
   */
  bot.callbackQuery(/^wdcl:(.+)$/, async (ctx) => {
    const nonce = ctx.match?.[1];
    const pending = ctx.session.pendingWithdraw;
    if (pending && pending.nonce === nonce) {
      ctx.session.pendingWithdraw = undefined;
    }
    await ctx.answerCallbackQuery({ text: "Cancelled." });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {
      // Same benign error as elsewhere — message deleted or unchanged.
    }
  });

  /**
   * Confirm — validate nonce + expiry, decrypt the active key,
   * execute the withdraw. Clearing `pendingWithdraw` up front (before
   * any await on the tx) closes the duplicate-tap replay window even
   * if the second tap lands before the session write commits.
   */
  bot.callbackQuery(/^wdc:(.+)$/, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    const nonce = ctx.match?.[1];
    const pending = ctx.session.pendingWithdraw;
    if (!pending || pending.nonce !== nonce || pending.expiresAt < Date.now()) {
      // Clear in case the slot still references an expired intent.
      if (pending && pending.expiresAt < Date.now()) {
        ctx.session.pendingWithdraw = undefined;
      }
      await ctx.answerCallbackQuery({
        text: "Confirmation expired — re-run /withdraw.",
        show_alert: true,
      });
      return;
    }
    ctx.session.pendingWithdraw = undefined;

    const wm = buildWalletManager(ctx.env);
    const active = await wm.getActive(ctx.from.id);
    if (!active) {
      await ctx.answerCallbackQuery({
        text: "No active wallet.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Submitting…" });

    const privateKey = await wm.decrypt(active.encryptedKey, ctx.from.id);
    const result = await executeWithdraw(ctx.env, {
      asset: pending.asset,
      to: pending.to as Hex,
      amountRaw: BigInt(pending.amountRaw),
      from: active.address as Hex,
      privateKey,
    });

    if (result.ok) {
      await ctx.reply(
        withAntiPhishing(
          [
            `✅ Withdraw submitted`,
            "",
            `Tx: <a href="${explorerTxUrl(result.txHash)}">${result.txHash}</a>`,
          ].join("\n"),
        ),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
      );
      return;
    }
    await ctx.reply(withAntiPhishing(`❌ ${renderError(result)}`));
  });
};
