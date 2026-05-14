import type { Bot } from "grammy";

import type { AppContext } from "../bot.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import {
  ctxAntiPhishingPhrase,
  resolveAntiPhishingHeader,
} from "../lib/anti-phishing.js";
import { BOT_NAME } from "../lib/branding.js";
import { backHomeRow, editToSubmenu } from "../lib/nav.js";

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Topic keys accepted as `/help <topic>`. The default (no arg)
 * renders the overview. Aliases collapse common synonyms onto a
 * single canonical key so users don't need to memorise the exact
 * topic name (`/help trade` and `/help buy` both land on trading).
 */
const TOPIC_ALIASES: Record<string, string> = {
  wallet: "wallet",
  wallets: "wallet",
  buy: "trading",
  sell: "trading",
  trade: "trading",
  trading: "trading",
  fee: "fees",
  fees: "fees",
  pnl: "pnl",
  profit: "pnl",
  security: "security",
  pin: "security",
  sap: "security",
  phrase: "security",
  lock: "security",
  referral: "referrals",
  referrals: "referrals",
  withdraw: "withdraw",
  withdrawal: "withdraw",
};

const TOPIC_LIST = [
  "wallet",
  "trading",
  "fees",
  "pnl",
  "security",
  "referrals",
  "withdraw",
];

/**
 * Sentinel inserted as the first line of each topic constant — swapped
 * for the per-user anti-phishing phrase (with static fallback) at
 * render time. Module-level constants keep us from rebuilding the
 * full HTML body for every /help call; the substitution is one
 * `String.prototype.replace` regardless of topic size.
 */
const HEADER_PLACEHOLDER = "__ANTI_PHISHING_HEADER__";

const OVERVIEW_HTML = [
  HEADER_PLACEHOLDER,
  "",
  `<b>${BOT_NAME} Help</b>`,
  "",
  "<b>Which tokens can I trade?</b>",
  "Any token launched on alt.fun. Each token's bonding curve is backed by a BounceTech Leveraged Token (LT), so prices move with buy pressure <i>and</i> the leveraged underlying (HYPE, ETH, BTC, SOL). After graduation, trading continues against the TOKEN/LT pair on HyperSwap — leveraged exposure persists.",
  "",
  "<b>Common commands</b>",
  "/start — main menu, balance, wallet address",
  "/wallet — create, import, switch, export, or delete wallets",
  "/buy &lt;contract&gt; [amount] — buy a token with USDC",
  "/sell &lt;contract&gt; — sell a position by % of balance",
  "/positions — open positions, cost basis, PnL",
  "/track &lt;contract&gt; — token card + recent trades",
  "/withdraw &lt;asset&gt; &lt;amount&gt; &lt;address&gt; — send funds out",
  "/settings — slippage, buy/sell presets, anti-phishing phrase, degen mode",
  "/referral — your referral link and earnings",
  "",
  "<b>Topics</b>",
  "Send <code>/help &lt;topic&gt;</code> for detail on:",
  TOPIC_LIST.map((t) => `• <code>/help ${t}</code>`).join("\n"),
  "",
  "<b>Security tips</b>",
  `• ${BOT_NAME} will <b>never</b> ask for your seed phrase or private key via DM.`,
  `• Never search for ${BOT_NAME} in Telegram. Use only the link from <a href="https://alt.fun">alt.fun</a>.`,
  "• Admins and mods never DM first or send links — stay safe.",
  "• Set a PIN in /wallet so withdrawals, key exports, and rewards-wallet changes require a 6-digit code.",
  "",
  "Further questions? Visit <a href=\"https://alt.fun\">alt.fun</a>.",
].join("\n");

const WALLET_HTML = [
  HEADER_PLACEHOLDER,
  "",
  "<b>Wallets</b>",
  "",
  `Each Telegram account can hold up to 10 wallets on ${BOT_NAME}. One is always <i>active</i> — buys, sells, and withdrawals use it as the signer.`,
  "",
  "Tap the Wallet button on /start, or send /wallet to:",
  "• Create a new wallet (auto-encrypted, stored in our KV)",
  "• Import an existing wallet via private key or mnemonic — the message you send with the key is deleted immediately after the bot reads it",
  "• Switch the active wallet",
  "• Rename a wallet",
  "• Export the private key (PIN-gated, ephemeral 30-second auto-delete)",
  "• Delete a wallet (PIN-gated)",
  "",
  "Private keys are encrypted with AES-256-GCM under a per-user key. The master key never touches storage and one user's ciphertext cannot be decrypted under another user's derivation.",
  "",
  "Funding: send USDC or HYPE on HyperEVM to your active wallet address (shown on /start). USDC is the trading currency; HYPE pays gas.",
].join("\n");

const TRADING_HTML = [
  HEADER_PLACEHOLDER,
  "",
  "<b>Buying and selling</b>",
  "",
  "<b>/buy &lt;contract&gt; [amount] [slippage=&lt;bps&gt;]</b>",
  "Quote and confirm a buy. Default amount comes from /settings; quick-amount buttons cover $20 / $50 / $100 / Custom. The minimum buy is $20 USDC — set by the LT's $10 mint floor plus the 0.5% bot fee.",
  "",
  "<b>/sell &lt;contract&gt;</b>",
  "Sell a position by percentage of your balance — quick-sell buttons cover 10 / 25 / 50 / 100% with a Sell X% custom-percent prompt. Sells go through the BounceTech LT redemption path — if the LT's USDC buffer is depleted the trade can revert with <code>InsufficientBalance</code>; sell in smaller chunks and retry after ~10 seconds.",
  "",
  "<b>Common failure reasons</b>",
  "• <i>Slippage exceeded</i> — increase slippage in /settings or sell in smaller increments.",
  "• <i>Insufficient balance</i> — fund USDC for buys or HYPE for gas.",
  "• <i>LT mint-paused</i> — buys are temporarily disabled by BounceTech for that LT; sells still work.",
  "• <i>Timed out</i> — network congestion; raise the priority fee in /settings.",
  "",
  "See also: <code>/help fees</code>, <code>/help pnl</code>.",
].join("\n");

const FEES_HTML = [
  HEADER_PLACEHOLDER,
  "",
  "<b>Fees</b>",
  "",
  "Every buy and sell — on the bonding curve <i>and</i> post-graduation — pays two fees in USDC:",
  "",
  `• <b>Bot fee 0.5%</b> — charged by ${BOT_NAME}. If you came in via a referral link, 0.1% of your trade is paid to your referrer's rewards wallet; the rest goes to the bot treasury.`,
  "• <b>Alt Fun fee 0.5%</b> — charged by the alt.fun protocol. Split 0.4% protocol / 0.1% to the token creator.",
  "",
  `Post-graduation trades also pay HyperSwap's 0.3% LP fee on top, paid to HyperSwap liquidity providers (${BOT_NAME} takes 0% of this).`,
  "",
  "There is no subscription fee and no paywall. No fee is charged on deposits or on idle balances.",
].join("\n");

const PNL_HTML = [
  HEADER_PLACEHOLDER,
  "",
  "<b>Why is my Net Profit lower than expected?</b>",
  "",
  "Your Net Profit on /positions is calculated after deducting every cost the trade actually incurred:",
  "",
  "• Price impact on the bonding curve or HyperSwap pair",
  "• Alt Fun protocol + creator fee (0.5%)",
  `• ${BOT_NAME} fee (0.5%, of which 0.1% is paid to your referrer if you have one)`,
  "• BounceTech LT mint / redeem fees",
  "• Gas paid in HYPE",
  "",
  "So the figure on /positions is what you actually received, not the gross notional. To audit a specific trade, open the tx hash from your trade confirmation on a HyperEVM block explorer.",
].join("\n");

const SECURITY_HTML = [
  HEADER_PLACEHOLDER,
  "",
  "<b>Security</b>",
  "",
  `${BOT_NAME} will <b>never</b> ask for your seed phrase or private key via DM, and will never ask you to log in with a phone number or QR code.`,
  "",
  "<b>Protect your account</b>",
  `• Only use the ${BOT_NAME} link from <a href="https://alt.fun">alt.fun</a>. Never search for the bot inside Telegram — copycats are everywhere.`,
  "• Admins and mods never DM first or send links. Treat any unsolicited DM as a phishing attempt.",
  "• Set an <i>anti-phishing phrase</i> in /settings. The bot prepends it to every message, so a phisher impersonating the bot won't know your phrase.",
  "",
  "<b>PIN</b>",
  "Set a 6-digit PIN in /wallet. The PIN gates withdrawals, private key exports, wallet deletion, and rewards-wallet changes. After 5 wrong attempts you're locked out for 30 minutes. If you forget your PIN, request a reset in /wallet — the new PIN unlocks after a 24-hour delay (the delay is what protects you from a stolen Telegram session draining your funds).",
  "",
  "<b>Withdrawal lock</b>",
  "Enable the withdrawal lock in /wallet to block all outbound transfers. Once enabled, disabling it requires a 24-hour cooldown — the [Complete disable] button surfaces on /wallet after the cooldown elapses.",
].join("\n");

const REFERRAL_HTML = [
  HEADER_PLACEHOLDER,
  "",
  "<b>Referrals</b>",
  "",
  "Open /referral (or tap the Referral button on /start) to see your shareable link, the number of users you've referred, and your lifetime USDC earned. There is no claim or withdraw button — your cut is paid directly to your <i>rewards wallet</i> on-chain, in the same transaction as each referred user's trade.",
  "",
  "<b>Rewards wallet</b>",
  "Defaults to your active custodial bot wallet. You can change it via /referral → Change rewards wallet (PIN-gated). Changing it does <b>not</b> redirect already-attributed referees — past referees keep paying out to the previously-set address forever by on-chain attribution. Set this to a long-lived address you control (hardware wallet or main custodial wallet) on day one.",
  "",
  "<b>Referrer attribution</b>",
  "Attribution is recorded once, on a referee's first /start, and is lifetime by construction — every subsequent trade pays the resolved rewards wallet forever. Self-referral is allowed (no warning) and just lowers your effective bot fee from 0.5% to 0.4%.",
].join("\n");

const WITHDRAW_HTML = [
  HEADER_PLACEHOLDER,
  "",
  "<b>Withdrawals</b>",
  "",
  "Send <code>/withdraw &lt;asset&gt; &lt;amount&gt; &lt;address&gt;</code> to move funds out of your active bot wallet.",
  "",
  "Every withdrawal walks through a multi-step confirmation:",
  "1. Bot shows asset, amount, destination, and estimated network fee",
  "2. If the withdrawal lock is enabled in /wallet, every withdrawal is blocked until the lock is disabled (24-hour cooldown applies)",
  "3. PIN prompt",
  "4. Confirm button (60-second timeout — expired confirms are silently dropped)",
  "",
  "Network fee is estimated from <code>eth_estimateGas</code> and shown in USDC equivalent before you confirm.",
].join("\n");

const TOPIC_HTML: Record<string, string> = {
  wallet: WALLET_HTML,
  trading: TRADING_HTML,
  fees: FEES_HTML,
  pnl: PNL_HTML,
  security: SECURITY_HTML,
  referrals: REFERRAL_HTML,
  withdraw: WITHDRAW_HTML,
};

const UNKNOWN_TOPIC_HTML = [
  HEADER_PLACEHOLDER,
  "",
  `Unknown help topic. Send <code>/help</code> for the overview, or pick one of: ${TOPIC_LIST.map((t) => `<code>${t}</code>`).join(", ")}.`,
].join("\n");

/**
 * Resolve `/help <topic>` argument text into a rendered HTML body.
 * Returns the overview when `arg` is empty, the topic body when the
 * (case-insensitive) alias matches, and the unknown-topic hint
 * otherwise. Keeping resolution pure makes the handler trivial to
 * exercise from tests without spinning up grammY.
 */
export const renderHelp = (
  arg: string | undefined,
  phrase: string | null | undefined,
): string => {
  const raw = arg?.trim().toLowerCase();
  const template = !raw
    ? OVERVIEW_HTML
    : TOPIC_HTML[TOPIC_ALIASES[raw] ?? ""] ?? UNKNOWN_TOPIC_HTML;
  return template.replace(
    HEADER_PLACEHOLDER,
    escapeHtml(resolveAntiPhishingHeader(phrase)),
  );
};

const sendHelp = async (
  ctx: AppContext,
  arg: string | undefined,
): Promise<void> => {
  await ctx.reply(renderHelp(arg, ctxAntiPhishingPhrase(ctx)), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
};

const showHelpFromCallback = async (ctx: AppContext): Promise<void> => {
  await editToSubmenu(ctx, {
    text: renderHelp(undefined, ctxAntiPhishingPhrase(ctx)),
    parseMode: "HTML",
    inlineKeyboard: [backHomeRow()],
    linkPreviewDisabled: true,
  });
};

export const registerHelpCommand = (bot: Bot<AppContext>): void => {
  bot.command("help", async (ctx) => {
    await sendHelp(ctx, ctx.match);
  });

  bot.callbackQuery(START_CALLBACK.help, async (ctx) => {
    await showHelpFromCallback(ctx);
    await ctx.answerCallbackQuery();
  });
};
