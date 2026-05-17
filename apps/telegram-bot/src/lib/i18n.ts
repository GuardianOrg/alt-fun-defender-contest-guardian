/**
 * i18n string registry for apps/telegram-bot.
 *
 * Every user-facing string the bot can emit lives here, keyed by
 * language. Today only `English` ships — additional locales can be
 * added by extending each entry with the same key set, then resolving
 * via `STRINGS.SOMETHING[lang]`. Parameterised strings live as
 * functions, e.g. `STRINGS.MINIMUM_BUY_USDC.English(20)`.
 *
 * Conventions:
 *   - Static text:        `{ English: "…" }`
 *   - Templated text:     `{ English: (args) => "…" }`
 *   - HTML bodies use the `_HTML` suffix; plaintext does not.
 *   - Keep keys SCREAMING_SNAKE_CASE so call sites stay greppable.
 *
 * Call sites read the language at the call site (today: always
 * English) — there is no implicit global. Adding a per-user language
 * setting in the future is a session-field addition + threading the
 * code through callers; the dictionary shape does not change.
 *
 * ─── DO NOT TRANSLATE — preserve verbatim in every locale ─────────
 *
 * The following identifiers, brand names, ticker symbols, command
 * names, and domains MUST appear literally in every translated entry.
 * Translating them breaks links, tx routing, on-chain symbol lookups,
 * and user recognition of the product. When adding a new locale, copy
 * these tokens through unchanged, exactly as they appear in English:
 *
 *   Product / brand:
 *     • CortisolBot — bot's display name (sourced from `branding.ts`
 *       as `BOT_NAME`; if the brand renames, that file is the single
 *       point of change). Never localise.
 *     • alt.fun, https://alt.fun — product domain.
 *     • Alt Fun — protocol name as written in product copy.
 *     • BounceTech, bounce.tech, docs.bounce.tech, bounce — partner
 *       protocol family; capitalisation is intentional ("BounceTech",
 *       not "Bounce Tech" / "Bouncetech").
 *     • HyperEVM, Hyperliquid, HyperSwap, HyperSwap V2 — chain and
 *       venue brands. Preserve capitalisation exactly.
 *     • hyperevmscan.io, https://hyperevmscan.io — block explorer
 *       domain.
 *     • Privy — wallet provider brand.
 *     • Telegram, BotFather, t.me — platform names and the Telegram
 *       deeplink domain. Never localise.
 *
 *   Assets / tickers:
 *     • USDC, HYPE, BTC, ETH, SOL — currency / asset tickers.
 *     • LT — short for "Leveraged Token". Always uppercase, always
 *       "LT" (not "TL" / locale-specific abbreviation).
 *     • HYPE3L, HYPE5L (and other `<asset><N>L` / `<asset><N>S`
 *       suffixes) — BounceTech LT symbol shape; preserve verbatim.
 *
 *   Contracts / on-chain identifiers (rarely user-facing, but listed
 *   for completeness):
 *     • Zap, Bonding, BotFeeRouter, FeeVault, LPLock, Router,
 *       Factory — contract names. Preserve case.
 *
 *   Commands:
 *     • /start, /help, /buy, /sell, /positions, /track, /wallet,
 *       /withdraw, /settings, /referral, /security — slash commands
 *       are wired by literal name (`bot.command("buy", …)`) so they
 *       must NOT be translated. The descriptions next to them (in
 *       the BotCommand list) ARE localisable; the command identifier
 *       itself is not.
 *
 *   Numeric / unit shapes:
 *     • Dollar amounts shown as `$20`, `$10,000`, etc. keep the `$`
 *       sigil — they are USDC notional, not a locale currency symbol.
 *     • Percentages shown as `0.5%`, `0.75%`, `25%` use the `%` sign
 *       and Western decimal point regardless of locale.
 *     • 6-digit PIN, 0x-prefixed addresses, 40 hex chars — the
 *       phrasing around them may localise; the format ("6-digit",
 *       "0x", "40 hex") describes a wire-format constraint and must
 *       stay literal so users construct valid inputs.
 *
 * If a future locale entry diverges on any of the above, the
 * `i18n.test.ts` shape assertion still passes (it only checks the
 * language-key set), so this is a convention enforced by review, not
 * by the type system. Reviewers: reject any translation that
 * localises a name on this list.
 */

import { BOT_NAME } from "./branding.js";

export type Language = "English";

export const DEFAULT_LANGUAGE: Language = "English";

/**
 * Localised value shape. `English` is mandatory (the fallback every
 * entry must carry); any other locale key is optional, so a translator
 * can cover only the strings that need a more native rendering without
 * having to translate the entire dictionary.
 */
export type Localised<T> = { English: T } & Partial<Record<Language, T>>;

/**
 * Resolve a localised entry into its value for `lang`, falling back to
 * English when the requested locale doesn't carry an override. Works
 * uniformly for static strings (`t(BACK_BUTTON_TEXT, lang)`) and for
 * parameterised entries (`t(BUY_AMOUNT_BUTTON, lang)(20)`).
 *
 * Direct `.English` reads at callsites continue to work — they bypass
 * the resolver and always read the canonical copy, which is the right
 * behaviour when a callsite is intentionally locale-agnostic (logs,
 * tests, copy that hasn't been internationalised yet).
 */
export const t = <T>(
  entry: Localised<T>,
  lang: Language = DEFAULT_LANGUAGE,
): T => entry[lang] ?? entry.English;

// ─── Navigation / global buttons ────────────────────────────────────

export const BACK_BUTTON_TEXT = { English: "← Back" } as const;
export const HOME_BUTTON_TEXT = { English: "🏠 Home" } as const;
export const REFRESH_BUTTON_TEXT = { English: "🔄 Refresh" } as const;

// ─── Start menu buttons ─────────────────────────────────────────────

export const START_BUY_USDC_VIA_RELAY_BUTTON = {
  English: "Buy USDC via Relay",
} as const;
export const START_BUY_BUTTON = { English: "Buy" } as const;
export const START_SELL_BUTTON = { English: "Sell" } as const;
export const START_POSITIONS_BUTTON = { English: "Positions" } as const;
export const START_TRACK_BUTTON = { English: "Track" } as const;
export const START_WALLET_BUTTON = { English: "Wallet" } as const;
export const START_WITHDRAW_BUTTON = { English: "Withdraw" } as const;
export const START_SETTINGS_BUTTON = { English: "Settings" } as const;
export const START_REFERRAL_BUTTON = { English: "Referral" } as const;
export const START_HELP_BUTTON = { English: "Help" } as const;

// ─── Wallet panel buttons ───────────────────────────────────────────

export const WALLET_CREATE_BUTTON = { English: "Create" } as const;
export const WALLET_IMPORT_BUTTON = { English: "Import" } as const;
export const WALLET_SWITCH_BUTTON = { English: "Switch" } as const;
export const WALLET_RENAME_BUTTON = { English: "Rename" } as const;
export const WALLET_DELETE_BUTTON = { English: "Delete" } as const;
export const WALLET_EXPORT_KEY_BUTTON = { English: "Export key" } as const;
export const WALLET_WITHDRAW_BUTTON = { English: "Withdraw" } as const;
export const WALLET_DELETE_NOW_BUTTON = { English: "Delete now" } as const;

export const WALLET_SET_PIN_BUTTON = { English: "Set PIN" } as const;
export const WALLET_CHANGE_PIN_BUTTON = { English: "Change PIN" } as const;
export const WALLET_RESET_PIN_BUTTON = { English: "Reset PIN" } as const;
export const WALLET_CANCEL_PIN_RESET_BUTTON = {
  English: "Cancel PIN reset",
} as const;
export const WALLET_COMPLETE_PIN_RESET_BUTTON = {
  English: "Complete PIN reset",
} as const;
export const WALLET_CANCEL_RESET_BUTTON = { English: "Cancel reset" } as const;

export const WALLET_LOCK_ENABLED_BUTTON = {
  English: "🟢 Withdrawal lock",
} as const;
export const WALLET_LOCK_DISABLED_BUTTON = {
  English: "🔴 Withdrawal lock",
} as const;
export const WALLET_LOCK_CANCEL_DISABLE_BUTTON = {
  English: "🟢 Withdrawal lock (cancel disable)",
} as const;
export const WALLET_COMPLETE_DISABLE_BUTTON = {
  English: "🟠 Complete disable",
} as const;
export const WALLET_CANCEL_DISABLE_BUTTON = {
  English: "Cancel disable",
} as const;

export const WALLET_UNLABELED = { English: "(unlabeled)" } as const;

// ─── Settings panel ─────────────────────────────────────────────────

export const SETTINGS_SLIPPAGE_HEADER_BUTTON = {
  English: "-- Slippage --",
} as const;
export const SETTINGS_EXECUTION_SPEED_HEADER_BUTTON = {
  English: "-- Execution Speed --",
} as const;
export const SETTINGS_CUSTOM_PERCENT_BUTTON = { English: "Custom %" } as const;
export const SETTINGS_BUY_SETTINGS_BUTTON = {
  English: "Buy Settings",
} as const;
export const SETTINGS_SELL_SETTINGS_BUTTON = {
  English: "Sell Settings",
} as const;
export const SETTINGS_SET_PHRASE_BUTTON = {
  English: "Set anti-phishing phrase",
} as const;
export const SETTINGS_CHANGE_PHRASE_BUTTON = {
  English: "Change phrase",
} as const;
export const SETTINGS_CLEAR_PHRASE_BUTTON = {
  English: "Clear phrase",
} as const;
export const SETTINGS_DEGEN_MODE_ON_BUTTON = {
  English: "🟢 Degen mode",
} as const;
export const SETTINGS_DEGEN_MODE_OFF_BUTTON = {
  English: "🔴 Degen mode",
} as const;

// ─── Speed preset labels ────────────────────────────────────────────

export const SPEED_PRESET_LIGHTNING = { English: "Lightning" } as const;
export const SPEED_PRESET_FAST = { English: "Fast" } as const;
export const SPEED_PRESET_ECO = { English: "Eco" } as const;

// ─── Buy / sell token-card buttons ──────────────────────────────────

export const BUY_X_USDC_BUTTON = { English: "Buy X USDC" } as const;
export const SELL_X_PERCENT_BUTTON = { English: "Sell X%" } as const;
export const BUY_AMOUNT_BUTTON = {
  English: (amount: number) => `Buy ${amount} USDC`,
} as const;
export const SELL_PERCENT_BUTTON = {
  English: (pct: number) => `Sell ${pct}%`,
} as const;
export const BUY_ARROW_BUTTON = { English: "Buy →" } as const;
export const SELL_ARROW_BUTTON = { English: "Sell →" } as const;
export const SETTINGS_BUY_PRESET_BUTTON = {
  English: (amount: number) => `✏️ ${amount} USDC`,
} as const;
export const SETTINGS_SELL_PRESET_BUTTON = {
  English: (pct: number) => `✏️ ${pct}%`,
} as const;

// ─── Generic outage / error replies ─────────────────────────────────

export const OUTAGE_REPLY = {
  English: "Data temporarily unavailable — try again in a moment.",
} as const;
export const ACTION_TOKEN_OUTAGE_REPLY = {
  English: "Token data temporarily unavailable — try again in a moment.",
} as const;
export const FAILED_TO_SAVE_REPLY = {
  English: "Failed to save — please retry.",
} as const;
export const RUN_START_TO_RETURN_HOME_REPLY = {
  English: "Run /start to return home.",
} as const;
export const INVALID_ADDRESS_REPLY = {
  English: "Invalid address. Please send a valid 0x-prefixed HyperEVM address.",
} as const;

// ─── Common short toast strings ─────────────────────────────────────

export const TOAST_INVALID_TOKEN = { English: "Invalid token." } as const;
export const TOAST_INVALID_REFRESH_REQUEST = {
  English: "Invalid refresh request.",
} as const;
export const TOAST_INVALID_PAGE_REQUEST = {
  English: "Invalid page request.",
} as const;
export const TOAST_INVALID_SWITCH_TARGET = {
  English: "Invalid switch target.",
} as const;
export const TOAST_MISSING_USER = { English: "Missing user." } as const;
export const TOAST_MESSAGE_NO_LONGER_AVAILABLE = {
  English: "Message no longer available.",
} as const;
export const TOAST_REFRESHED = { English: "Refreshed" } as const;
export const TOAST_SUBMITTING = { English: "Submitting…" } as const;
export const TOAST_SUBMITTING_ZAP = { English: "⚡ Submitting…" } as const;
export const TOAST_NO_ACTIVE_WALLET_RUN_WALLET = {
  English: "No active wallet — run /wallet to set one up.",
} as const;
export const TOAST_NO_ACTIVE_WALLET = {
  English: "No active wallet.",
} as const;
export const TOAST_NO_ACTIVE_WALLET_TO_DELETE = {
  English: "No active wallet to delete.",
} as const;
export const TOAST_NO_ACTIVE_WALLET_TO_EXPORT = {
  English: "No active wallet to export.",
} as const;
export const TOAST_NO_ACTIVE_WALLET_TO_RENAME = {
  English: "No active wallet to rename.",
} as const;
export const TOAST_NO_WALLETS_TO_SWITCH = {
  English: "No wallets to switch to.",
} as const;
export const TOAST_WALLET_NO_LONGER_EXISTS = {
  English: "Wallet no longer exists.",
} as const;
export const TOAST_UNABLE_TO_VERIFY_USDC_BALANCE = {
  English: "Unable to verify your USDC balance — please try again.",
} as const;
export const TOAST_UNABLE_TO_VERIFY_TOKEN_BALANCE = {
  English: "Unable to verify your token balance — please try again.",
} as const;
export const TOAST_LOCK_NOT_ENABLED = {
  English: "Lock is not enabled.",
} as const;
export const TOAST_PIN_ALREADY_SET = {
  English: "PIN already set. Use Change PIN or Reset PIN.",
} as const;
export const TOAST_RESET_ALREADY_READY = {
  English: "Reset already ready — tap Complete PIN reset.",
} as const;
export const TOAST_NO_PIN_RESET_IN_PROGRESS = {
  English: "No PIN reset in progress.",
} as const;
export const TOAST_RESET_CANCELLED = { English: "Reset cancelled." } as const;
export const TOAST_DISABLE_CANCELLED = {
  English: "Disable cancelled.",
} as const;
export const TOAST_PHRASE_CLEARED = { English: "Phrase cleared." } as const;
export const TOAST_DELETED = { English: "Deleted." } as const;
export const TOAST_DELETE_CANCELLED = { English: "Delete cancelled." } as const;
export const TOAST_CANCELLED = { English: "Cancelled." } as const;
export const TOAST_WITHDRAWAL_LOCK_ENABLED = {
  English: "Withdrawal lock enabled.",
} as const;
export const TOAST_WITHDRAWAL_LOCK_DISABLED = {
  English: "Withdrawal lock disabled.",
} as const;
export const TOAST_LOADING_WITHDRAW = {
  English: "Loading withdraw…",
} as const;
export const TOAST_CONFIRMATION_EXPIRED_WITHDRAW = {
  English: "Confirmation expired — re-run /withdraw.",
} as const;

// ─── Private-DM only banners (per command) ─────────────────────────

export const REFERRAL_PRIVATE_DM_ONLY_REPLY = {
  English: "Referral is private-DM only.",
} as const;
export const REFRESH_PRIVATE_DM_ONLY_REPLY = {
  English: "Refresh is private-DM only.",
} as const;
export const SETTINGS_PRIVATE_DM_ONLY_REPLY = {
  English: "Settings actions are private-DM only.",
} as const;
export const WALLET_PRIVATE_DM_ONLY_REPLY = {
  English: "Wallet actions are private-DM only.",
} as const;
export const WITHDRAW_PRIVATE_DM_ONLY_REPLY = {
  English: "Withdrawals are private-DM only.",
} as const;

// ─── Positions ──────────────────────────────────────────────────────

export const POSITIONS_USAGE_REPLY = {
  English: "Usage: /positions <wallet_address>",
} as const;
export const POSITIONS_NO_ACTIVE_WALLET_REPLY = {
  English: "No active wallet. Run /wallet to create one.",
} as const;
export const POSITIONS_NO_OPEN_POSITIONS_REPLY = {
  English: "No open positions for this wallet.",
} as const;

// ─── Buy / sell token loading + not found ───────────────────────────

export const BUY_CARD_LOADING_HTML = {
  English: (shortAddress: string) =>
    `⏳ Loading <code>${shortAddress}</code>…`,
} as const;

export const TOKEN_NOT_FOUND_HTML = {
  English:
    '❌ <b>Token not found.</b>\n\n' +
    'Make sure you have the correct contract address. You can find it on:\n' +
    '• <a href="https://alt.fun">alt.fun</a> — tap the token → copy address\n' +
    '• <a href="https://hyperevmscan.io">hyperevmscan.io</a> — search the token → copy address',
} as const;

// ─── Help body — overview + topics ─────────────────────────────────

const HELP_HEADER_PLACEHOLDER = "__ANTI_PHISHING_HEADER__";

const TOPIC_LIST_LINKS = (topics: readonly string[]): string =>
  topics.map((t) => `• <code>/help ${t}</code>`).join("\n");

const TOPIC_LIST_INLINE = (topics: readonly string[]): string =>
  topics.map((t) => `<code>${t}</code>`).join(", ");

export const HELP_OVERVIEW_HTML = {
  English: (topics: readonly string[]) =>
    [
      HELP_HEADER_PLACEHOLDER,
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
      TOPIC_LIST_LINKS(topics),
      "",
      "<b>Security tips</b>",
      `• ${BOT_NAME} will <b>never</b> ask for your seed phrase or private key via DM.`,
      `• Never search for ${BOT_NAME} in Telegram. Use only the link from <a href="https://alt.fun">alt.fun</a>.`,
      "• Admins and mods never DM first or send links — stay safe.",
      "• Set a PIN in /wallet so withdrawals, key exports, and rewards-wallet changes require a 6-digit code.",
      "",
      'Further questions? Visit <a href="https://alt.fun">alt.fun</a>.',
    ].join("\n"),
} as const;

export const HELP_WALLET_HTML = {
  English: [
    HELP_HEADER_PLACEHOLDER,
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
  ].join("\n"),
} as const;

export const HELP_TRADING_HTML = {
  English: [
    HELP_HEADER_PLACEHOLDER,
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
  ].join("\n"),
} as const;

export const HELP_FEES_HTML = {
  English: [
    HELP_HEADER_PLACEHOLDER,
    "",
    "<b>Fees</b>",
    "",
    "Every buy and sell — on the bonding curve <i>and</i> post-graduation — pays two fees in USDC:",
    "",
    `• <b>Bot fee 0.5%</b> — charged by ${BOT_NAME}. If you came in via a referral link, 0.1% of your trade is paid to your referrer's rewards wallet; the rest goes to the bot treasury.`,
    "• <b>Alt Fun fee 0.75%</b> — charged by the alt.fun protocol. Split 0.5% protocol / 0.25% (33% of the fee) to the token creator.",
    "",
    `Post-graduation trades also pay HyperSwap's 0.3% LP fee on top, paid to HyperSwap liquidity providers (${BOT_NAME} takes 0% of this).`,
    "",
    "There is no subscription fee and no paywall. No fee is charged on deposits or on idle balances.",
  ].join("\n"),
} as const;

export const HELP_PNL_HTML = {
  English: [
    HELP_HEADER_PLACEHOLDER,
    "",
    "<b>Why is my Net Profit lower than expected?</b>",
    "",
    "Your Net Profit on /positions is calculated after deducting every cost the trade actually incurred:",
    "",
    "• Price impact on the bonding curve or HyperSwap pair",
    "• Alt Fun protocol + creator fee (0.75%)",
    `• ${BOT_NAME} fee (0.5%, of which 0.1% is paid to your referrer if you have one)`,
    "• BounceTech LT mint / redeem fees",
    "• Gas paid in HYPE",
    "",
    "So the figure on /positions is what you actually received, not the gross notional. To audit a specific trade, open the tx hash from your trade confirmation on a HyperEVM block explorer.",
  ].join("\n"),
} as const;

export const HELP_SECURITY_HTML = {
  English: [
    HELP_HEADER_PLACEHOLDER,
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
  ].join("\n"),
} as const;

export const HELP_REFERRALS_HTML = {
  English: [
    HELP_HEADER_PLACEHOLDER,
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
  ].join("\n"),
} as const;

export const HELP_WITHDRAW_HTML = {
  English: [
    HELP_HEADER_PLACEHOLDER,
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
  ].join("\n"),
} as const;

export const HELP_UNKNOWN_TOPIC_HTML = {
  English: (topics: readonly string[]) =>
    [
      HELP_HEADER_PLACEHOLDER,
      "",
      `Unknown help topic. Send <code>/help</code> for the overview, or pick one of: ${TOPIC_LIST_INLINE(topics)}.`,
    ].join("\n"),
} as const;

/**
 * Placeholder sentinel inside the help-topic constants — the help
 * renderer swaps it for the per-user anti-phishing phrase at render
 * time. Exported so the renderer doesn't need a magic string of its
 * own.
 */
export const HELP_HEADER_PLACEHOLDER_TOKEN = HELP_HEADER_PLACEHOLDER;

// ─── /start ─────────────────────────────────────────────────────────

export const START_NO_USER_REPLY = {
  English:
    "Wallets require a personal Telegram account — this message has no user attached.",
} as const;
export const START_NON_PRIVATE_CHAT_REPLY = {
  English:
    "Wallet flows are private-DM only — your wallet address would leak in a group. Open a direct chat with the bot to use /start.",
} as const;

// ─── /wallet ────────────────────────────────────────────────────────

export const WALLET_NO_USER_REPLY = {
  English:
    "Wallets require a personal Telegram account — this message has no user attached (channel post or anonymous admin).",
} as const;
export const WALLET_NON_PRIVATE_CHAT_REPLY = {
  English:
    "Wallet flows are private-DM only — wallet labels and addresses must not surface in groups. Open a direct chat with the bot to manage wallets.",
} as const;

// ─── /settings ──────────────────────────────────────────────────────

export const SETTINGS_NO_USER_REPLY = {
  English:
    "Settings require a personal Telegram account — this message has no user attached (channel post or anonymous admin).",
} as const;
export const SETTINGS_NON_PRIVATE_CHAT_REPLY = {
  English:
    "Settings are private-DM only — your slippage and buy defaults should not surface in groups. Open a direct chat with the bot to manage settings.",
} as const;

// ─── /withdraw ──────────────────────────────────────────────────────

export const WITHDRAW_NO_USER_REPLY = {
  English:
    "Withdrawals require a personal Telegram account — this message has no user attached.",
} as const;
export const WITHDRAW_NON_PRIVATE_CHAT_REPLY = {
  English:
    "Withdrawal flows are private-DM only — your wallet address and PIN must not surface in groups. Open a direct chat with the bot to use /withdraw.",
} as const;
export const WITHDRAW_NO_ACTIVE_WALLET_REPLY = {
  English:
    "No active wallet — run /wallet to create or import one before withdrawing.",
} as const;
export const WITHDRAW_LOCKED_REPLY = {
  English:
    "Withdrawal lock is on. Disable it in /security first (24-hour cooldown).",
} as const;
export const WITHDRAW_NO_PIN_REPLY = {
  English:
    "No PIN set — run /security to set one before withdrawing. The PIN protects withdrawals from a stolen Telegram session.",
} as const;
export const WITHDRAW_USAGE_HINT_REPLY = {
  English: [
    "Usage: /withdraw <asset> <amount> <address>",
    "",
    "Examples:",
    "  /withdraw HYPE 0.1 0xabc…",
    "  /withdraw USDC 25 0xabc…",
    "",
    "Supported assets: HYPE, USDC",
  ].join("\n"),
} as const;

// ─── /positions ─────────────────────────────────────────────────────

export const POSITIONS_NON_PRIVATE_CHAT_REPLY = {
  English:
    "Positions are private-DM only — open a direct chat with the bot to view your positions.",
} as const;
export const POSITIONS_INVALID_ADDRESS_REPLY = {
  English:
    "Invalid wallet address. Expected a 0x-prefixed 40-character hex address.",
} as const;

// ─── /referral ──────────────────────────────────────────────────────

export const REFERRAL_NON_PRIVATE_CHAT_REPLY = {
  English:
    "Referral flows are private-DM only — your wallet address would leak in a group. Open a direct chat with the bot to use /referral.",
} as const;
export const REFERRAL_NO_USER_REPLY = {
  English:
    "Referrals require a personal Telegram account — this message has no user attached.",
} as const;
export const REFERRAL_NO_WALLET_REPLY = {
  English:
    "No active wallet yet — run /start to create one before sharing your referral link.",
} as const;
export const REFERRAL_CHANGE_REWARDS_WALLET_BUTTON = {
  English: "Change rewards wallet",
} as const;
export const REFERRAL_CUSTOM_BUTTON = { English: "Custom" } as const;

// ─── /buy /sell /track shared lookup prompt & not-found ────────────

export const TOKEN_LOOKUP_PROMPT_HTML = {
  English:
    "Enter the token contract address or paste a link from alt.fun or hyperevmscan.\n\n" +
    "Examples:\n" +
    "• <code>0x1234…abcd</code>\n" +
    "• <code>https://alt.fun/0x1234…</code>\n" +
    "• <code>https://hyperevmscan.io/token/0x1234…</code>\n\n" +
    "Tap Home to exit.",
} as const;

export const TOKEN_LOOKUP_NOT_FOUND_RETRY_HTML = {
  English:
    "❌ <b>Token not found.</b>\n\n" +
    "Make sure you have the correct contract address. You can find it on:\n" +
    '• <a href="https://alt.fun">alt.fun</a> — tap the token → copy address\n' +
    '• <a href="https://hyperevmscan.io">hyperevmscan.io</a> — search the token → copy address\n\n' +
    "Try again, or tap Home to exit.",
} as const;

// ─── Confirmations + audit-grade warnings ──────────────────────────

export const CONFIRM_BUTTON = { English: "✅ Confirm" } as const;
export const CANCEL_BUTTON = { English: "✖ Cancel" } as const;
export const CONFIRM_WITHDRAW_BUTTON = {
  English: "✅ Confirm Withdraw",
} as const;
export const TRANSACTION_FAILED_REPLY = {
  English: "❌ Transaction failed — please try again in a moment.",
} as const;
export const WITHDRAW_AMOUNT_EXCEEDS_BALANCE_REPLY = {
  English: "⚠️ Amount exceeds available balance — withdraw will fail.",
} as const;
export const WALLET_EXPORT_PRIVATE_KEY_WARNING_REPLY = {
  English:
    "⚠️ Private key — anyone with this controls the wallet. Do NOT share. This message auto-deletes in 30s; tap Delete now to remove it immediately.",
} as const;
export const REFERRAL_BURN_ADDRESS_WARNING_REPLY = {
  English: "⚠️ That address is a known burn / null address.",
} as const;

// ─── Buy / sell post-stage error replies ───────────────────────────

export const NO_ACTIVE_WALLET_RUN_WALLET_REPLY = {
  English: "No active wallet — run /wallet to create or import one.",
} as const;
export const TRANSACTION_FAILED_SHORT_REPLY = {
  English: "Transaction failed — please try again in a moment.",
} as const;
export const TRADE_ALREADY_IN_FLIGHT_REPLY = {
  English:
    "Trade already in flight — wait a moment, then check the explorer or retry.",
} as const;
export const TRADE_ROUTING_NOT_CONFIGURED_REPLY = {
  English: "Trade routing is not yet configured — try again in a moment.",
} as const;
export const INSUFFICIENT_HYPE_FOR_GAS_REPLY = {
  English: "Insufficient HYPE for gas — top up the wallet and retry.",
} as const;
export const TOAST_CONFIRM_CLEARED = {
  English: "Cancelled",
} as const;
export const TOAST_CONFIRM_ALREADY_EXPIRED = {
  English: "Already expired",
} as const;
export const CONFIRM_EXPIRED_REPLY = {
  English:
    "⏱ That trade confirmation has expired. Re-run /buy or /sell to try again.",
} as const;

// ─── Trade confirm receipt + tx-status copy ────────────────────────

export const TRADE_VERB_BUY = { English: "Buy" } as const;
export const TRADE_VERB_SELL = { English: "Sell" } as const;
export const TRADE_RECEIVED_TOKENS = {
  English: (amount: string, ticker: string) =>
    `Received: ${amount} ${ticker}\n`,
} as const;
export const TRADE_RECEIVED_USDC = {
  English: (amount: string) => `Received: $${amount} USDC\n`,
} as const;
export const TRADE_CONFIRMED_HEADER_HTML = {
  English: (verb: string, ticker: string) =>
    `✅ <b>${verb} confirmed for ${ticker}</b>`,
} as const;
export const TRADE_TX_LABEL = { English: "Tx:" } as const;
export const TRADE_STATUS_BUYING = {
  English: (usdcLabel: string, ticker: string) =>
    `Buying ${usdcLabel} USDC of ${ticker}`,
} as const;
export const TRADE_STATUS_SELLING = {
  English: (tokenAmount: string, ticker: string) =>
    `Selling ${tokenAmount} ${ticker}`,
} as const;
export const TX_SENDING_HEADER_HTML = { English: "⏳ <b>Tx sending</b>" } as const;
export const TX_PENDING_HEADER_HTML = { English: "⏳ <b>Tx pending</b>" } as const;
export const TX_PENDING_BODY = {
  English:
    "Still waiting for the network to confirm — this may take another moment.",
} as const;

// ─── renderExecutionError variants ─────────────────────────────────

export const TX_PENDING_POLLING_REPLY = {
  English: (timeoutSec: number, explorerUrl: string) =>
    `Tx pending — receipt not seen within ${timeoutSec}s. ` +
    `Still polling in the background; this message updates once mined. ` +
    `Explorer: ${explorerUrl}`,
} as const;
export const TX_PENDING_NO_POLLING_REPLY = {
  English: (explorerUrl: string) =>
    `Tx pending — receipt not seen yet, no longer polling. ` +
    `Check the explorer: ${explorerUrl}`,
} as const;
export const TX_PENDING_NEUTRAL_REPLY = {
  English: (explorerUrl: string) =>
    `Tx pending — receipt not seen yet. ` +
    `Check the explorer: ${explorerUrl}`,
} as const;
export const TX_SUBMITTED_RECEIPT_MISSING_REPLY = {
  English: (explorerUrl: string) =>
    `Tx submitted but receipt not seen yet — check the explorer: ${explorerUrl}`,
} as const;
export const RPC_UNAVAILABLE_REPLY = {
  English: "RPC unavailable — please try again in a moment.",
} as const;
export const TRADING_NOT_YET_OPEN_REPLY = {
  English: (suffix: string) =>
    `Trading not yet open for this token — wait for the launch delay to clear.${suffix}`,
} as const;
export const LT_BUFFER_LOW_REPLY = {
  English: (suffix: string) =>
    `BounceTech LT buffer low — try a smaller amount or retry in ~10s.${suffix}`,
} as const;
export const SLIPPAGE_EXCEEDED_REPLY = {
  English: (suffix: string) =>
    `Price moved past slippage — try again or raise slippage in /settings.${suffix}`,
} as const;
export const BUYS_PAUSED_MINT_PAUSED_REPLY = {
  English: (suffix: string) =>
    `Buys paused for this token — BounceTech LT is temporarily mint-paused. Sells still work.${suffix}`,
} as const;
export const TX_REVERTED_ON_CHAIN_REPLY = {
  English: (reason: string, explorerUrl: string) =>
    `Transaction reverted on-chain${reason ? `: ${reason}` : ""}. See ${explorerUrl}.`,
} as const;
export const TX_FAILED_GENERIC_REPLY = {
  English: (reason: string) => `Transaction failed${reason ? `: ${reason}` : ""}.`,
} as const;
export const RPC_UNAVAILABLE_WITH_REASON_REPLY = {
  English: (reason: string) =>
    `RPC unavailable${reason ? `: ${reason}` : ""} — try again in a moment.`,
} as const;
export const TRANSACTION_REVERTED_WITH_REASON_REPLY = {
  English: (reason: string) =>
    `Transaction reverted${reason ? `: ${reason}` : ""}.`,
} as const;
export const PIN_NO_PIN_ON_FILE_REPLY = {
  English: "No PIN on file — re-run /wallet to set one.",
} as const;
export const PIN_FLOW_CONFIRM_PROMPT = {
  English: "Confirm — send the same 6 digits again.",
} as const;
export const PENDING_TX_RECEIPT_NOT_SEEN_REPLY = {
  English: "Receipt not seen within 30 minutes.",
} as const;
export const TOKEN_LIFECYCLE_GRADUATING = {
  English: "Graduating 🔄",
} as const;
export const TOKEN_LIFECYCLE_BONDING_CURVE = {
  English: "Bonding Curve",
} as const;
export const TOKEN_LIFECYCLE_GRADUATED = {
  English: "Graduated ✅",
} as const;
export const POSITIONS_REALISED_POS_HEADER = {
  English: "Realised Pos",
} as const;
export const POSITIONS_BUY_TICKER_BUTTON = {
  English: (ticker: string) => `Buy ${ticker}`,
} as const;
export const POSITIONS_SELL_TICKER_BUTTON = {
  English: (ticker: string) => `Sell ${ticker}`,
} as const;
export const ANTI_PHISHING_STATIC_HEADER = {
  English: "This bot will never ask for your seed phrase or private key via DM.",
} as const;
export const TOKEN_NOT_FOUND_SHORT_REPLY = {
  English: "Token not found — make sure the address is correct.",
} as const;
export const PROCEEDS_UNAVAILABLE_REPLY = {
  English: "Unable to estimate proceeds right now — please try again in a moment.",
} as const;

// ─── /start welcome surface ─────────────────────────────────────────

export const START_WALLET_ADDRESS_LABEL = {
  English: "Your wallet address:",
} as const;
export const START_ONCE_FUNDED_REFRESH_HINT = {
  English: "Once funded, tap Refresh and your balance will appear here.",
} as const;
export const START_COULD_NOT_CREATE_WALLET_REPLY = {
  English: "Could not create your wallet — please try /start again in a moment.",
} as const;
export const START_BALANCE_UNAVAILABLE_TOAST = {
  English: "Balance unavailable",
} as const;
export const START_BALANCE_REFRESHED_TOAST = {
  English: "Balance refreshed",
} as const;
export const START_WELCOME_LEAD = {
  English: (botName: string) =>
    `Welcome to ${botName} — the bot for trading alt fun tokens on HyperEVM.`,
} as const;
export const START_BALANCE_LABEL = {
  English: (usdc: string) => `Balance: ${usdc} USDC`,
} as const;
export const START_GAS_BALANCE_LABEL = {
  English: (hype: string) => `Gas balance: ${hype} HYPE`,
} as const;
export const TAP_TO_COPY_HINT = { English: "(Tap to copy)" } as const;

// ─── /settings panel labels + wizard prompts ───────────────────────

export const SETTINGS_BUY_SELL_HINT_REPLY = {
  English: "Tap Buy Settings or Sell Settings to customize the preset buttons.",
} as const;
export const SETTINGS_BUY_SUBMENU_TITLE = {
  English: ["Buy Settings", "", "Tap a slot to change its amount."].join("\n"),
} as const;
export const SETTINGS_SELL_SUBMENU_TITLE = {
  English: ["Sell Settings", "", "Tap a slot to change its percent."].join("\n"),
} as const;
export const SETTINGS_CUSTOM_SLIPPAGE_PROMPT = {
  English: [
    "Send a custom slippage percent (e.g. `0.75`, `3`, `7.5`).",
    "",
    "Tap Home to exit and keep the current value.",
  ].join("\n"),
} as const;
export const SETTINGS_INVALID_NUMBER_REPLY = {
  English: "Send a positive number like `2` or `0.5`.",
} as const;
export const SETTINGS_SLIPPAGE_MIN_REPLY = {
  English: "Slippage must be at least 0.01%. Send again.",
} as const;
export const SETTINGS_BUY_SLOT_PROMPT = {
  English: [
    "Change the value of the buy amount button.",
    "",
    "Tap Home to exit and keep the current value.",
  ].join("\n"),
} as const;
export const SETTINGS_INVALID_USDC_REPLY = {
  English: "Send a positive USDC amount like `50`.",
} as const;
export const SETTINGS_SELL_SLOT_PROMPT = {
  English: [
    "Change the value of the sell percent button.",
    "Send a percent between 1 and 100.",
    "",
    "Tap Home to exit and keep the current value.",
  ].join("\n"),
} as const;
export const SETTINGS_SELL_SLOT_INVALID_REPLY = {
  English: "Send a number between 1 and 100.",
} as const;
export const SETTINGS_SELL_SLOT_RANGE_REPLY = {
  English: "Percent must be between 1 and 100. Send again.",
} as const;
export const SETTINGS_ANTI_PHISHING_PROMPT = {
  English:
    "Send your anti-phishing phrase — it will appear at the top of every bot message so you can recognise messages from this bot vs. a copycat.",
} as const;
export const SETTINGS_PHRASE_EMPTY_REPLY = {
  English: "Phrase cannot be empty. Send again.",
} as const;
export const TOAST_DEGEN_MODE_ENABLED = {
  English: "Degen mode enabled.",
} as const;
export const TOAST_DEGEN_MODE_DISABLED = {
  English: "Degen mode disabled.",
} as const;

// ─── /sell custom percent prompt + retry ───────────────────────────

export const SELL_CUSTOM_PERCENT_PROMPT = {
  English:
    "Enter a percent of your position to sell (1–100):\n\nTap Home to exit.",
} as const;
export const SELL_CUSTOM_PERCENT_INVALID_REPLY = {
  English: "Please enter a whole number between 1 and 100 (e.g. 35).",
} as const;
export const SELL_UNABLE_TO_VERIFY_TOKEN_BALANCE_REPLY = {
  English: "Unable to verify your token balance — please try again.",
} as const;

// ─── Slash command descriptions (Telegram BotCommand list) ─────────

export const BOT_COMMAND_START_DESCRIPTION = {
  English: "Open the main menu and create or import a wallet",
} as const;
export const BOT_COMMAND_HELP_DESCRIPTION = {
  English: "Command list and security guidance",
} as const;
export const BOT_COMMAND_BUY_DESCRIPTION = {
  English: "Buy a token by contract address",
} as const;
export const BOT_COMMAND_SELL_DESCRIPTION = {
  English: "Sell a token from your positions",
} as const;
export const BOT_COMMAND_POSITIONS_DESCRIPTION = {
  English: "Show open and realised positions",
} as const;
export const BOT_COMMAND_TRACK_DESCRIPTION = {
  English: "Show a token info card and recent trades",
} as const;
export const BOT_COMMAND_WALLET_DESCRIPTION = {
  English: "Wallets, PIN, withdrawal lock",
} as const;
export const BOT_COMMAND_WITHDRAW_DESCRIPTION = {
  English: "Withdraw HYPE or USDC to an external wallet",
} as const;
export const BOT_COMMAND_SETTINGS_DESCRIPTION = {
  English: "Slippage, default buy amount, anti-phishing phrase, degen mode",
} as const;
export const BOT_COMMAND_REFERRAL_DESCRIPTION = {
  English: "Your referral link and earned rewards",
} as const;

// ─── /withdraw wizard ───────────────────────────────────────────────

export const WITHDRAW_WHICH_ASSET_PROMPT = {
  English: "Which asset?",
} as const;
export const WITHDRAW_SUMMARY_HEADER = {
  English: "Withdraw summary",
} as const;
export const WITHDRAW_TAP_CONFIRM_HINT = {
  English: "Tap Confirm Withdraw within 60s to submit.",
} as const;
export const WITHDRAW_INSUFFICIENT_BALANCE_REPLY = {
  English: "Insufficient balance for the requested amount + gas.",
} as const;
export const WITHDRAW_PIN_PROMPT = {
  English: "Send your 6-digit PIN to authorise the withdraw.",
} as const;
export const WITHDRAW_INVALID_AMOUNT_REPLY = {
  English:
    "Invalid amount — must be a positive decimal within the asset's precision. Send again.",
} as const;
export const WITHDRAW_DESTINATION_PROMPT = {
  English: "Destination address? Send a 0x-prefixed EVM address.",
} as const;
export const WITHDRAW_INVALID_DESTINATION_REPLY = {
  English:
    "Invalid address — must be 0x followed by 40 hex characters. Send again.",
} as const;

// ─── /wallet wizards ────────────────────────────────────────────────

export const WALLET_NO_WALLETS_YET_REPLY = {
  English: "No wallets yet.",
} as const;
export const WALLET_RENAME_PROMPT = {
  English: "Send the new label for this wallet (max 32 chars).",
} as const;
export const WALLET_RENAME_NO_LONGER_EXISTS_REPLY = {
  English: "Wallet no longer exists. Rename cancelled.",
} as const;
export const WALLET_EXPORT_NO_LONGER_EXISTS_REPLY = {
  English: "Wallet no longer exists. Export aborted.",
} as const;
export const WALLET_DELETE_NO_LONGER_EXISTS_REPLY = {
  English: "Wallet no longer exists. Delete aborted.",
} as const;
export const WALLET_SET_PIN_PROMPT = {
  English:
    "No PIN set yet. Send a new 6-digit PIN (digits only) to protect wallet exports, withdrawals, and deletions.",
} as const;
export const WALLET_CONFIRM_PIN_PROMPT = {
  English: "Confirm — send the same 6 digits again.",
} as const;
export const WALLET_IMPORT_PASTE_KEY_PROMPT = {
  English: [
    "Paste the private key for the wallet you want to import (0x-prefixed, 64 hex chars).",
    "",
    "Your message is deleted from this chat the instant the bot reads it. The bot never stores the plaintext key — only an encrypted copy.",
    "",
    "Tap Home to exit.",
  ].join("\n\n"),
} as const;
export const WALLET_IMPORT_INVALID_KEY_REPLY = {
  English:
    "That doesn't look like a private key — expected 0x followed by 64 hex characters. Paste it again.",
} as const;
export const WALLET_IMPORT_PRIVATE_KEY_INVALID_REPLY = {
  English: "That private key is invalid. Paste it again.",
} as const;
export const WALLET_IMPORT_ALREADY_EXISTS_REPLY = {
  English: "That wallet is already in your list. Import cancelled.",
} as const;
export const WALLET_CHANGE_PIN_PROMPT = {
  English: "Send the new 6-digit PIN (digits only).",
} as const;
export const WALLET_RESET_PIN_PROMPT = {
  English: "Send your new 6-digit PIN (digits only).",
} as const;
export const WALLET_SET_NEW_PIN_PROMPT = {
  English:
    "Send a new 6-digit PIN (digits only) to protect wallet exports, withdrawals, and deletions.",
} as const;
export const WALLET_PICK_ACTIVE_PROMPT = {
  English: "Pick the wallet to use as active:",
} as const;

// ─── /referral wizards ──────────────────────────────────────────────

export const REFERRAL_UPDATE_REWARDS_WALLET_HINT = {
  English: "Update your rewards wallet to fix future payments.",
} as const;
export const REFERRAL_CHECK_REWARDS_WALLET_HINT = {
  English: "Check that your rewards wallet is set so this doesn't happen again.",
} as const;
export const REFERRAL_SHARE_LINK_LEAD = {
  English: "Share your link to earn a cut of every trade your referees make.",
} as const;
export const REFERRAL_LINK_LABEL = {
  English: "Your referral link:",
} as const;
export const REFERRAL_REWARDS_WALLET_LABEL = {
  English: "Your rewards wallet:",
} as const;
export const REFERRAL_PAST_REFEREES_WARNING = {
  English:
    "Past referees keep paying the previously-set address forever, by on-chain attribution. To redirect future earnings from existing referees, you must control the previously-set address.",
} as const;
export const REFERRAL_PICK_OR_CUSTOM_HINT = {
  English:
    "Pick one of your bot wallets below, or tap <b>Custom</b> to enter a different HyperEVM address.",
} as const;
export const REFERRAL_LONG_LIVED_HINT = {
  English:
    "Set the new wallet to a long-lived address you control (hardware wallet or main custodial wallet) — avoid exchange deposit addresses or rotating addresses.",
} as const;
export const REFERRAL_SEND_NEW_ADDRESS_PROMPT = {
  English: "Send the new rewards wallet address (0x-prefixed, 40 hex chars).",
} as const;
export const REFERRAL_SET_PIN_PROMPT = {
  English:
    "No PIN set yet. Send a new 6-digit PIN (digits only) to protect rewards-wallet changes.",
} as const;
export const REFERRAL_PIN_CONFIRM_PROMPT = {
  English: "Confirm — send the same 6 digits again.",
} as const;
export const REFERRAL_VERIFY_PIN_PROMPT = {
  English: "Send your 6-digit PIN to authorise the rewards-wallet change.",
} as const;
export const PIN_INVALID_FORMAT_REPLY = {
  English: "PIN must be exactly 6 digits. Send again.",
} as const;
export const PIN_DO_NOT_MATCH_REPLY = {
  English: "PINs do not match. Send the confirmation PIN again.",
} as const;
export const PIN_STATE_LOST_REPLY = {
  English: (retryHint: string) => `PIN state lost — re-run ${retryHint}.`,
} as const;
export const REFERRAL_INVALID_ADDRESS_REPLY = {
  English:
    "Not a valid HyperEVM address. Send a 0x-prefixed 40-char hex address.",
} as const;
export const REFERRAL_BURN_PAYMENT_LOST_WARNING = {
  English:
    "Every USDC payment sent here is permanently unrecoverable — every future referral cut would be lost forever.",
} as const;
export const REFERRAL_BURN_CONFIRM_PROMPT = {
  English:
    "Send 'confirm' to proceed anyway, tap Home to exit, or send a different address.",
} as const;
export const REFERRAL_ABORTED_RETRY_PROMPT = {
  English:
    "Aborted. Send 'confirm' or a new 0x-prefixed address, or tap Home to exit.",
} as const;
export const REFERRAL_STILL_BURN_RETRY_PROMPT = {
  English:
    "That's still a known burn address. Send 'confirm' to proceed, tap Home to exit, or a different address.",
} as const;
export const REFERRAL_COULD_NOT_UPDATE_REPLY = {
  English: "Could not update rewards wallet. Try again later.",
} as const;
export const REFERRAL_WALLET_NO_LONGER_AVAILABLE_REPLY = {
  English:
    "That wallet is no longer available. Re-run /referral → Change rewards wallet.",
} as const;
export const REFERRAL_HEADER_REWARDS_REJECTING = {
  English: "<b>⚠️ Rewards wallet rejecting USDC transfers</b>",
} as const;
export const REFERRAL_HEADER_ATTRIBUTION_DROPPED = {
  English: "<b>⚠️ Attribution dropped for some referees</b>",
} as const;
export const REFERRAL_HEADER_YOUR_REFERRAL = {
  English: "<b>Your referral</b>",
} as const;
export const REFERRAL_HEADER_CHANGE_REWARDS_WALLET = {
  English: "<b>Change rewards wallet</b>",
} as const;
export const REFERRAL_HEADER_CHANGE_DOES_NOT_REDIRECT = {
  English:
    "<b>Changing your rewards wallet does NOT redirect already-attributed referees.</b>",
} as const;

// ─── /wallet — extracted toasts & prompts ──────────────────────────

export const WALLET_RENAME_LENGTH_INVALID_REPLY = {
  English: (max: number) =>
    `Label must be 1–${max} characters. Rename cancelled.`,
} as const;
export const WALLET_DELETE_CONFIRM_PROMPT = {
  English: (label: string, address: string) =>
    `Final step — this permanently removes ${label} (${address}) from KV. Encrypted key cannot be recovered. Type DELETE to confirm or tap Home to exit.`,
} as const;
export const WALLET_PIN_SET_HEADER = { English: "PIN set." } as const;
export const WALLET_PIN_CHANGED_HEADER = { English: "PIN changed." } as const;
export const WALLET_RESET_NOT_READY_WITH_CANCEL_HINT_REPLY = {
  English: (hours: string) =>
    `Reset not yet available — ~${hours} remaining. Tap [Cancel PIN reset] if you didn't request this.`,
} as const;
export const WALLET_RESET_NOT_READY_REPLY = {
  English: (hours: string) => `Reset not yet available — ~${hours} remaining.`,
} as const;
export const TOAST_WALLET_CREATED = {
  English: (address: string) => `Created ${address}`,
} as const;
export const TOAST_WALLET_CAP_REACHED = {
  English: (max: number) =>
    `Wallet cap reached (${max}). Delete one first.`,
} as const;
export const TOAST_WALLET_SWITCHED_TO = {
  English: (label: string) => `Switched to ${label}`,
} as const;
export const TOAST_WALLET_SWITCHED = { English: "Switched." } as const;
export const TOAST_PIN_RESET_REQUESTED = {
  English: (hours: string) =>
    `PIN reset requested. Complete in ~${hours}. The old PIN still works during the cooldown.`,
} as const;
export const TOAST_LOCK_DISABLE_REQUESTED = {
  English: (hours: string) =>
    `Disable requested — completes in ~${hours}. Tap the lock button again to revoke.`,
} as const;

// ─── PIN flow (shared by /wallet, /referral, /security) ────────────

export const PIN_VERIFY_PROMPT = {
  English: (actionLabel: string) =>
    `Send your current 6-digit PIN to authorise ${actionLabel}.`,
} as const;
export const PIN_AUTHORISE_THE_PROMPT = {
  English: (actionLabel: string) =>
    `Send your 6-digit PIN to authorise the ${actionLabel}.`,
} as const;
export const WALLET_PIN_RESET_COMPLETE_HEADER = {
  English: "PIN reset complete.",
} as const;
export const PIN_LOCKED_REPLY = {
  English: (mins: number, actionLabel: string) =>
    `Too many wrong PIN attempts — locked for ~${mins} min. ${actionLabel} cancelled.`,
} as const;
export const PIN_WRONG_RETRY_REPLY = {
  English: (attemptsRemaining: number) =>
    `Wrong PIN. ${attemptsRemaining} attempts remaining. Try again.`,
} as const;

// ─── /buy — extracted toasts ───────────────────────────────────────

export const BUY_INSUFFICIENT_USDC_REPLY = {
  English: (totalNeeded: number, usdcAvailable: number) =>
    `Insufficient USDC: need $${totalNeeded.toFixed(2)}, have $${usdcAvailable.toFixed(2)}.`,
} as const;

// ─── /track — extracted trade-list copy ────────────────────────────

export const TRACK_RECENT_TRADES_HEADER_HTML = {
  English: "<b>Recent trades</b>",
} as const;
export const TRACK_NO_TRADES_YET_HTML = {
  English: "<i>No trades yet.</i>",
} as const;
export const TRACK_RELATIVE_TIME = {
  English: {
    justNow: "just now",
    seconds: (n: number) => `${n}s ago`,
    minutes: (n: number) => `${n}m ago`,
    hours: (n: number) => `${n}h ago`,
    days: (n: number) => `${n}d ago`,
  },
} as const;

// ─── Token card (shared by /buy, /sell, /track) ────────────────────

export const TOKEN_CARD_MARKET_CAP_HTML = {
  English: (mcap: string) => `💰 <b>Market Cap:</b> ${mcap}`,
} as const;
export const TOKEN_CARD_PRICE_HTML = {
  English: (price: string) => `💵 <b>Price:</b> ${price}`,
} as const;
export const TOKEN_CARD_CHANGE_24H_HTML = {
  English: (pct: string) => `📊 <b>24h Change:</b> ${pct}`,
} as const;
export const TOKEN_CARD_VOLUME_24H_HTML = {
  English: (volume: string) => `📈 <b>24h Volume:</b> ${volume}`,
} as const;
export const TOKEN_CARD_CURVE_FILLED_HTML = {
  English: (pct: string) => `🔥 <b>Curve Filled:</b> ${pct}`,
} as const;
export const TOKEN_CARD_VIEW_ON_EXPLORER_HTML = {
  English: (url: string) => `🔍 <a href="${url}">View on Explorer</a>`,
} as const;
export const TOKEN_CARD_VIEW_ON_ALT_FUN_HTML = {
  English: (url: string) => `🚀 <a href="${url}">View on Alt Fun</a>`,
} as const;
export const TOKEN_CARD_YOUR_USDC_BALANCE_HTML = {
  English: (formattedUsdc: string) =>
    `💼 <b>Your USDC Balance:</b> ${formattedUsdc}`,
} as const;
export const TOKEN_CARD_BALANCE_UNAVAILABLE = {
  English: "— (balance unavailable)",
} as const;
export const TOKEN_CARD_YOUR_BALANCE_HTML = {
  English: (holdingText: string) => `💼 <b>Your Balance:</b> ${holdingText}`,
} as const;

// ─── /referral — extracted stat labels ─────────────────────────────

export const REFERRAL_REFERRED_USERS_LABEL = {
  English: (count: number) => `Referred users: ${count}`,
} as const;
export const REFERRAL_LIFETIME_EARNED_LABEL = {
  English: (earnedUsdc: string) => `Lifetime earned: $${earnedUsdc} USDC`,
} as const;

// ─── /sell — extracted toasts ──────────────────────────────────────

export const SELL_NO_BALANCE_REPLY = {
  English: (ticker: string) => `You hold no ${ticker}.`,
} as const;
export const SELL_PERCENT_ROUNDS_TO_ZERO_REPLY = {
  English: (percent: number, ticker: string) =>
    `${percent}% of your ${ticker} balance rounds to zero.`,
} as const;
export const SELL_PERCENT_ROUNDS_TO_ZERO_TRY_LARGER_REPLY = {
  English: (percent: number, ticker: string) =>
    `${percent}% of your ${ticker} balance rounds to zero — try a larger percent.`,
} as const;
export const SELL_PROCEEDS_BELOW_MIN_TRY_LARGER_REPLY = {
  English: (proceedsUsd: number, minUsdc: number) =>
    `Estimated proceeds ≈$${proceedsUsd.toFixed(2)} would be below the $${minUsdc} minimum. Increase the percent or tap Home to exit.`,
} as const;
export const SELL_PROCEEDS_BELOW_MIN_REPLY = {
  English: (proceedsUsd: number, minUsdc: number) =>
    `Estimated proceeds ≈$${proceedsUsd.toFixed(2)} would be below the $${minUsdc} minimum.`,
} as const;
export const SELL_LT_BUFFER_TOO_LOW_REPLY = {
  English: (maxProceedsUsd: number, minUsdc: number) =>
    `LT buffer too low — max sell ≈$${maxProceedsUsd.toFixed(2)} < $${minUsdc} min. Retry in ~10s.`,
} as const;

// ─── /settings — extracted toasts ──────────────────────────────────

export const SETTINGS_SLIPPAGE_SET_REPLY = {
  English: (label: string) => `Slippage set to ${label}.`,
} as const;
export const SETTINGS_EXECUTION_SPEED_SET_REPLY = {
  English: (label: string) => `Execution speed set to ${label}.`,
} as const;

// ─── /sell — buffer-low banner ─────────────────────────────────────

export const SELL_BUFFER_BELOW_MIN_HTML = {
  English: (maxUsd: number, minUsdc: number) =>
    `❌ <b>LT buffer too low to sell.</b>\n\n` +
    `Max sell right now is ≈$${maxUsd.toFixed(2)}, which is below the $${minUsdc} minimum. ` +
    `BounceTech replenishes the buffer in ~10s — try again shortly.`,
} as const;
