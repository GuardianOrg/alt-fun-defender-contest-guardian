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

export type Language = "English" | "SimplifiedChinese";

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

/**
 * Read the user's preferred language off the grammY session. Falls back
 * to the default when no session is attached (conversation replay,
 * channel posts, anonymous admin updates) or when the user hasn't
 * picked one yet via `/settings → Language`. The narrow ctx shape keeps
 * this importable from `lib/*` modules that can't depend on `bot.ts`.
 */
export const getCtxLanguage = (
  ctx: { session?: { language?: Language } } | undefined,
): Language => {
  // Accessing `ctx.session` throws on grammY ctx flavors that have no
  // session bound (conversation replay, channel posts / anonymous
  // admin updates where the session-key resolver returned undefined).
  // Match the same try/catch pattern used by `ctxAntiPhishingPhrase`
  // so the fallback works uniformly across those surfaces.
  try {
    return ctx?.session?.language ?? DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
};

// ─── Navigation / global buttons ────────────────────────────────────

export const BACK_BUTTON_TEXT = {
  English: "← Back",
  SimplifiedChinese: "← 返回",
} as const;
export const HOME_BUTTON_TEXT = {
  English: "🏠 Home",
  SimplifiedChinese: "🏠 主页",
} as const;
export const REFRESH_BUTTON_TEXT = {
  English: "🔄 Refresh",
  SimplifiedChinese: "🔄 刷新",
} as const;

// ─── Start menu buttons ─────────────────────────────────────────────

export const START_BUY_USDC_VIA_RELAY_BUTTON = {
  English: "Buy USDC via Relay",
  SimplifiedChinese: "通过 Relay 购买 USDC",
} as const;
export const START_BUY_BUTTON = {
  English: "Buy",
  SimplifiedChinese: "买入",
} as const;
export const START_SELL_BUTTON = {
  English: "Sell",
  SimplifiedChinese: "卖出",
} as const;
export const START_POSITIONS_BUTTON = {
  English: "Positions",
  SimplifiedChinese: "持仓",
} as const;
export const START_TRACK_BUTTON = {
  English: "Track",
  SimplifiedChinese: "查看代币",
} as const;
export const START_WALLET_BUTTON = {
  English: "Wallet",
  SimplifiedChinese: "钱包",
} as const;
export const START_WITHDRAW_BUTTON = {
  English: "Withdraw",
  SimplifiedChinese: "提币",
} as const;
export const START_SETTINGS_BUTTON = {
  English: "⚙️ Settings",
  SimplifiedChinese: "⚙️ 设置",
} as const;
export const START_REFERRAL_BUTTON = {
  English: "Referral",
  SimplifiedChinese: "推荐",
} as const;
export const START_HELP_BUTTON = {
  English: "Help",
  SimplifiedChinese: "帮助",
} as const;

// ─── Wallet panel buttons ───────────────────────────────────────────

export const WALLET_CREATE_BUTTON = {
  English: "Create",
  SimplifiedChinese: "新建",
} as const;
export const WALLET_IMPORT_BUTTON = {
  English: "Import",
  SimplifiedChinese: "导入",
} as const;
export const WALLET_SWITCH_BUTTON = {
  English: "Switch",
  SimplifiedChinese: "切换",
} as const;
export const WALLET_RENAME_BUTTON = {
  English: "Rename",
  SimplifiedChinese: "重新命名",
} as const;
export const WALLET_DELETE_BUTTON = {
  English: "Delete",
  SimplifiedChinese: "删除",
} as const;
export const WALLET_EXPORT_KEY_BUTTON = {
  English: "Export key",
  SimplifiedChinese: "导出私钥",
} as const;
export const WALLET_WITHDRAW_BUTTON = {
  English: "Withdraw",
  SimplifiedChinese: "提币",
} as const;
export const WALLET_DELETE_NOW_BUTTON = {
  English: "Delete now",
  SimplifiedChinese: "立即删除",
} as const;

export const WALLET_SET_PIN_BUTTON = {
  English: "Set PIN",
  SimplifiedChinese: "设置 PIN 码",
} as const;
export const WALLET_CHANGE_PIN_BUTTON = {
  English: "Change PIN",
  SimplifiedChinese: "修改 PIN 码",
} as const;
export const WALLET_RESET_PIN_BUTTON = {
  English: "Reset PIN",
  SimplifiedChinese: "重置 PIN 码",
} as const;
export const WALLET_CANCEL_PIN_RESET_BUTTON = {
  English: "Cancel PIN reset",
  SimplifiedChinese: "取消 PIN 重置",
} as const;
export const WALLET_COMPLETE_PIN_RESET_BUTTON = {
  English: "Complete PIN reset",
  SimplifiedChinese: "完成 PIN 重置",
} as const;
export const WALLET_CANCEL_RESET_BUTTON = {
  English: "Cancel reset",
  SimplifiedChinese: "取消重置",
} as const;

export const WALLET_LOCK_ENABLED_BUTTON = {
  English: "🟢 Withdrawal lock",
  SimplifiedChinese: "🟢 提币锁",
} as const;
export const WALLET_LOCK_DISABLED_BUTTON = {
  English: "🔴 Withdrawal lock",
  SimplifiedChinese: "🔴 提币锁",
} as const;
export const WALLET_LOCK_CANCEL_DISABLE_BUTTON = {
  English: "🟢 Withdrawal lock (cancel disable)",
  SimplifiedChinese: "🟢 提币锁（取消停用）",
} as const;
export const WALLET_COMPLETE_DISABLE_BUTTON = {
  English: "🟠 Complete disable",
  SimplifiedChinese: "🟠 完成停用",
} as const;
export const WALLET_CANCEL_DISABLE_BUTTON = {
  English: "Cancel disable",
  SimplifiedChinese: "取消停用",
} as const;

export const WALLET_UNLABELED = {
  English: "(unlabeled)",
  SimplifiedChinese: "（未命名）",
} as const;

// ─── Settings panel ─────────────────────────────────────────────────

export const SETTINGS_SLIPPAGE_HEADER_BUTTON = {
  English: "-- Slippage --",
  SimplifiedChinese: "-- 滑点 --",
} as const;
export const SETTINGS_EXECUTION_SPEED_HEADER_BUTTON = {
  English: "-- Execution Speed --",
  SimplifiedChinese: "-- 执行速度 --",
} as const;
export const SETTINGS_LANGUAGE_HEADER_BUTTON = {
  English: "-- Language --",
  SimplifiedChinese: "-- 语言 --",
} as const;
export const SETTINGS_LANGUAGE_ENGLISH_BUTTON = {
  English: "English",
  SimplifiedChinese: "English",
} as const;
export const SETTINGS_LANGUAGE_SIMPLIFIED_CHINESE_BUTTON = {
  English: "简体中文",
  SimplifiedChinese: "简体中文",
} as const;
export const SETTINGS_CUSTOM_PERCENT_BUTTON = {
  English: "Custom %",
  SimplifiedChinese: "自定义 %",
} as const;
export const SETTINGS_BUY_SETTINGS_BUTTON = {
  English: "Buy Settings",
  SimplifiedChinese: "买入设置",
} as const;
export const SETTINGS_SELL_SETTINGS_BUTTON = {
  English: "Sell Settings",
  SimplifiedChinese: "卖出设置",
} as const;
export const SETTINGS_SET_PHRASE_BUTTON = {
  English: "Set anti-phishing phrase",
  SimplifiedChinese: "设置反钓鱼短语",
} as const;
export const SETTINGS_CHANGE_PHRASE_BUTTON = {
  English: "Change phrase",
  SimplifiedChinese: "修改短语",
} as const;
export const SETTINGS_CLEAR_PHRASE_BUTTON = {
  English: "Clear phrase",
  SimplifiedChinese: "清除短语",
} as const;
export const SETTINGS_DEGEN_MODE_ON_BUTTON = {
  English: "🟢 Degen mode",
  SimplifiedChinese: "🟢 极速交易模式",
} as const;
export const SETTINGS_DEGEN_MODE_OFF_BUTTON = {
  English: "🔴 Degen mode",
  SimplifiedChinese: "🔴 极速交易模式",
} as const;

// ─── Speed preset labels ────────────────────────────────────────────

export const SPEED_PRESET_LIGHTNING = {
  English: "Lightning",
  SimplifiedChinese: "闪电",
} as const;
export const SPEED_PRESET_FAST = {
  English: "Fast",
  SimplifiedChinese: "快速",
} as const;
export const SPEED_PRESET_ECO = {
  English: "Eco",
  SimplifiedChinese: "经济",
} as const;

// ─── Buy / sell token-card buttons ──────────────────────────────────

export const BUY_X_USDC_BUTTON = {
  English: "Buy X USDC",
  SimplifiedChinese: "买入 X USDC",
} as const;
export const SELL_X_PERCENT_BUTTON = {
  English: "Sell X%",
  SimplifiedChinese: "卖出 X%",
} as const;
export const BUY_AMOUNT_BUTTON = {
  English: (amount: number) => `Buy ${amount} USDC`,
  SimplifiedChinese: (amount: number) => `买入 ${amount} USDC`,
} as const;
export const SELL_PERCENT_BUTTON = {
  English: (pct: number) => `Sell ${pct}%`,
  SimplifiedChinese: (pct: number) => `卖出 ${pct}%`,
} as const;
export const BUY_ARROW_BUTTON = {
  English: "Buy →",
  SimplifiedChinese: "买入 →",
} as const;
export const SELL_ARROW_BUTTON = {
  English: "Sell →",
  SimplifiedChinese: "卖出 →",
} as const;
export const SETTINGS_BUY_PRESET_BUTTON = {
  English: (amount: number) => `✏️ ${amount} USDC`,
  SimplifiedChinese: (amount: number) => `✏️ ${amount} USDC`,
} as const;
export const SETTINGS_SELL_PRESET_BUTTON = {
  English: (pct: number) => `✏️ ${pct}%`,
  SimplifiedChinese: (pct: number) => `✏️ ${pct}%`,
} as const;

// ─── Generic outage / error replies ─────────────────────────────────

export const OUTAGE_REPLY = {
  English: "Data temporarily unavailable — try again in a moment.",
  SimplifiedChinese: "数据暂时无法获取——请稍后再试。",
} as const;
export const ACTION_TOKEN_OUTAGE_REPLY = {
  English: "Token data temporarily unavailable — try again in a moment.",
  SimplifiedChinese: "代币数据暂时无法获取——请稍后再试。",
} as const;
export const FAILED_TO_SAVE_REPLY = {
  English: "Failed to save — please retry.",
  SimplifiedChinese: "保存失败——请重试。",
} as const;
export const RUN_START_TO_RETURN_HOME_REPLY = {
  English: "Run /start to return home.",
  SimplifiedChinese: "发送 /start 返回主页。",
} as const;
export const INVALID_ADDRESS_REPLY = {
  English: "Invalid address. Please send a valid 0x-prefixed HyperEVM address.",
  SimplifiedChinese: "地址无效。请发送以 0x 开头的有效 HyperEVM 地址。",
} as const;

// ─── Common short toast strings ─────────────────────────────────────

export const TOAST_INVALID_REFRESH_REQUEST = {
  English: "Invalid refresh request.",
  SimplifiedChinese: "刷新请求无效。",
} as const;
export const TOAST_INVALID_PAGE_REQUEST = {
  English: "Invalid page request.",
  SimplifiedChinese: "翻页请求无效。",
} as const;
export const TOAST_INVALID_SWITCH_TARGET = {
  English: "Invalid switch target.",
  SimplifiedChinese: "切换目标无效。",
} as const;
export const TOAST_MISSING_USER = {
  English: "Missing user.",
  SimplifiedChinese: "缺少用户信息。",
} as const;
export const TOAST_MESSAGE_NO_LONGER_AVAILABLE = {
  English: "Message no longer available.",
  SimplifiedChinese: "消息已不可用。",
} as const;
export const TOAST_REFRESHED = {
  English: "Refreshed",
  SimplifiedChinese: "已刷新",
} as const;
export const TOAST_SUBMITTING = {
  English: "Submitting…",
  SimplifiedChinese: "提交中…",
} as const;
export const TOAST_SUBMITTING_ZAP = {
  English: "⚡ Submitting…",
  SimplifiedChinese: "⚡ 提交中…",
} as const;
export const TOAST_NO_ACTIVE_WALLET_RUN_WALLET = {
  English: "No active wallet — run /wallet to set one up.",
  SimplifiedChinese: "暂无活动钱包——发送 /wallet 创建一个。",
} as const;
export const TOAST_NO_ACTIVE_WALLET = {
  English: "No active wallet.",
  SimplifiedChinese: "暂无活动钱包。",
} as const;
export const TOAST_NO_ACTIVE_WALLET_TO_DELETE = {
  English: "No active wallet to delete.",
  SimplifiedChinese: "暂无可删除的活动钱包。",
} as const;
export const TOAST_NO_ACTIVE_WALLET_TO_EXPORT = {
  English: "No active wallet to export.",
  SimplifiedChinese: "暂无可导出的活动钱包。",
} as const;
export const TOAST_NO_ACTIVE_WALLET_TO_RENAME = {
  English: "No active wallet to rename.",
  SimplifiedChinese: "暂无可重新命名的活动钱包。",
} as const;
export const TOAST_NO_WALLETS_TO_SWITCH = {
  English: "No wallets to switch to.",
  SimplifiedChinese: "暂无其他钱包可切换。",
} as const;
export const TOAST_WALLET_NO_LONGER_EXISTS = {
  English: "Wallet no longer exists.",
  SimplifiedChinese: "钱包已不存在。",
} as const;
export const TOAST_UNABLE_TO_VERIFY_USDC_BALANCE = {
  English: "Unable to verify your USDC balance — please try again.",
  SimplifiedChinese: "无法验证您的 USDC 余额——请重试。",
} as const;
export const TOAST_UNABLE_TO_VERIFY_TOKEN_BALANCE = {
  English: "Unable to verify your token balance — please try again.",
  SimplifiedChinese: "无法验证您的代币余额——请重试。",
} as const;
export const TOAST_LOCK_NOT_ENABLED = {
  English: "Lock is not enabled.",
  SimplifiedChinese: "提币锁未启用。",
} as const;
export const TOAST_PIN_ALREADY_SET = {
  English: "PIN already set. Use Change PIN or Reset PIN.",
  SimplifiedChinese: "PIN 码已设置。请使用修改 PIN 码或重置 PIN 码。",
} as const;
export const TOAST_RESET_ALREADY_READY = {
  English: "Reset already ready — tap Complete PIN reset.",
  SimplifiedChinese: "重置已就绪——请点击完成 PIN 重置。",
} as const;
export const TOAST_NO_PIN_RESET_IN_PROGRESS = {
  English: "No PIN reset in progress.",
  SimplifiedChinese: "当前没有进行中的 PIN 重置。",
} as const;
export const TOAST_RESET_CANCELLED = {
  English: "Reset canceled.",
  SimplifiedChinese: "已取消重置。",
} as const;
export const TOAST_DISABLE_CANCELLED = {
  English: "Disable canceled.",
  SimplifiedChinese: "已取消停用。",
} as const;
export const TOAST_PHRASE_CLEARED = {
  English: "Phrase cleared.",
  SimplifiedChinese: "短语已清除。",
} as const;
export const TOAST_DELETED = {
  English: "Deleted.",
  SimplifiedChinese: "已删除。",
} as const;
export const TOAST_DELETE_CANCELLED = {
  English: "Delete canceled.",
  SimplifiedChinese: "已取消删除。",
} as const;
export const TOAST_CANCELLED = {
  English: "Canceled.",
  SimplifiedChinese: "已取消。",
} as const;
export const TOAST_WITHDRAWAL_LOCK_ENABLED = {
  English: "Withdrawal lock enabled.",
  SimplifiedChinese: "提币锁已启用。",
} as const;
export const TOAST_WITHDRAWAL_LOCK_DISABLED = {
  English: "Withdrawal lock disabled.",
  SimplifiedChinese: "提币锁已停用。",
} as const;
export const TOAST_LOADING_WITHDRAW = {
  English: "Loading withdraw…",
  SimplifiedChinese: "加载提币中…",
} as const;
export const TOAST_CONFIRMATION_EXPIRED_WITHDRAW = {
  English: "Confirmation expired — re-run /withdraw.",
  SimplifiedChinese: "确认已过期——请重新发送 /withdraw。",
} as const;
export const TOAST_LANGUAGE_SET_ENGLISH = {
  English: "Language set to English.",
  SimplifiedChinese: "语言已切换为 English。",
} as const;
export const TOAST_LANGUAGE_SET_SIMPLIFIED_CHINESE = {
  English: "Language set to 简体中文.",
  SimplifiedChinese: "语言已切换为简体中文。",
} as const;

// ─── Private-DM only banners (per command) ─────────────────────────

export const REFERRAL_PRIVATE_DM_ONLY_REPLY = {
  English: "Referral is private-DM only.",
  SimplifiedChinese: "推荐功能仅限私聊使用。",
} as const;
export const REFRESH_PRIVATE_DM_ONLY_REPLY = {
  English: "Refresh is private-DM only.",
  SimplifiedChinese: "刷新仅限私聊使用。",
} as const;
export const SETTINGS_PRIVATE_DM_ONLY_REPLY = {
  English: "Settings actions are private-DM only.",
  SimplifiedChinese: "设置操作仅限私聊使用。",
} as const;
export const WALLET_PRIVATE_DM_ONLY_REPLY = {
  English: "Wallet actions are private-DM only.",
  SimplifiedChinese: "钱包操作仅限私聊使用。",
} as const;
export const WITHDRAW_PRIVATE_DM_ONLY_REPLY = {
  English: "Withdrawals are private-DM only.",
  SimplifiedChinese: "提币操作仅限私聊使用。",
} as const;

// ─── Positions ──────────────────────────────────────────────────────

export const POSITIONS_USAGE_REPLY = {
  English: "Usage: /positions <wallet_address>",
  SimplifiedChinese: "用法：/positions <钱包地址>",
} as const;
export const POSITIONS_NO_ACTIVE_WALLET_REPLY = {
  English: "No active wallet. Run /wallet to create one.",
  SimplifiedChinese: "暂无活动钱包。发送 /wallet 创建一个。",
} as const;
export const POSITIONS_NO_OPEN_POSITIONS_REPLY = {
  English: "No open positions for this wallet.",
  SimplifiedChinese: "该钱包暂无未平仓位。",
} as const;

// ─── Buy / sell token loading + not found ───────────────────────────

export const BUY_CARD_LOADING_HTML = {
  English: (shortAddress: string) =>
    `⏳ Loading <code>${shortAddress}</code>…`,
  SimplifiedChinese: (shortAddress: string) =>
    `⏳ 正在加载 <code>${shortAddress}</code>…`,
} as const;

export const TOKEN_NOT_FOUND_HTML = {
  English:
    '❌ <b>Token not found.</b>\n\n' +
    'Make sure you have the correct contract address. You can find it on:\n' +
    '• <a href="https://alt.fun">alt.fun</a> — tap the token → copy address\n' +
    '• <a href="https://hyperevmscan.io">hyperevmscan.io</a> — search the token → copy address',
  SimplifiedChinese:
    '❌ <b>未找到该代币。</b>\n\n' +
    '请确认合约地址正确。您可以在以下位置查找:\n' +
    '• <a href="https://alt.fun">alt.fun</a> — 点击代币 → 复制地址\n' +
    '• <a href="https://hyperevmscan.io">hyperevmscan.io</a> — 搜索代币 → 复制地址',
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
      "/wallet — create, import, switch, export, or delete wallets; set PIN; toggle withdrawal lock",
      "/buy &lt;contract&gt; [amount] — buy a token with USDC",
      "/sell &lt;contract or ticker&gt; — sell a position by % of balance",
      "/positions — open and realized positions with cost basis and PnL",
      "/track &lt;contract&gt; — chart + token card + recent trades",
      "/withdraw &lt;asset&gt; &lt;amount&gt; &lt;address&gt; — send funds out",
      "/settings — language, slippage, execution speed, degen mode, buy/sell presets, anti-phishing phrase",
      "/referral — your referral link, referred count, and lifetime USDC earned",
      "",
      "<b>Topics</b>",
      "Send <code>/help &lt;topic&gt;</code> for detail on:",
      TOPIC_LIST_LINKS(topics),
      "",
      "<b>Security tips</b>",
      `• ${BOT_NAME} will <b>never</b> ask for your seed phrase or private key via DM.`,
      `• Never search for ${BOT_NAME} in Telegram. Only follow links from sources you already trust.`,
      "• Admins and mods never DM first or send links — stay safe.",
      "• Set a PIN in /wallet so withdrawals, key exports, and rewards-wallet changes require a 6-digit code.",
    ].join("\n"),
  SimplifiedChinese: (topics: readonly string[]) =>
    [
      HELP_HEADER_PLACEHOLDER,
      "",
      `<b>${BOT_NAME} 帮助</b>`,
      "",
      "<b>可以交易哪些代币？</b>",
      "所有在 alt.fun 上发行的代币。每个代币的联合曲线均以 BounceTech 杠杆代币（LT）作为储备资产，因此价格会同时受到买入压力<i>和</i>杠杆标的（HYPE、ETH、BTC、SOL）的影响。代币毕业后，交易将在 HyperSwap 上的 TOKEN/LT 交易对中继续——杠杆敞口持续保留。",
      "",
      "<b>常用命令</b>",
      "/start — 主菜单、余额、钱包地址",
      "/wallet — 创建、导入、切换、导出或删除钱包；设置 PIN；切换提币锁",
      "/buy &lt;合约&gt; [金额] — 使用 USDC 买入代币",
      "/sell &lt;合约或代号&gt; — 按余额百分比卖出仓位",
      "/positions — 未平与已实现仓位，含成本基础与盈亏",
      "/track &lt;合约&gt; — 价格图 + 代币卡片 + 最近交易",
      "/withdraw &lt;资产&gt; &lt;金额&gt; &lt;地址&gt; — 提币",
      "/settings — 语言、滑点、执行速度、极速模式、买入/卖出预设、反钓鱼短语",
      "/referral — 您的推荐链接、推荐人数与累计 USDC 收益",
      "",
      "<b>主题</b>",
      "发送 <code>/help &lt;主题&gt;</code> 查看详情：",
      TOPIC_LIST_LINKS(topics),
      "",
      "<b>安全提示</b>",
      `• ${BOT_NAME} <b>绝不会</b>通过私聊向您索取助记词或私钥。`,
      `• 切勿在 Telegram 中搜索 ${BOT_NAME}。仅点击您已信任来源的链接。`,
      "• 管理员与版主绝不会主动私聊或发送链接——请提高警惕。",
      "• 在 /wallet 中设置 PIN 码，让提币、私钥导出、奖励钱包修改均需 6 位数字验证。",
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
    "• Set or change your 6-digit PIN — see <code>/help security</code>",
    "• Enable the withdrawal lock — see <code>/help security</code>",
    "",
    "Private keys are encrypted with AES-256-GCM under a per-user key. The master key never touches storage and one user's ciphertext cannot be decrypted under another user's derivation.",
    "",
    "Funding: send USDC or HYPE on HyperEVM to your active wallet address (shown on /start). USDC is the trading currency; HYPE pays gas.",
  ].join("\n"),
  SimplifiedChinese: [
    HELP_HEADER_PLACEHOLDER,
    "",
    "<b>钱包</b>",
    "",
    `每个 Telegram 账户在 ${BOT_NAME} 上最多可保存 10 个钱包。其中始终有一个为<i>活动</i>钱包——买入、卖出与提币均使用该钱包作为签名者。`,
    "",
    "点击 /start 上的钱包按钮，或发送 /wallet 以：",
    "• 创建新钱包（自动加密，存储于我们的 KV 中）",
    "• 通过私钥或助记词导入已有钱包——您发送的私钥消息将在机器人读取后立即删除",
    "• 切换活动钱包",
    "• 为钱包命名",
    "• 导出私钥（需 PIN 码，30 秒后自动删除）",
    "• 删除钱包（需 PIN 码）",
    "• 设置或修改 6 位数字 PIN 码——详见 <code>/help security</code>",
    "• 启用提币锁——详见 <code>/help security</code>",
    "",
    "私钥使用每用户独立密钥经 AES-256-GCM 加密。主密钥永不存储；一个用户的密文无法用另一用户的派生密钥解密。",
    "",
    "充值：在 HyperEVM 上向您的活动钱包地址（/start 中显示）发送 USDC 或 HYPE。USDC 为交易货币；HYPE 用于支付矿工费。",
  ].join("\n"),
} as const;

export const HELP_TRADING_HTML = {
  English: [
    HELP_HEADER_PLACEHOLDER,
    "",
    "<b>Buying and selling</b>",
    "",
    "<b>/buy &lt;contract&gt; [amount] [slippage=&lt;bps&gt;]</b>",
    "Quote and confirm a buy. The card shows five quick-amount buttons (default $20 / $40 / $60 / $80 / $100) plus a Buy X USDC custom-amount prompt — each slot is customizable under /settings → Buy Settings. The minimum buy is $20 USDC.",
    "",
    "<b>/sell &lt;contract or ticker&gt;</b>",
    "Sell a position by percentage of your balance — five quick-sell buttons (default 10 / 25 / 50 / 75 / 100%) plus a Sell X% custom-percent prompt, each slot customizable under /settings → Sell Settings. Minimum sell is ~$12 USDC of estimated proceeds. Sells redeem through the BounceTech LT path; if its USDC buffer is depleted the trade can revert with <code>InsufficientBalance</code> — sell in smaller chunks and retry after ~10 seconds.",
    "",
    "<b>Confirmations and degen mode</b>",
    "Degen mode (default on) submits a trade the moment you tap an amount — no Confirm step. Turn it off in /settings to add an inline [Confirm]/[Cancel] step with a 60-second window. Buffer-capped sells always require an explicit confirm regardless of degen mode.",
    "",
    "<b>Common failure reasons</b>",
    "• <i>Slippage exceeded</i> — raise the slippage preset in /settings or split into smaller trades.",
    "• <i>Insufficient balance</i> — fund USDC for buys or HYPE for gas.",
    "• <i>LT mint-paused</i> — buys are temporarily disabled by BounceTech for that LT; sells still work.",
    "• <i>Buffer too low</i> — the LT's USDC buffer is depleted; sell less and retry in ~10 seconds.",
    "• <i>Pending &gt; 30 min</i> — the bubble keeps the explorer link; the chain settled the tx (or didn't) on its own.",
    "",
    "See also: <code>/help fees</code>, <code>/help pnl</code>.",
  ].join("\n"),
  SimplifiedChinese: [
    HELP_HEADER_PLACEHOLDER,
    "",
    "<b>买入与卖出</b>",
    "",
    "<b>/buy &lt;合约&gt; [金额] [slippage=&lt;基点&gt;]</b>",
    "查询并确认买入。买入卡片提供 5 个快捷金额按钮（默认 $20 / $40 / $60 / $80 / $100）以及「买入 X USDC」自定义金额输入——每个槽位可在 /settings → 买入设置中自定义。最低买入金额为 $20 USDC。",
    "",
    "<b>/sell &lt;合约或代号&gt;</b>",
    "按余额百分比卖出仓位——5 个快捷卖出按钮（默认 10 / 25 / 50 / 75 / 100%）以及「卖出 X%」自定义百分比输入，每个槽位可在 /settings → 卖出设置中自定义。最低卖出预估收益约 $12 USDC。卖出通过 BounceTech LT 赎回路径执行；若 LT 的 USDC 流动性缓冲耗尽，交易可能以 <code>InsufficientBalance</code> 回滚——请分批小额卖出，并在约 10 秒后重试。",
    "",
    "<b>确认步骤与极速模式</b>",
    "极速模式（默认开启）会在您点击金额按钮的同时立即提交交易，不显示确认步骤。在 /settings 中关闭后，将出现内嵌 [确认]/[取消] 步骤，60 秒内有效。缓冲不足导致需要降额的卖出始终需要显式确认，不受极速模式影响。",
    "",
    "<b>常见失败原因</b>",
    "• <i>滑点超出</i> — 在 /settings 中提高滑点预设，或拆分为更小金额交易。",
    "• <i>余额不足</i> — 买入需要充值 USDC，矿工费需要充值 HYPE。",
    "• <i>LT 铸造已暂停</i> — 该 LT 被 BounceTech 暂时禁用买入；卖出仍可正常进行。",
    "• <i>缓冲不足</i> — LT 的 USDC 缓冲耗尽，请减小金额并在约 10 秒后重试。",
    "• <i>挂起超过 30 分钟</i> — 气泡保留区块浏览器链接；该笔交易已由链上自行结算或未上链。",
    "",
    "另请参阅：<code>/help fees</code>、<code>/help pnl</code>。",
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
  SimplifiedChinese: [
    HELP_HEADER_PLACEHOLDER,
    "",
    "<b>费用</b>",
    "",
    "每次买入与卖出（无论是联合曲线阶段还是毕业后阶段）均以 USDC 支付两类费用：",
    "",
    `• <b>机器人费用 0.5%</b> — 由 ${BOT_NAME} 收取。如果您通过推荐链接进入，则交易额的 0.1% 将支付给推荐人的奖励钱包；其余部分进入机器人金库。`,
    "• <b>Alt Fun 费用 0.75%</b> — 由 alt.fun 协议收取。其中 0.5% 归协议，0.25%（占该费用的 33%）支付给代币创建者。",
    "",
    `毕业后交易还需额外支付 HyperSwap 的 0.3% 流动性提供者费用，支付给 HyperSwap 流动性提供者（${BOT_NAME} 不收取其中任何份额）。`,
    "",
    "没有订阅费，也没有付费墙。充值和闲置余额均不收取费用。",
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
    "<b>Open vs. realized</b>",
    "/positions shows two sections: <i>Open positions</i> (tokens you still hold, unrealized PnL marked to the live curve / HyperSwap price) and <i>Realized positions</i> (closed-out chunks across your lifetime, using average-cost accounting). Each section paginates 5 records at a time and is sorted by absolute PnL.",
    "",
    "So the figure on /positions is what you actually received, not the gross notional. To audit a specific trade, open the tx hash from your trade confirmation on a HyperEVM block explorer.",
  ].join("\n"),
  SimplifiedChinese: [
    HELP_HEADER_PLACEHOLDER,
    "",
    "<b>为什么我的净利润低于预期？</b>",
    "",
    "/positions 中显示的净利润是在扣除该交易实际产生的全部成本后计算得出的：",
    "",
    "• 联合曲线或 HyperSwap 交易对上的价格冲击",
    "• Alt Fun 协议 + 创建者费用（0.75%）",
    `• ${BOT_NAME} 费用（0.5%，若您有推荐人则其中 0.1% 支付给推荐人）`,
    "• BounceTech LT 铸造 / 赎回费用",
    "• 以 HYPE 支付的矿工费",
    "",
    "<b>未平仓位与已实现仓位</b>",
    "/positions 显示两个部分：<i>未平仓位</i>（您仍持有的代币，未实现盈亏按联合曲线/HyperSwap 实时价格计算）以及<i>已实现仓位</i>（您历史上已平仓的部分，按平均成本法核算）。每个部分每页 5 条独立分页，按盈亏绝对值排序。",
    "",
    "因此 /positions 中显示的是您实际收到的金额，而非毛额名义价值。如需审计具体交易，请在 HyperEVM 区块浏览器中查看交易确认中的 tx hash。",
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
    `• Never search for ${BOT_NAME} in Telegram. Only follow links from sources you already trust.`,
    "• Admins and mods never DM first or send links. Treat any unsolicited DM as a phishing attempt.",
    "• Set an <i>anti-phishing phrase</i> in /settings. The bot prepends it to every message, so a phisher impersonating the bot won't know your phrase.",
    "",
    "<b>PIN</b>",
    "Set a 6-digit PIN in /wallet. The PIN gates withdrawals, private key exports, wallet deletion, and rewards-wallet changes. After 5 wrong attempts you're locked out for 30 minutes. If you forget your PIN, request a reset in /wallet — the new PIN unlocks after a 24-hour delay, and your old PIN keeps working during the cooldown so you can cancel a hostile request from /wallet (the delay is what protects you from a stolen Telegram session draining your funds).",
    "",
    "<b>Withdrawal lock</b>",
    "Enable the withdrawal lock in /wallet to block all outbound transfers. Enabling is instant. Disabling is two-phase: tap the Withdrawal lock button to request disable, wait 24 hours, then tap [Complete disable] on /wallet to actually clear it. During the cooldown the button becomes [Withdrawal lock (cancel disable)] so you can revoke the request before it takes effect.",
    "",
    "<b>If you suspect compromise</b>",
    "• Enable the withdrawal lock to freeze outbound transfers immediately.",
    "• Export your private key from /wallet (PIN-gated, 30-second auto-delete) and move funds to a wallet that has never been touched by this bot.",
    "• Once funds are out, delete the compromised wallet from /wallet.",
  ].join("\n"),
  SimplifiedChinese: [
    HELP_HEADER_PLACEHOLDER,
    "",
    "<b>安全</b>",
    "",
    `${BOT_NAME} <b>绝不会</b>通过私聊向您索取助记词或私钥，也绝不会要求您通过电话号码或二维码登录。`,
    "",
    "<b>保护您的账户</b>",
    `• 切勿在 Telegram 中搜索 ${BOT_NAME}。仅点击您已信任来源的链接。`,
    "• 管理员与版主绝不会主动私聊或发送链接。任何主动私聊均视为钓鱼。",
    "• 在 /settings 中设置<i>反钓鱼短语</i>。机器人会将其前置于每条消息，仿冒机器人的钓鱼者不会知道您的短语。",
    "",
    "<b>PIN 码</b>",
    "在 /wallet 中设置 6 位数字 PIN 码。PIN 码用于保护提币、私钥导出、钱包删除与奖励钱包修改。连续输错 5 次后将被锁定 30 分钟。若忘记 PIN 码，可在 /wallet 中申请重置——新 PIN 码将在 24 小时延迟后解锁，冷却期内旧 PIN 仍可使用，便于您在 /wallet 中撤销异常请求（此延迟可保护您在 Telegram 会话被盗时资金不被立即转走）。",
    "",
    "<b>提币锁</b>",
    "在 /wallet 中启用提币锁，可阻止所有外部转账。启用立即生效。停用分两步：点击「提币锁」按钮发起停用请求，等待 24 小时，再在 /wallet 中点击 [完成停用] 才会真正解除。冷却期内按钮会变为 [提币锁（取消停用）]，可在生效前撤销请求。",
    "",
    "<b>若怀疑账户已被入侵</b>",
    "• 立即启用提币锁，冻结所有外部转账。",
    "• 在 /wallet 中导出私钥（需 PIN 码，30 秒后自动删除）并将资金转移至从未在本机器人中使用过的钱包。",
    "• 资金转出后，在 /wallet 中删除被入侵的钱包。",
  ].join("\n"),
} as const;

export const HELP_REFERRALS_HTML = {
  English: [
    HELP_HEADER_PLACEHOLDER,
    "",
    "<b>Referrals</b>",
    "",
    "Open /referral (or tap the Referral button on /start) to see your shareable link, the number of users you've referred, and your lifetime USDC earned. There is no claim or withdraw button — your cut is paid directly to your <i>rewards wallet</i> on-chain, in the same transaction as each referred user's trade. Your share is 0.1% of every referred user's trade volume, taken from the bot fee.",
    "",
    "<b>Rewards wallet</b>",
    "Defaults to your active custodial bot wallet on first /start. You can change it via /referral → Change rewards wallet (PIN-gated). The picker offers your existing custodial wallets one-tap or a Custom row for any HyperEVM address. Changing it does <b>not</b> redirect already-attributed referees — past referees keep paying out to the previously-set address forever by on-chain attribution. Set this to a long-lived address you control on day one.",
    "",
    "<b>Referrer attribution</b>",
    "Attribution is recorded once, on a referee's first /start, and is lifetime by construction — every subsequent trade pays the resolved rewards wallet forever. Edge cases that result in <b>no</b> referrer being recorded:",
    "• The referee's first /start was bare (no deeplink). A later /start with a deeplink cannot retroactively add one.",
    "• You used your own deeplink (self-referral) — the deeplink is dropped silently.",
    "• The referrer had not yet onboarded their own bot account when the referee hit /start. The next time the referrer opens /referral, a banner flags any referees lost this way.",
  ].join("\n"),
  SimplifiedChinese: [
    HELP_HEADER_PLACEHOLDER,
    "",
    "<b>推荐</b>",
    "",
    "打开 /referral（或点击 /start 上的推荐按钮）查看您的分享链接、已推荐的用户数以及历史累计 USDC 收益。没有领取或提取按钮——您的分成会在每位被推荐用户的交易中，于同一笔链上交易中直接支付至您的<i>奖励钱包</i>。您可获得每位被推荐用户交易额的 0.1%，从机器人费用中分出。",
    "",
    "<b>奖励钱包</b>",
    "首次 /start 时默认为您的活动托管机器人钱包。您可通过 /referral → 修改奖励钱包（需 PIN 码）进行修改。选择器提供您现有的托管钱包一键选择，或选择「自定义」输入任意 HyperEVM 地址。修改奖励钱包<b>不会</b>重新分配已归属的被推荐人——历史被推荐人将根据链上归属继续永久向先前设置的地址支付。请在第一天就将其设置为您长期持有的地址。",
    "",
    "<b>推荐人归属</b>",
    "归属仅在被推荐人首次 /start 时记录一次，按设计为终身有效——之后所有交易均永久向解析后的奖励钱包支付。以下情况将<b>不</b>记录推荐人：",
    "• 被推荐人首次 /start 未带推荐链接。之后再带推荐链接的 /start 也无法追加。",
    "• 您使用了自己的推荐链接（自我推荐）——该链接将被静默丢弃。",
    "• 被推荐人 /start 时，推荐人尚未完成自己的机器人账户设置。推荐人下次打开 /referral 时，横幅会提示有归属丢失的被推荐人。",
  ].join("\n"),
} as const;

export const HELP_WITHDRAW_HTML = {
  English: [
    HELP_HEADER_PLACEHOLDER,
    "",
    "<b>Withdrawals</b>",
    "",
    "Send <code>/withdraw &lt;asset&gt; &lt;amount&gt; &lt;address&gt;</code> to move funds out of your active bot wallet. <code>&lt;asset&gt;</code> is <code>USDC</code> or <code>HYPE</code>; <code>&lt;address&gt;</code> is any HyperEVM address.",
    "",
    "Every withdrawal walks through a multi-step confirmation:",
    "1. Bot shows asset, amount, destination, and the estimated network fee in USDC equivalent",
    "2. If the withdrawal lock is enabled in /wallet, every withdrawal is blocked until the lock is disabled (24-hour cooldown applies)",
    "3. PIN prompt",
    "4. Confirm button (60-second timeout — expired confirms are silently dropped)",
    "",
    "Network fee is estimated from <code>eth_estimateGas</code> and shown in USDC equivalent before you confirm. Token positions (Alt Fun tokens you bought) are not withdrawable directly — sell them via /sell first, then withdraw the USDC proceeds.",
  ].join("\n"),
  SimplifiedChinese: [
    HELP_HEADER_PLACEHOLDER,
    "",
    "<b>提币</b>",
    "",
    "发送 <code>/withdraw &lt;资产&gt; &lt;金额&gt; &lt;地址&gt;</code> 即可将资金从活动机器人钱包转出。<code>&lt;资产&gt;</code> 为 <code>USDC</code> 或 <code>HYPE</code>；<code>&lt;地址&gt;</code> 为任意 HyperEVM 地址。",
    "",
    "每次提币均经过多步确认：",
    "1. 机器人显示资产、金额、目标地址与以 USDC 等值表示的预估网络费用",
    "2. 若在 /wallet 中启用了提币锁，则在解除锁定前所有提币均被阻止（适用 24 小时冷却期）",
    "3. PIN 码验证",
    "4. 确认按钮（60 秒超时——已过期的确认将被静默丢弃）",
    "",
    "网络费用通过 <code>eth_estimateGas</code> 估算，并在您确认前以 USDC 等值显示。代币仓位（您买入的 Alt Fun 代币）无法直接提币——请先通过 /sell 卖出，再提取所得 USDC。",
  ].join("\n"),
} as const;

export const HELP_UNKNOWN_TOPIC_HTML = {
  English: (topics: readonly string[]) =>
    [
      HELP_HEADER_PLACEHOLDER,
      "",
      `Unknown help topic. Send <code>/help</code> for the overview, or pick one of: ${TOPIC_LIST_INLINE(topics)}.`,
    ].join("\n"),
  SimplifiedChinese: (topics: readonly string[]) =>
    [
      HELP_HEADER_PLACEHOLDER,
      "",
      `未知的帮助主题。请发送 <code>/help</code> 查看概览，或选择以下其中一项：${TOPIC_LIST_INLINE(topics)}。`,
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
  SimplifiedChinese:
    "钱包需要个人 Telegram 账户——此消息未附带用户信息。",
} as const;
export const START_NON_PRIVATE_CHAT_REPLY = {
  English:
    "Wallet flows are private-DM only — your wallet address would leak in a group. Open a direct chat with the bot to use /start.",
  SimplifiedChinese:
    "钱包流程仅限私聊使用——在群组中会泄露您的钱包地址。请与机器人开启私聊后再发送 /start。",
} as const;

// ─── /wallet ────────────────────────────────────────────────────────

export const WALLET_NO_USER_REPLY = {
  English:
    "Wallets require a personal Telegram account — this message has no user attached (channel post or anonymous admin).",
  SimplifiedChinese:
    "钱包需要个人 Telegram 账户——此消息未附带用户信息（频道帖子或匿名管理员）。",
} as const;
export const WALLET_NON_PRIVATE_CHAT_REPLY = {
  English:
    "Wallet flows are private-DM only — wallet labels and addresses must not surface in groups. Open a direct chat with the bot to manage wallets.",
  SimplifiedChinese:
    "钱包流程仅限私聊使用——钱包名称与地址不应出现在群组中。请与机器人开启私聊后再管理钱包。",
} as const;

// ─── /settings ──────────────────────────────────────────────────────

export const SETTINGS_NO_USER_REPLY = {
  English:
    "Settings require a personal Telegram account — this message has no user attached (channel post or anonymous admin).",
  SimplifiedChinese:
    "设置需要个人 Telegram 账户——此消息未附带用户信息（频道帖子或匿名管理员）。",
} as const;
export const SETTINGS_NON_PRIVATE_CHAT_REPLY = {
  English:
    "Settings are private-DM only — your slippage and buy defaults should not surface in groups. Open a direct chat with the bot to manage settings.",
  SimplifiedChinese:
    "设置仅限私聊使用——您的滑点与买入默认值不应出现在群组中。请与机器人开启私聊后再管理设置。",
} as const;

// ─── /withdraw ──────────────────────────────────────────────────────

export const WITHDRAW_NO_USER_REPLY = {
  English:
    "Withdrawals require a personal Telegram account — this message has no user attached.",
  SimplifiedChinese:
    "提币需要个人 Telegram 账户——此消息未附带用户信息。",
} as const;
export const WITHDRAW_NON_PRIVATE_CHAT_REPLY = {
  English:
    "Withdrawal flows are private-DM only — your wallet address and PIN must not surface in groups. Open a direct chat with the bot to use /withdraw.",
  SimplifiedChinese:
    "提币流程仅限私聊使用——您的钱包地址与 PIN 码不应出现在群组中。请与机器人开启私聊后再发送 /withdraw。",
} as const;
export const WITHDRAW_NO_ACTIVE_WALLET_REPLY = {
  English:
    "No active wallet — run /wallet to create or import one before withdrawing.",
  SimplifiedChinese:
    "暂无活动钱包——请先发送 /wallet 创建或导入钱包，再进行提币。",
} as const;
export const WITHDRAW_LOCKED_REPLY = {
  English:
    "Withdrawal lock is on. Disable it in /security first (24-hour cooldown).",
  SimplifiedChinese:
    "提币锁已开启。请先在 /security 中停用（24 小时冷却期）。",
} as const;
export const WITHDRAW_NO_PIN_REPLY = {
  English:
    "No PIN set — run /security to set one before withdrawing. The PIN protects withdrawals from a stolen Telegram session.",
  SimplifiedChinese:
    "未设置 PIN 码——请先发送 /security 设置 PIN 码后再提币。PIN 码可在 Telegram 会话被盗时保护您的提币安全。",
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
  SimplifiedChinese: [
    "用法：/withdraw <资产> <金额> <地址>",
    "",
    "示例：",
    "  /withdraw HYPE 0.1 0xabc…",
    "  /withdraw USDC 25 0xabc…",
    "",
    "支持的资产：HYPE、USDC",
  ].join("\n"),
} as const;

// ─── /positions ─────────────────────────────────────────────────────

export const POSITIONS_NON_PRIVATE_CHAT_REPLY = {
  English:
    "Positions are private-DM only — open a direct chat with the bot to view your positions.",
  SimplifiedChinese:
    "持仓查询仅限私聊使用——请与机器人开启私聊后再查看持仓。",
} as const;
export const POSITIONS_INVALID_ADDRESS_REPLY = {
  English:
    "Invalid wallet address. Expected a 0x-prefixed 40-character hex address.",
  SimplifiedChinese:
    "钱包地址无效。需为以 0x 开头的 40 位十六进制地址。",
} as const;

// ─── /referral ──────────────────────────────────────────────────────

export const REFERRAL_NON_PRIVATE_CHAT_REPLY = {
  English:
    "Referral flows are private-DM only — your wallet address would leak in a group. Open a direct chat with the bot to use /referral.",
  SimplifiedChinese:
    "推荐流程仅限私聊使用——在群组中会泄露您的钱包地址。请与机器人开启私聊后再发送 /referral。",
} as const;
export const REFERRAL_NO_USER_REPLY = {
  English:
    "Referrals require a personal Telegram account — this message has no user attached.",
  SimplifiedChinese:
    "推荐功能需要个人 Telegram 账户——此消息未附带用户信息。",
} as const;
export const REFERRAL_NO_WALLET_REPLY = {
  English:
    "No active wallet yet — run /start to create one before sharing your referral link.",
  SimplifiedChinese:
    "暂无活动钱包——请先发送 /start 创建钱包，再分享推荐链接。",
} as const;
export const REFERRAL_CHANGE_REWARDS_WALLET_BUTTON = {
  English: "Change rewards wallet",
  SimplifiedChinese: "修改奖励钱包",
} as const;
export const REFERRAL_CUSTOM_BUTTON = {
  English: "Custom",
  SimplifiedChinese: "自定义",
} as const;

// ─── /buy /sell /track shared lookup prompt & not-found ────────────

export const TOKEN_LOOKUP_PROMPT_HTML = {
  English:
    "Enter the token contract address or paste a link from alt.fun or hyperevmscan.\n\n" +
    "Examples:\n" +
    "• <code>0x1234…abcd</code>\n" +
    "• <code>https://alt.fun/0x1234…</code>\n" +
    "• <code>https://hyperevmscan.io/token/0x1234…</code>\n\n" +
    "Tap Home to exit.",
  SimplifiedChinese:
    "请输入代币合约地址，或粘贴来自 alt.fun 或 hyperevmscan 的链接。\n\n" +
    "示例：\n" +
    "• <code>0x1234…abcd</code>\n" +
    "• <code>https://alt.fun/0x1234…</code>\n" +
    "• <code>https://hyperevmscan.io/token/0x1234…</code>\n\n" +
    "点击主页退出。",
} as const;

export const TOKEN_LOOKUP_NOT_FOUND_RETRY_HTML = {
  English:
    "❌ <b>Token not found.</b>\n\n" +
    "Make sure you have the correct contract address. You can find it on:\n" +
    '• <a href="https://alt.fun">alt.fun</a> — tap the token → copy address\n' +
    '• <a href="https://hyperevmscan.io">hyperevmscan.io</a> — search the token → copy address\n\n' +
    "Try again, or tap Home to exit.",
  SimplifiedChinese:
    "❌ <b>未找到该代币。</b>\n\n" +
    "请确认合约地址正确。您可以在以下位置查找：\n" +
    '• <a href="https://alt.fun">alt.fun</a> — 点击代币 → 复制地址\n' +
    '• <a href="https://hyperevmscan.io">hyperevmscan.io</a> — 搜索代币 → 复制地址\n\n' +
    "请重试，或点击主页退出。",
} as const;

// ─── Confirmations + audit-grade warnings ──────────────────────────

export const CONFIRM_BUTTON = {
  English: "✅ Confirm",
  SimplifiedChinese: "✅ 确认",
} as const;
export const CANCEL_BUTTON = {
  English: "✖ Cancel",
  SimplifiedChinese: "✖ 取消",
} as const;
export const CONFIRM_WITHDRAW_BUTTON = {
  English: "✅ Confirm Withdraw",
  SimplifiedChinese: "✅ 确认提币",
} as const;
export const TRANSACTION_FAILED_REPLY = {
  English: "❌ Transaction failed — please try again in a moment.",
  SimplifiedChinese: "❌ 交易失败——请稍后重试。",
} as const;
export const WITHDRAW_AMOUNT_EXCEEDS_BALANCE_REPLY = {
  English: "⚠️ Amount exceeds available balance — withdraw will fail.",
  SimplifiedChinese: "⚠️ 金额超过可用余额——提币将失败。",
} as const;
export const WALLET_EXPORT_PRIVATE_KEY_WARNING_REPLY = {
  English:
    "⚠️ Private key — anyone with this controls the wallet. Do NOT share. This message auto-deletes in 30s; tap Delete now to remove it immediately.",
  SimplifiedChinese:
    "⚠️ 私钥——任何掌握私钥者均可控制此钱包。请勿分享。该消息将在 30 秒后自动删除；点击立即删除可立即清除。",
} as const;
export const REFERRAL_BURN_ADDRESS_WARNING_REPLY = {
  English: "⚠️ That address is a known burn / null address.",
  SimplifiedChinese: "⚠️ 该地址为已知的销毁地址 / 空地址。",
} as const;

// ─── Buy / sell post-stage error replies ───────────────────────────

export const NO_ACTIVE_WALLET_RUN_WALLET_REPLY = {
  English: "No active wallet — run /wallet to create or import one.",
  SimplifiedChinese: "暂无活动钱包——请发送 /wallet 创建或导入。",
} as const;
export const TRANSACTION_FAILED_SHORT_REPLY = {
  English: "Transaction failed — please try again in a moment.",
  SimplifiedChinese: "交易失败——请稍后重试。",
} as const;
export const TRADE_ALREADY_IN_FLIGHT_REPLY = {
  English:
    "Trade already in flight — wait a moment, then check the explorer or retry.",
  SimplifiedChinese:
    "已有交易正在执行中——请稍候，然后在区块浏览器中查看或重试。",
} as const;
export const TRADE_ROUTING_NOT_CONFIGURED_REPLY = {
  English: "Trade routing is not yet configured — try again in a moment.",
  SimplifiedChinese: "交易路由尚未配置——请稍后重试。",
} as const;
export const INSUFFICIENT_HYPE_FOR_GAS_REPLY = {
  English: "Insufficient HYPE for gas — top up the wallet and retry.",
  SimplifiedChinese: "HYPE 不足以支付矿工费——请向钱包充值后重试。",
} as const;
export const TOAST_CONFIRM_CLEARED = {
  English: "Canceled",
  SimplifiedChinese: "已取消",
} as const;
export const TOAST_CONFIRM_ALREADY_EXPIRED = {
  English: "Already expired",
  SimplifiedChinese: "已过期",
} as const;
export const CONFIRM_EXPIRED_REPLY = {
  English:
    "⏱ That trade confirmation has expired. Re-run /buy or /sell to try again.",
  SimplifiedChinese:
    "⏱ 该交易确认已过期。请重新发送 /buy 或 /sell 后再试。",
} as const;

// ─── Trade confirm receipt + tx-status copy ────────────────────────

export const TRADE_VERB_BUY = {
  English: "Buy",
  SimplifiedChinese: "买入",
} as const;
export const TRADE_VERB_SELL = {
  English: "Sell",
  SimplifiedChinese: "卖出",
} as const;
export const TRADE_RECEIVED_TOKENS = {
  English: (amount: string, ticker: string) =>
    `Received: ${amount} ${ticker}\n`,
  SimplifiedChinese: (amount: string, ticker: string) =>
    `已收到：${amount} ${ticker}\n`,
} as const;
export const TRADE_RECEIVED_USDC = {
  English: (amount: string) => `Received: $${amount} USDC\n`,
  SimplifiedChinese: (amount: string) => `已收到：$${amount} USDC\n`,
} as const;
export const TRADE_CONFIRMED_HEADER_HTML = {
  English: (verb: string, ticker: string) =>
    `✅ <b>${verb} confirmed for ${ticker}</b>`,
  SimplifiedChinese: (verb: string, ticker: string) =>
    `✅ <b>${ticker} ${verb}已确认</b>`,
} as const;
export const TRADE_TX_LABEL = {
  English: "Tx:",
  SimplifiedChinese: "交易：",
} as const;
export const TRADE_STATUS_BUYING = {
  English: (usdcLabel: string, ticker: string) =>
    `Buying ${usdcLabel} USDC of ${ticker}`,
  SimplifiedChinese: (usdcLabel: string, ticker: string) =>
    `正在买入价值 ${usdcLabel} USDC 的 ${ticker}`,
} as const;
export const TRADE_STATUS_SELLING = {
  English: (tokenAmount: string, ticker: string) =>
    `Selling ${tokenAmount} ${ticker}`,
  SimplifiedChinese: (tokenAmount: string, ticker: string) =>
    `正在卖出 ${tokenAmount} ${ticker}`,
} as const;
export const TX_SENDING_HEADER_HTML = {
  English: "⏳ <b>Tx sending</b>",
  SimplifiedChinese: "⏳ <b>交易发送中</b>",
} as const;
export const TX_PENDING_HEADER_HTML = {
  English: "⏳ <b>Tx pending</b>",
  SimplifiedChinese: "⏳ <b>交易处理中</b>",
} as const;
export const TX_PENDING_BODY = {
  English:
    "Still waiting for the network to confirm — this may take another moment.",
  SimplifiedChinese:
    "仍在等待网络确认——可能还需稍候片刻。",
} as const;

// ─── renderExecutionError variants ─────────────────────────────────

export const TX_PENDING_POLLING_REPLY = {
  English: (timeoutSec: number, explorerUrl: string) =>
    `Tx pending — receipt not seen within ${timeoutSec}s. ` +
    `Still polling in the background; this message updates once mined. ` +
    `Explorer: ${explorerUrl}`,
  SimplifiedChinese: (timeoutSec: number, explorerUrl: string) =>
    `交易处理中——${timeoutSec} 秒内未收到回执。` +
    `仍在后台轮询；交易被打包后本消息会自动更新。` +
    `区块浏览器：${explorerUrl}`,
} as const;
export const TX_PENDING_NO_POLLING_REPLY = {
  English: (explorerUrl: string) =>
    `Tx pending — receipt not seen yet, no longer polling. ` +
    `Check the explorer: ${explorerUrl}`,
  SimplifiedChinese: (explorerUrl: string) =>
    `交易处理中——尚未收到回执，已停止轮询。` +
    `请在区块浏览器中查看：${explorerUrl}`,
} as const;
export const TX_PENDING_NEUTRAL_REPLY = {
  English: (explorerUrl: string) =>
    `Tx pending — receipt not seen yet. ` +
    `Check the explorer: ${explorerUrl}`,
  SimplifiedChinese: (explorerUrl: string) =>
    `交易处理中——尚未收到回执。` +
    `请在区块浏览器中查看：${explorerUrl}`,
} as const;
export const TX_SUBMITTED_RECEIPT_MISSING_REPLY = {
  English: (explorerUrl: string) =>
    `Tx submitted but receipt not seen yet — check the explorer: ${explorerUrl}`,
  SimplifiedChinese: (explorerUrl: string) =>
    `交易已提交但尚未收到回执——请在区块浏览器中查看：${explorerUrl}`,
} as const;
export const RPC_UNAVAILABLE_REPLY = {
  English: "RPC unavailable — please try again in a moment.",
  SimplifiedChinese: "RPC 不可用——请稍后重试。",
} as const;
export const TRADING_NOT_YET_OPEN_REPLY = {
  English: (suffix: string) =>
    `Trading not yet open for this token — wait for the launch delay to clear.${suffix}`,
  SimplifiedChinese: (suffix: string) =>
    `该代币尚未开放交易——请等待发射延迟结束。${suffix}`,
} as const;
export const LT_BUFFER_LOW_REPLY = {
  English: (suffix: string) =>
    `BounceTech LT buffer low — try a smaller amount or retry in ~10s.${suffix}`,
  SimplifiedChinese: (suffix: string) =>
    `BounceTech LT 流动性缓冲不足——请尝试更小的金额或在约 10 秒后重试。${suffix}`,
} as const;
export const SLIPPAGE_EXCEEDED_REPLY = {
  English: (suffix: string) =>
    `Price moved past slippage — try again or raise slippage in /settings.${suffix}`,
  SimplifiedChinese: (suffix: string) =>
    `价格已超出滑点范围——请重试或在 /settings 中提高滑点。${suffix}`,
} as const;
export const BUYS_PAUSED_MINT_PAUSED_REPLY = {
  English: (suffix: string) =>
    `Buys paused for this token — BounceTech LT is temporarily mint-paused. Sells still work.${suffix}`,
  SimplifiedChinese: (suffix: string) =>
    `该代币的买入已暂停——BounceTech LT 暂时停止铸造。卖出仍可正常进行。${suffix}`,
} as const;
export const TX_REVERTED_ON_CHAIN_REPLY = {
  English: (reason: string, explorerUrl: string) =>
    `Transaction reverted on-chain${reason ? `: ${reason}` : ""}. See ${explorerUrl}.`,
  SimplifiedChinese: (reason: string, explorerUrl: string) =>
    `交易在链上回滚${reason ? `：${reason}` : ""}。详见 ${explorerUrl}。`,
} as const;
export const TX_FAILED_GENERIC_REPLY = {
  English: (reason: string) => `Transaction failed${reason ? `: ${reason}` : ""}.`,
  SimplifiedChinese: (reason: string) =>
    `交易失败${reason ? `：${reason}` : ""}。`,
} as const;
export const RPC_UNAVAILABLE_WITH_REASON_REPLY = {
  English: (reason: string) =>
    `RPC unavailable${reason ? `: ${reason}` : ""} — try again in a moment.`,
  SimplifiedChinese: (reason: string) =>
    `RPC 不可用${reason ? `：${reason}` : ""}——请稍后重试。`,
} as const;
export const TRANSACTION_REVERTED_WITH_REASON_REPLY = {
  English: (reason: string) =>
    `Transaction reverted${reason ? `: ${reason}` : ""}.`,
  SimplifiedChinese: (reason: string) =>
    `交易回滚${reason ? `：${reason}` : ""}。`,
} as const;
export const PIN_NO_PIN_ON_FILE_REPLY = {
  English: "No PIN on file — re-run /wallet to set one.",
  SimplifiedChinese: "未设置 PIN 码——请重新发送 /wallet 进行设置。",
} as const;
export const PIN_FLOW_CONFIRM_PROMPT = {
  English: "Confirm — send the same 6 digits again.",
  SimplifiedChinese: "请确认——再次发送相同的 6 位数字。",
} as const;
export const PENDING_TX_RECEIPT_NOT_SEEN_REPLY = {
  English: "Receipt not seen within 30 minutes.",
  SimplifiedChinese: "30 分钟内未收到回执。",
} as const;
export const TOKEN_LIFECYCLE_GRADUATING = {
  English: "Graduating 🔄",
  SimplifiedChinese: "毕业中 🔄",
} as const;
export const TOKEN_LIFECYCLE_BONDING_CURVE = {
  English: "Bonding Curve",
  SimplifiedChinese: "联合曲线",
} as const;
export const TOKEN_LIFECYCLE_GRADUATED = {
  English: "Graduated ✅",
  SimplifiedChinese: "已毕业 ✅",
} as const;
export const POSITIONS_REALISED_POS_HEADER = {
  English: "Realized Pos",
  SimplifiedChinese: "已实现仓位",
} as const;
export const POSITIONS_OPEN_POS_HEADER = {
  English: "Open Pos",
  SimplifiedChinese: "未平仓位",
} as const;
export const POSITIONS_OPEN_SECTION_HEADER = {
  English: (count: number): string => `Open positions (${count})`,
  SimplifiedChinese: (count: number): string => `未平仓位 (${count})`,
} as const;
export const POSITIONS_REALISED_SECTION_HEADER = {
  English: (count: number): string => `Realized positions (${count})`,
  SimplifiedChinese: (count: number): string => `已实现仓位 (${count})`,
} as const;
export const ANTI_PHISHING_STATIC_HEADER = {
  English: "This bot will never ask for your seed phrase or private key via DM.",
  SimplifiedChinese: "本机器人绝不会通过私聊向您索取助记词或私钥。",
} as const;
export const TOKEN_NOT_FOUND_SHORT_REPLY = {
  English: "Token not found — make sure the address is correct.",
  SimplifiedChinese: "未找到该代币——请确认地址正确。",
} as const;
export const PROCEEDS_UNAVAILABLE_REPLY = {
  English: "Unable to estimate proceeds right now — please try again in a moment.",
  SimplifiedChinese: "当前无法估算卖出所得——请稍后重试。",
} as const;

// ─── /start welcome surface ─────────────────────────────────────────

export const START_WALLET_ADDRESS_LABEL = {
  English: "Your wallet address:",
  SimplifiedChinese: "您的钱包地址：",
} as const;
export const START_ONCE_FUNDED_REFRESH_HINT = {
  English: "Once funded, tap Refresh and your balance will appear here.",
  SimplifiedChinese: "充值完成后，点击刷新即可在此查看余额。",
} as const;
export const START_COULD_NOT_CREATE_WALLET_REPLY = {
  English: "Could not create your wallet — please try /start again in a moment.",
  SimplifiedChinese: "无法创建钱包——请稍后再次发送 /start。",
} as const;
export const START_BALANCE_UNAVAILABLE_TOAST = {
  English: "Balance unavailable",
  SimplifiedChinese: "余额不可用",
} as const;
export const START_BALANCE_REFRESHED_TOAST = {
  English: "Balance refreshed",
  SimplifiedChinese: "余额已刷新",
} as const;
export const START_WELCOME_LEAD = {
  English: (botName: string) =>
    `Welcome to ${botName} — the bot for trading alt.fun tokens on HyperEVM.`,
  SimplifiedChinese: (botName: string) =>
    `欢迎使用 ${botName}——在 HyperEVM 上交易 alt.fun 代币的机器人。`,
} as const;
export const START_BALANCE_LABEL = {
  English: (usdc: string) => `Balance: ${usdc} USDC`,
  SimplifiedChinese: (usdc: string) => `余额：${usdc} USDC`,
} as const;
export const START_GAS_BALANCE_LABEL = {
  English: (hype: string) => `Gas balance: ${hype} HYPE`,
  SimplifiedChinese: (hype: string) => `矿工费余额：${hype} HYPE`,
} as const;
export const TAP_TO_COPY_HINT = {
  English: "(Tap to copy)",
  SimplifiedChinese: "（点击复制）",
} as const;

// ─── /settings panel labels + wizard prompts ───────────────────────

export const SETTINGS_BUY_SELL_HINT_REPLY = {
  English: "Tap Buy Settings or Sell Settings to customize the preset buttons.",
  SimplifiedChinese: "点击买入设置或卖出设置可自定义预设按钮。",
} as const;
export const SETTINGS_BUY_SUBMENU_TITLE = {
  English: ["Buy Settings", "", "Tap a slot to change its amount."].join("\n"),
  SimplifiedChinese: ["买入设置", "", "点击任一槽位即可修改其金额。"].join("\n"),
} as const;
export const SETTINGS_SELL_SUBMENU_TITLE = {
  English: ["Sell Settings", "", "Tap a slot to change its percent."].join("\n"),
  SimplifiedChinese: ["卖出设置", "", "点击任一槽位即可修改其百分比。"].join("\n"),
} as const;
export const SETTINGS_INVALID_NUMBER_REPLY = {
  English: "Send a positive number like `2` or `0.5`.",
  SimplifiedChinese: "请发送正数，如 `2` 或 `0.5`。",
} as const;
export const SETTINGS_SLIPPAGE_MIN_REPLY = {
  English: "Slippage must be at least 0.01%. Send again.",
  SimplifiedChinese: "滑点至少为 0.01%。请重新发送。",
} as const;
export const SETTINGS_INVALID_USDC_REPLY = {
  English: "Send a positive USDC amount like `50`.",
  SimplifiedChinese: "请发送正的 USDC 金额，如 `50`。",
} as const;
export const SETTINGS_SELL_SLOT_PROMPT = {
  English: [
    "Change the value of the sell percent button.",
    "Send a percent between 1 and 100.",
    "",
    "Tap Home to exit and keep the current value.",
  ].join("\n"),
  SimplifiedChinese: [
    "修改卖出百分比按钮的数值。",
    "请发送 1 至 100 之间的百分比。",
    "",
    "点击主页退出并保留当前值。",
  ].join("\n"),
} as const;
export const SETTINGS_SELL_SLOT_INVALID_REPLY = {
  English: "Send a number between 1 and 100.",
  SimplifiedChinese: "请发送 1 至 100 之间的数字。",
} as const;
export const SETTINGS_SELL_SLOT_RANGE_REPLY = {
  English: "Percent must be between 1 and 100. Send again.",
  SimplifiedChinese: "百分比必须在 1 至 100 之间。请重新发送。",
} as const;
export const SETTINGS_ANTI_PHISHING_PROMPT = {
  English:
    "Send your anti-phishing phrase — it will appear at the top of every bot message so you can recognize messages from this bot vs. a copycat.",
  SimplifiedChinese:
    "请发送您的反钓鱼短语——它将出现在机器人每条消息的开头，便于您区分本机器人与仿冒账号。",
} as const;
export const SETTINGS_PHRASE_EMPTY_REPLY = {
  English: "Phrase cannot be empty. Send again.",
  SimplifiedChinese: "短语不能为空。请重新发送。",
} as const;
export const TOAST_DEGEN_MODE_ENABLED = {
  English: "Degen mode enabled.",
  SimplifiedChinese: "极速交易模式已启用。",
} as const;
export const TOAST_DEGEN_MODE_DISABLED = {
  English: "Degen mode disabled.",
  SimplifiedChinese: "极速交易模式已停用。",
} as const;

// ─── /sell custom percent prompt + retry ───────────────────────────

export const SELL_CUSTOM_PERCENT_PROMPT = {
  English:
    "Enter a percent of your position to sell (1–100):\n\nTap Home to exit.",
  SimplifiedChinese:
    "请输入要卖出的仓位百分比（1–100）：\n\n点击主页退出。",
} as const;
export const SELL_CUSTOM_PERCENT_INVALID_REPLY = {
  English: "Please enter a whole number between 1 and 100 (e.g. 35).",
  SimplifiedChinese: "请输入 1 至 100 之间的整数（例如 35）。",
} as const;
export const SELL_UNABLE_TO_VERIFY_TOKEN_BALANCE_REPLY = {
  English: "Unable to verify your token balance — please try again.",
  SimplifiedChinese: "无法验证您的代币余额——请重试。",
} as const;

// ─── Slash command descriptions (Telegram BotCommand list) ─────────

export const BOT_COMMAND_START_DESCRIPTION = {
  English: "Open the main menu and create or import a wallet",
  SimplifiedChinese: "打开主菜单并创建或导入钱包",
} as const;
export const BOT_COMMAND_HELP_DESCRIPTION = {
  English: "Command list and security guidance",
  SimplifiedChinese: "命令列表与安全提示",
} as const;
export const BOT_COMMAND_BUY_DESCRIPTION = {
  English: "Buy a token by contract address",
  SimplifiedChinese: "通过合约地址买入代币",
} as const;
export const BOT_COMMAND_SELL_DESCRIPTION = {
  English: "Sell a token from your positions",
  SimplifiedChinese: "从持仓中卖出代币",
} as const;
export const BOT_COMMAND_POSITIONS_DESCRIPTION = {
  English: "Show open and realized positions",
  SimplifiedChinese: "查看未平仓与已实现仓位",
} as const;
export const BOT_COMMAND_TRACK_DESCRIPTION = {
  English: "Show a token info card and recent trades",
  SimplifiedChinese: "查看代币信息卡片与最近交易",
} as const;
export const BOT_COMMAND_WALLET_DESCRIPTION = {
  English: "Wallets, PIN, withdrawal lock",
  SimplifiedChinese: "钱包、PIN 码、提币锁",
} as const;
export const BOT_COMMAND_WITHDRAW_DESCRIPTION = {
  English: "Withdraw HYPE or USDC to an external wallet",
  SimplifiedChinese: "将 HYPE 或 USDC 提币到外部钱包",
} as const;
export const BOT_COMMAND_SETTINGS_DESCRIPTION = {
  English: "Slippage, default buy amount, anti-phishing phrase, degen mode",
  SimplifiedChinese: "滑点、默认买入金额、反钓鱼短语、极速交易模式",
} as const;
export const BOT_COMMAND_REFERRAL_DESCRIPTION = {
  English: "Your referral link and earned rewards",
  SimplifiedChinese: "您的推荐链接与已获得的奖励",
} as const;

// ─── /withdraw wizard ───────────────────────────────────────────────

export const WITHDRAW_WHICH_ASSET_PROMPT = {
  English: "Which asset?",
  SimplifiedChinese: "选择资产？",
} as const;
export const WITHDRAW_SUMMARY_HEADER = {
  English: "Withdraw summary",
  SimplifiedChinese: "提币摘要",
} as const;
export const WITHDRAW_TAP_CONFIRM_HINT = {
  English: "Tap Confirm Withdraw within 60s to submit.",
  SimplifiedChinese: "请在 60 秒内点击确认提币以提交。",
} as const;
export const WITHDRAW_INSUFFICIENT_BALANCE_REPLY = {
  English: "Insufficient balance for the requested amount + gas.",
  SimplifiedChinese: "余额不足以支付提币金额 + 矿工费。",
} as const;
export const WITHDRAW_PIN_PROMPT = {
  English: "Send your 6-digit PIN to authorize the withdraw.",
  SimplifiedChinese: "请发送 6 位 PIN 码以授权提币。",
} as const;
export const WITHDRAW_INVALID_AMOUNT_REPLY = {
  English:
    "Invalid amount — must be a positive decimal within the asset's precision. Send again.",
  SimplifiedChinese:
    "金额无效——必须是符合该资产精度的正数。请重新发送。",
} as const;
export const WITHDRAW_DESTINATION_PROMPT = {
  English: "Destination address? Send a 0x-prefixed EVM address.",
  SimplifiedChinese: "目标地址？请发送以 0x 开头的 EVM 地址。",
} as const;
export const WITHDRAW_INVALID_DESTINATION_REPLY = {
  English:
    "Invalid address — must be 0x followed by 40 hex characters. Send again.",
  SimplifiedChinese:
    "地址无效——必须是 0x 加 40 位十六进制字符。请重新发送。",
} as const;

// ─── /wallet wizards ────────────────────────────────────────────────

export const WALLET_NO_WALLETS_YET_REPLY = {
  English: "No wallets yet.",
  SimplifiedChinese: "尚未创建任何钱包。",
} as const;
export const WALLET_RENAME_PROMPT = {
  English: "Send the new label for this wallet (max 32 chars).",
  SimplifiedChinese: "请发送此钱包的新名称（最多 32 个字符）。",
} as const;
export const WALLET_RENAME_NO_LONGER_EXISTS_REPLY = {
  English: "Wallet no longer exists. Rename canceled.",
  SimplifiedChinese: "钱包已不存在。已取消重新命名。",
} as const;
export const WALLET_EXPORT_NO_LONGER_EXISTS_REPLY = {
  English: "Wallet no longer exists. Export aborted.",
  SimplifiedChinese: "钱包已不存在。已中止导出。",
} as const;
export const WALLET_DELETE_NO_LONGER_EXISTS_REPLY = {
  English: "Wallet no longer exists. Delete aborted.",
  SimplifiedChinese: "钱包已不存在。已中止删除。",
} as const;
export const WALLET_SET_PIN_PROMPT = {
  English:
    "No PIN set yet. Send a new 6-digit PIN (digits only) to protect wallet exports, withdrawals, and deletions.",
  SimplifiedChinese:
    "尚未设置 PIN 码。请发送 6 位新 PIN 码（仅限数字）以保护钱包导出、提币与删除操作。",
} as const;
export const WALLET_CONFIRM_PIN_PROMPT = {
  English: "Confirm — send the same 6 digits again.",
  SimplifiedChinese: "请确认——再次发送相同的 6 位数字。",
} as const;
export const WALLET_IMPORT_PASTE_KEY_PROMPT = {
  English: [
    "Paste the private key for the wallet you want to import (0x-prefixed, 64 hex chars).",
    "",
    "Your message is deleted from this chat the instant the bot reads it. The bot never stores the plaintext key — only an encrypted copy.",
    "",
    "Tap Home to exit.",
  ].join("\n\n"),
  SimplifiedChinese: [
    "请粘贴要导入钱包的私钥（以 0x 开头，64 位十六进制字符）。",
    "",
    "机器人读取后将立即从聊天中删除您的消息。本机器人绝不存储明文私钥——仅保留加密副本。",
    "",
    "点击主页退出。",
  ].join("\n\n"),
} as const;
export const WALLET_IMPORT_INVALID_KEY_REPLY = {
  English:
    "That doesn't look like a private key — expected 0x followed by 64 hex characters. Paste it again.",
  SimplifiedChinese:
    "这看起来不是私钥——应为 0x 加 64 位十六进制字符。请重新粘贴。",
} as const;
export const WALLET_IMPORT_PRIVATE_KEY_INVALID_REPLY = {
  English: "That private key is invalid. Paste it again.",
  SimplifiedChinese: "该私钥无效。请重新粘贴。",
} as const;
export const WALLET_IMPORT_ALREADY_EXISTS_REPLY = {
  English: "That wallet is already in your list. Import canceled.",
  SimplifiedChinese: "该钱包已在您的列表中。已取消导入。",
} as const;
export const WALLET_CHANGE_PIN_PROMPT = {
  English: "Send the new 6-digit PIN (digits only).",
  SimplifiedChinese: "请发送新的 6 位 PIN 码（仅限数字）。",
} as const;
export const WALLET_RESET_PIN_PROMPT = {
  English: "Send your new 6-digit PIN (digits only).",
  SimplifiedChinese: "请发送新的 6 位 PIN 码（仅限数字）。",
} as const;
export const WALLET_SET_NEW_PIN_PROMPT = {
  English:
    "Send a new 6-digit PIN (digits only) to protect wallet exports, withdrawals, and deletions.",
  SimplifiedChinese:
    "请发送新的 6 位 PIN 码（仅限数字）以保护钱包导出、提币与删除操作。",
} as const;
export const WALLET_PICK_ACTIVE_PROMPT = {
  English: "Pick the wallet to use as active:",
  SimplifiedChinese: "选择要设为活动的钱包：",
} as const;

// ─── /referral wizards ──────────────────────────────────────────────

export const REFERRAL_UPDATE_REWARDS_WALLET_HINT = {
  English: "Update your rewards wallet to fix future payments.",
  SimplifiedChinese: "请更新您的奖励钱包，以修复后续支付。",
} as const;
export const REFERRAL_CHECK_REWARDS_WALLET_HINT = {
  English: "Check that your rewards wallet is set so this doesn't happen again.",
  SimplifiedChinese: "请确认已设置奖励钱包，以避免再次发生此问题。",
} as const;
export const REFERRAL_SHARE_LINK_LEAD = {
  English: "Share your link to earn a cut of every trade your referees make.",
  SimplifiedChinese: "分享您的链接，即可从被推荐人的每笔交易中获得分成。",
} as const;
export const REFERRAL_LINK_LABEL = {
  English: "Your referral link:",
  SimplifiedChinese: "您的推荐链接：",
} as const;
export const REFERRAL_REWARDS_WALLET_LABEL = {
  English: "Your rewards wallet:",
  SimplifiedChinese: "您的奖励钱包：",
} as const;
export const REFERRAL_PAST_REFEREES_WARNING = {
  English:
    "Past referees keep paying the previously-set address forever, by on-chain attribution. To redirect future earnings from existing referees, you must control the previously-set address.",
  SimplifiedChinese:
    "根据链上归属规则，历史被推荐人将永远向先前设置的地址支付。如需让现有被推荐人的未来收益指向新地址，您必须掌控原先设置的地址。",
} as const;
export const REFERRAL_PICK_OR_CUSTOM_HINT = {
  English:
    "Pick one of your bot wallets below, or tap <b>Custom</b> to enter a different HyperEVM address.",
  SimplifiedChinese:
    "请在下方选择一个机器人钱包，或点击 <b>自定义</b> 输入其他 HyperEVM 地址。",
} as const;
export const REFERRAL_LONG_LIVED_HINT = {
  English:
    "Set the new wallet to a long-lived address you control (hardware wallet or main custodial wallet) — avoid exchange deposit addresses or rotating addresses.",
  SimplifiedChinese:
    "请将新钱包设置为您可长期控制的地址（硬件钱包或主托管钱包）——避免交易所充值地址或轮换地址。",
} as const;
export const REFERRAL_SEND_NEW_ADDRESS_PROMPT = {
  English: "Send the new rewards wallet address (0x-prefixed, 40 hex chars).",
  SimplifiedChinese: "请发送新的奖励钱包地址（以 0x 开头，40 位十六进制字符）。",
} as const;
export const REFERRAL_SET_PIN_PROMPT = {
  English:
    "No PIN set yet. Send a new 6-digit PIN (digits only) to protect rewards-wallet changes.",
  SimplifiedChinese:
    "尚未设置 PIN 码。请发送新的 6 位 PIN 码（仅限数字）以保护奖励钱包修改。",
} as const;
export const REFERRAL_PIN_CONFIRM_PROMPT = {
  English: "Confirm — send the same 6 digits again.",
  SimplifiedChinese: "请确认——再次发送相同的 6 位数字。",
} as const;
export const REFERRAL_VERIFY_PIN_PROMPT = {
  English: "Send your 6-digit PIN to authorize the rewards-wallet change.",
  SimplifiedChinese: "请发送 6 位 PIN 码以授权奖励钱包修改。",
} as const;
export const PIN_INVALID_FORMAT_REPLY = {
  English: "PIN must be exactly 6 digits. Send again.",
  SimplifiedChinese: "PIN 码必须恰好为 6 位数字。请重新发送。",
} as const;
export const PIN_DO_NOT_MATCH_REPLY = {
  English: "PINs do not match. Send the confirmation PIN again.",
  SimplifiedChinese: "PIN 码不一致。请重新发送确认 PIN 码。",
} as const;
export const PIN_STATE_LOST_REPLY = {
  English: (retryHint: string) => `PIN state lost — re-run ${retryHint}.`,
  SimplifiedChinese: (retryHint: string) =>
    `PIN 状态已丢失——请重新执行 ${retryHint}。`,
} as const;
export const REFERRAL_INVALID_ADDRESS_REPLY = {
  English:
    "Not a valid HyperEVM address. Send a 0x-prefixed 40-char hex address.",
  SimplifiedChinese:
    "不是有效的 HyperEVM 地址。请发送以 0x 开头的 40 位十六进制地址。",
} as const;
export const REFERRAL_BURN_PAYMENT_LOST_WARNING = {
  English:
    "Every USDC payment sent here is permanently unrecoverable — every future referral cut would be lost forever.",
  SimplifiedChinese:
    "向此地址支付的每一笔 USDC 都将永久不可恢复——未来的所有推荐分成都将永久丢失。",
} as const;
export const REFERRAL_BURN_CONFIRM_PROMPT = {
  English:
    "Send 'confirm' to proceed anyway, tap Home to exit, or send a different address.",
  SimplifiedChinese:
    "发送 'confirm' 继续操作，点击主页退出，或发送其他地址。",
} as const;
export const REFERRAL_ABORTED_RETRY_PROMPT = {
  English:
    "Aborted. Send 'confirm' or a new 0x-prefixed address, or tap Home to exit.",
  SimplifiedChinese:
    "已中止。请发送 'confirm' 或新的以 0x 开头的地址，或点击主页退出。",
} as const;
export const REFERRAL_STILL_BURN_RETRY_PROMPT = {
  English:
    "That's still a known burn address. Send 'confirm' to proceed, tap Home to exit, or a different address.",
  SimplifiedChinese:
    "该地址仍为已知销毁地址。发送 'confirm' 继续，点击主页退出，或输入其他地址。",
} as const;
export const REFERRAL_COULD_NOT_UPDATE_REPLY = {
  English: "Could not update rewards wallet. Try again later.",
  SimplifiedChinese: "无法更新奖励钱包。请稍后重试。",
} as const;
export const REFERRAL_WALLET_NO_LONGER_AVAILABLE_REPLY = {
  English:
    "That wallet is no longer available. Re-run /referral → Change rewards wallet.",
  SimplifiedChinese:
    "该钱包已不可用。请重新发送 /referral → 修改奖励钱包。",
} as const;
export const REFERRAL_HEADER_REWARDS_REJECTING = {
  English: "<b>⚠️ Rewards wallet rejecting USDC transfers</b>",
  SimplifiedChinese: "<b>⚠️ 奖励钱包拒收 USDC 转账</b>",
} as const;
export const REFERRAL_HEADER_ATTRIBUTION_DROPPED = {
  English: "<b>⚠️ Attribution dropped for some referees</b>",
  SimplifiedChinese: "<b>⚠️ 部分被推荐人的归属丢失</b>",
} as const;
export const REFERRAL_HEADER_YOUR_REFERRAL = {
  English: "<b>Your referral</b>",
  SimplifiedChinese: "<b>您的推荐</b>",
} as const;
export const REFERRAL_HEADER_CHANGE_REWARDS_WALLET = {
  English: "<b>Change rewards wallet</b>",
  SimplifiedChinese: "<b>修改奖励钱包</b>",
} as const;
export const REFERRAL_HEADER_CHANGE_DOES_NOT_REDIRECT = {
  English:
    "<b>Changing your rewards wallet does NOT redirect already-attributed referees.</b>",
  SimplifiedChinese:
    "<b>修改奖励钱包不会重新分配已归属的被推荐人。</b>",
} as const;

// ─── /wallet — extracted toasts & prompts ──────────────────────────

export const WALLET_RENAME_LENGTH_INVALID_REPLY = {
  English: (max: number) =>
    `Label must be 1–${max} characters. Rename canceled.`,
  SimplifiedChinese: (max: number) =>
    `名称长度必须为 1–${max} 个字符。已取消重新命名。`,
} as const;
export const WALLET_DELETE_CONFIRM_PROMPT = {
  English: (label: string, address: string) =>
    `Final step — this permanently removes ${label} (${address}) from KV. Encrypted key cannot be recovered. Type DELETE to confirm or tap Home to exit.`,
  SimplifiedChinese: (label: string, address: string) =>
    `最后一步——此操作将从 KV 中永久删除 ${label}（${address}）。加密私钥无法恢复。请输入 DELETE 确认，或点击主页退出。`,
} as const;
export const WALLET_PIN_SET_HEADER = {
  English: "PIN set.",
  SimplifiedChinese: "PIN 码已设置。",
} as const;
export const WALLET_PIN_CHANGED_HEADER = {
  English: "PIN changed.",
  SimplifiedChinese: "PIN 码已修改。",
} as const;
export const WALLET_RESET_NOT_READY_WITH_CANCEL_HINT_REPLY = {
  English: (hours: string) =>
    `Reset not yet available — ~${hours} remaining. Tap [Cancel PIN reset] if you didn't request this.`,
  SimplifiedChinese: (hours: string) =>
    `重置尚未就绪——还需约 ${hours}。若非您本人申请，请点击 [取消 PIN 重置]。`,
} as const;
export const WALLET_RESET_NOT_READY_REPLY = {
  English: (hours: string) => `Reset not yet available — ~${hours} remaining.`,
  SimplifiedChinese: (hours: string) => `重置尚未就绪——还需约 ${hours}。`,
} as const;
export const TOAST_WALLET_CREATED = {
  English: (address: string) => `Created ${address}`,
  SimplifiedChinese: (address: string) => `已创建 ${address}`,
} as const;
export const TOAST_WALLET_CAP_REACHED = {
  English: (max: number) =>
    `Wallet cap reached (${max}). Delete one first.`,
  SimplifiedChinese: (max: number) =>
    `已达到钱包数量上限（${max}）。请先删除一个。`,
} as const;
export const TOAST_WALLET_SWITCHED_TO = {
  English: (label: string) => `Switched to ${label}`,
  SimplifiedChinese: (label: string) => `已切换到 ${label}`,
} as const;
export const TOAST_WALLET_SWITCHED = {
  English: "Switched.",
  SimplifiedChinese: "已切换。",
} as const;
export const TOAST_PIN_RESET_REQUESTED = {
  English: (hours: string) =>
    `PIN reset requested. Complete in ~${hours}. The old PIN still works during the cooldown.`,
  SimplifiedChinese: (hours: string) =>
    `已申请 PIN 重置。将在约 ${hours} 后完成。冷却期内旧 PIN 码仍可使用。`,
} as const;
export const TOAST_LOCK_DISABLE_REQUESTED = {
  English: (hours: string) =>
    `Disable requested — completes in ~${hours}. Tap the lock button again to revoke.`,
  SimplifiedChinese: (hours: string) =>
    `已申请停用——将在约 ${hours} 后完成。再次点击锁按钮可撤销。`,
} as const;

// ─── PIN flow (shared by /wallet, /referral, /security) ────────────

export const PIN_VERIFY_PROMPT = {
  English: (actionLabel: string) =>
    `Send your current 6-digit PIN to authorize ${actionLabel}.`,
  SimplifiedChinese: (actionLabel: string) =>
    `请发送当前的 6 位 PIN 码以授权${actionLabel}。`,
} as const;
export const REFERRAL_CHANGE_REWARDS_WALLET_ACTION_LABEL = {
  English: "Rewards-wallet change",
  SimplifiedChinese: "奖励钱包修改",
} as const;
export const REFERRAL_CHANGE_REWARDS_WALLET_RETRY_HINT = {
  English: "/referral → Change rewards wallet",
  SimplifiedChinese: "/referral → 修改奖励钱包",
} as const;
export const PIN_AUTHORISE_THE_PROMPT = {
  English: (actionLabel: string) =>
    `Send your 6-digit PIN to authorize the ${actionLabel}.`,
  SimplifiedChinese: (actionLabel: string) =>
    `请发送 6 位 PIN 码以授权${actionLabel}。`,
} as const;
export const WALLET_PIN_RESET_COMPLETE_HEADER = {
  English: "PIN reset complete.",
  SimplifiedChinese: "PIN 重置已完成。",
} as const;
export const PIN_LOCKED_REPLY = {
  English: (mins: number, actionLabel: string) =>
    `Too many wrong PIN attempts — locked for ~${mins} min. ${actionLabel} canceled.`,
  SimplifiedChinese: (mins: number, actionLabel: string) =>
    `PIN 码错误次数过多——已锁定约 ${mins} 分钟。已取消${actionLabel}。`,
} as const;
export const PIN_WRONG_RETRY_REPLY = {
  English: (attemptsRemaining: number) =>
    `Wrong PIN. ${attemptsRemaining} attempts remaining. Try again.`,
  SimplifiedChinese: (attemptsRemaining: number) =>
    `PIN 码错误。剩余 ${attemptsRemaining} 次尝试机会。请重试。`,
} as const;

// ─── /buy — extracted toasts ───────────────────────────────────────

export const BUY_INSUFFICIENT_USDC_REPLY = {
  English: (totalNeeded: number, usdcAvailable: number) =>
    `Insufficient USDC: need $${totalNeeded.toFixed(2)}, have $${usdcAvailable.toFixed(2)}.`,
  SimplifiedChinese: (totalNeeded: number, usdcAvailable: number) =>
    `USDC 不足：需要 $${totalNeeded.toFixed(2)}，现有 $${usdcAvailable.toFixed(2)}。`,
} as const;

// ─── /track — extracted trade-list copy ────────────────────────────

export const TRACK_RECENT_TRADES_HEADER_HTML = {
  English: "<b>Recent trades</b>",
  SimplifiedChinese: "<b>最近交易</b>",
} as const;
export const TRACK_NO_TRADES_YET_HTML = {
  English: "<i>No trades yet.</i>",
  SimplifiedChinese: "<i>暂无交易。</i>",
} as const;
interface RelativeTimeFormatter {
  readonly justNow: string;
  readonly seconds: (n: number) => string;
  readonly minutes: (n: number) => string;
  readonly hours: (n: number) => string;
  readonly days: (n: number) => string;
}

export const TRACK_RELATIVE_TIME: Localised<RelativeTimeFormatter> = {
  English: {
    justNow: "just now",
    seconds: (n: number) => `${n}s ago`,
    minutes: (n: number) => `${n}m ago`,
    hours: (n: number) => `${n}h ago`,
    days: (n: number) => `${n}d ago`,
  },
  SimplifiedChinese: {
    justNow: "刚刚",
    seconds: (n: number) => `${n} 秒前`,
    minutes: (n: number) => `${n} 分钟前`,
    hours: (n: number) => `${n} 小时前`,
    days: (n: number) => `${n} 天前`,
  },
};

// ─── Token card (shared by /buy, /sell, /track) ────────────────────

export const TOKEN_CARD_MARKET_CAP_HTML = {
  English: (mcap: string) => `💰 <b>Market Cap:</b> ${mcap}`,
  SimplifiedChinese: (mcap: string) => `💰 <b>市值：</b> ${mcap}`,
} as const;
export const TOKEN_CARD_PRICE_HTML = {
  English: (price: string) => `💵 <b>Price:</b> ${price}`,
  SimplifiedChinese: (price: string) => `💵 <b>价格：</b> ${price}`,
} as const;
export const TOKEN_CARD_CHANGE_24H_HTML = {
  English: (pct: string) => `📊 <b>24h Change:</b> ${pct}`,
  SimplifiedChinese: (pct: string) => `📊 <b>24 小时涨跌：</b> ${pct}`,
} as const;
export const TOKEN_CARD_VOLUME_24H_HTML = {
  English: (volume: string) => `📈 <b>24h Volume:</b> ${volume}`,
  SimplifiedChinese: (volume: string) => `📈 <b>24 小时成交量：</b> ${volume}`,
} as const;
export const TOKEN_CARD_CURVE_FILLED_HTML = {
  English: (pct: string) => `🔥 <b>Curve Filled:</b> ${pct}`,
  SimplifiedChinese: (pct: string) => `🔥 <b>曲线已填充：</b> ${pct}`,
} as const;
export const TOKEN_CARD_VIEW_ON_EXPLORER_HTML = {
  English: (url: string) => `🔍 <a href="${url}">View on Explorer</a>`,
  SimplifiedChinese: (url: string) => `🔍 <a href="${url}">在区块浏览器中查看</a>`,
} as const;
export const TOKEN_CARD_VIEW_ON_ALT_FUN_HTML = {
  English: (url: string) => `🚀 <a href="${url}">View on Alt Fun</a>`,
  SimplifiedChinese: (url: string) => `🚀 <a href="${url}">在 Alt Fun 上查看</a>`,
} as const;
export const TOKEN_CARD_YOUR_USDC_BALANCE_HTML = {
  English: (formattedUsdc: string) =>
    `💼 <b>Your USDC Balance:</b> ${formattedUsdc}`,
  SimplifiedChinese: (formattedUsdc: string) =>
    `💼 <b>您的 USDC 余额：</b> ${formattedUsdc}`,
} as const;
export const TOKEN_CARD_BALANCE_UNAVAILABLE = {
  English: "— (balance unavailable)",
  SimplifiedChinese: "—（余额不可用）",
} as const;
export const TOKEN_CARD_YOUR_BALANCE_HTML = {
  English: (holdingText: string) => `💼 <b>Your Balance:</b> ${holdingText}`,
  SimplifiedChinese: (holdingText: string) =>
    `💼 <b>您的余额：</b> ${holdingText}`,
} as const;

// ─── /referral — extracted stat labels ─────────────────────────────

export const REFERRAL_REFERRED_USERS_LABEL = {
  English: (count: number) => `Referred users: ${count}`,
  SimplifiedChinese: (count: number) => `已推荐用户数：${count}`,
} as const;
export const REFERRAL_LIFETIME_EARNED_LABEL = {
  English: (earnedUsdc: string) => `Lifetime earned: $${earnedUsdc} USDC`,
  SimplifiedChinese: (earnedUsdc: string) =>
    `累计收益：$${earnedUsdc} USDC`,
} as const;

// ─── /sell — extracted toasts ──────────────────────────────────────

export const SELL_NO_BALANCE_REPLY = {
  English: (ticker: string) => `You hold no ${ticker}.`,
  SimplifiedChinese: (ticker: string) => `您未持有 ${ticker}。`,
} as const;
export const SELL_PERCENT_ROUNDS_TO_ZERO_REPLY = {
  English: (percent: number, ticker: string) =>
    `${percent}% of your ${ticker} balance rounds to zero.`,
  SimplifiedChinese: (percent: number, ticker: string) =>
    `您 ${ticker} 余额的 ${percent}% 取整后为零。`,
} as const;
export const SELL_PERCENT_ROUNDS_TO_ZERO_TRY_LARGER_REPLY = {
  English: (percent: number, ticker: string) =>
    `${percent}% of your ${ticker} balance rounds to zero — try a larger percent.`,
  SimplifiedChinese: (percent: number, ticker: string) =>
    `您 ${ticker} 余额的 ${percent}% 取整后为零——请尝试更大的百分比。`,
} as const;
export const SELL_PROCEEDS_BELOW_MIN_TRY_LARGER_REPLY = {
  English: (proceedsUsd: number, minUsdc: number) =>
    `Estimated proceeds ≈$${proceedsUsd.toFixed(2)} would be below the $${minUsdc} minimum. Increase the percent or tap Home to exit.`,
  SimplifiedChinese: (proceedsUsd: number, minUsdc: number) =>
    `预估所得约 $${proceedsUsd.toFixed(2)}，低于 $${minUsdc} 的最低限额。请提高百分比或点击主页退出。`,
} as const;
export const SELL_PROCEEDS_BELOW_MIN_REPLY = {
  English: (proceedsUsd: number, minUsdc: number) =>
    `Estimated proceeds ≈$${proceedsUsd.toFixed(2)} would be below the $${minUsdc} minimum.`,
  SimplifiedChinese: (proceedsUsd: number, minUsdc: number) =>
    `预估所得约 $${proceedsUsd.toFixed(2)}，低于 $${minUsdc} 的最低限额。`,
} as const;
export const SELL_LT_BUFFER_TOO_LOW_REPLY = {
  English: (maxProceedsUsd: number, minUsdc: number) =>
    `LT buffer too low — max sell ≈$${maxProceedsUsd.toFixed(2)} < $${minUsdc} min. Retry in ~10s.`,
  SimplifiedChinese: (maxProceedsUsd: number, minUsdc: number) =>
    `LT 流动性缓冲不足——最大卖出约 $${maxProceedsUsd.toFixed(2)}，低于 $${minUsdc} 最低限额。请约 10 秒后重试。`,
} as const;

// ─── /settings — extracted toasts ──────────────────────────────────

export const SETTINGS_SLIPPAGE_SET_REPLY = {
  English: (label: string) => `Slippage set to ${label}.`,
  SimplifiedChinese: (label: string) => `滑点已设置为 ${label}。`,
} as const;
export const SETTINGS_EXECUTION_SPEED_SET_REPLY = {
  English: (label: string) => `Execution speed set to ${label}.`,
  SimplifiedChinese: (label: string) => `执行速度已设置为 ${label}。`,
} as const;

// ─── /sell — buffer-low banner ─────────────────────────────────────

export const SELL_BUFFER_BELOW_MIN_HTML = {
  English: (maxUsd: number, minUsdc: number) =>
    `❌ <b>LT buffer too low to sell.</b>\n\n` +
    `Max sell right now is ≈$${maxUsd.toFixed(2)}, which is below the $${minUsdc} minimum. ` +
    `BounceTech replenishes the buffer in ~10s — try again shortly.`,
  SimplifiedChinese: (maxUsd: number, minUsdc: number) =>
    `❌ <b>LT 流动性缓冲不足，无法卖出。</b>\n\n` +
    `当前最大卖出约 $${maxUsd.toFixed(2)}，低于 $${minUsdc} 最低限额。` +
    `BounceTech 会在约 10 秒内补充流动性缓冲——请稍后重试。`,
} as const;

// ─── /buy — custom-amount wizard copy ──────────────────────────────

export const BUY_CUSTOM_AMOUNT_PROMPT = {
  English: (minUsdc: number) =>
    `Enter the USDC amount to buy (minimum $${minUsdc}):\n\nTap Home to exit.`,
  SimplifiedChinese: (minUsdc: number) =>
    `请输入要买入的 USDC 金额（最低 $${minUsdc}）：\n\n点击主页退出。`,
} as const;
export const BUY_INVALID_NUMBER_RETRY_REPLY = {
  English: (minUsdc: number) =>
    `Please enter a valid number (e.g. 50). Minimum is $${minUsdc}.`,
  SimplifiedChinese: (minUsdc: number) =>
    `请输入有效数字（例如 50）。最低为 $${minUsdc}。`,
} as const;
export const BUY_MINIMUM_BUY_RETRY_REPLY = {
  English: (minUsdc: number) =>
    `Minimum buy is $${minUsdc} USDC. Enter a larger amount.`,
  SimplifiedChinese: (minUsdc: number) =>
    `最低买入金额为 $${minUsdc} USDC。请输入更大的金额。`,
} as const;
export const BUY_UNABLE_VERIFY_USDC_BALANCE_REPLY = {
  English: "Unable to verify your USDC balance — please try again.",
  SimplifiedChinese: "无法核实您的 USDC 余额——请重试。",
} as const;
export const BUY_INSUFFICIENT_USDC_RETRY_REPLY = {
  English: (totalNeeded: number, formattedUsdc: string) =>
    `Insufficient USDC balance.\n` +
    `You need $${totalNeeded.toFixed(2)} (amount + fees) but have ${formattedUsdc}.\n\n` +
    `Enter a smaller amount, or tap Home to exit.`,
  SimplifiedChinese: (totalNeeded: number, formattedUsdc: string) =>
    `USDC 余额不足。\n` +
    `您需要 $${totalNeeded.toFixed(2)}（金额 + 手续费），现有 ${formattedUsdc}。\n\n` +
    `请输入更小的金额，或点击主页退出。`,
} as const;
export const BUY_STAGING_HTML = {
  English: (
    amount: number,
    tickerSafe: string,
    tokenSafe: string,
    trackingUrl: string,
  ) =>
    `✅ <b>Ready to buy $${amount.toFixed(2)} USDC of ${tickerSafe}</b>\n\n` +
    `Tap <b>Confirm</b> within 60s to submit.\n\n` +
    `Token: <a href="${trackingUrl}">${tickerSafe}</a> <code>${tokenSafe}</code>`,
  SimplifiedChinese: (
    amount: number,
    tickerSafe: string,
    tokenSafe: string,
    trackingUrl: string,
  ) =>
    `✅ <b>准备买入 ${tickerSafe}：$${amount.toFixed(2)} USDC</b>\n\n` +
    `请在 60 秒内点击 <b>确认</b> 以提交。\n\n` +
    `代币：<a href="${trackingUrl}">${tickerSafe}</a> <code>${tokenSafe}</code>`,
} as const;

// ─── /sell — staging copy ──────────────────────────────────────────

export const SELL_STAGING_READY_HTML = {
  English: (
    percent: number,
    tickerSafe: string,
    proceedsUsd: number,
    tokenLine: string,
  ) =>
    `✅ <b>Ready to sell ${percent}% of ${tickerSafe} (≈$${proceedsUsd.toFixed(2)})</b>\n\n` +
    `Tap <b>Confirm</b> within 60s to submit.${tokenLine}`,
  SimplifiedChinese: (
    percent: number,
    tickerSafe: string,
    proceedsUsd: number,
    tokenLine: string,
  ) =>
    `✅ <b>准备卖出 ${tickerSafe} 的 ${percent}%（约 $${proceedsUsd.toFixed(2)}）</b>\n\n` +
    `请在 60 秒内点击 <b>确认</b> 以提交。${tokenLine}`,
} as const;
export const SELL_STAGING_READY_PRESET_HTML = {
  English: (
    percent: number,
    allOf: string,
    tickerSafe: string,
    proceedsUsd: number,
    tokenLine: string,
  ) =>
    `✅ <b>Ready to sell ${percent}%${allOf} of ${tickerSafe} (≈$${proceedsUsd.toFixed(2)})</b>\n\n` +
    `Tap <b>Confirm</b> within 60s to submit.${tokenLine}`,
  SimplifiedChinese: (
    percent: number,
    allOf: string,
    tickerSafe: string,
    proceedsUsd: number,
    tokenLine: string,
  ) =>
    `✅ <b>准备卖出 ${tickerSafe} 的 ${percent}%${allOf}（约 $${proceedsUsd.toFixed(2)}）</b>\n\n` +
    `请在 60 秒内点击 <b>确认</b> 以提交。${tokenLine}`,
} as const;
export const SELL_STAGING_BUFFER_CAPPED_PRESET_HTML = {
  English: (
    cappedProceedsUsd: number,
    originalProceedsUsd: number,
    percent: number,
    sellingAmount: string,
    totalBalance: string,
    tickerSafe: string,
    tokenLine: string,
  ) =>
    `⚠️ <b>Buffer low — capping sell at $${cappedProceedsUsd.toFixed(2)}</b> ` +
    `(reduced from ≈$${originalProceedsUsd.toFixed(2)} for ${percent}%).\n` +
    `Selling ${sellingAmount} of ${totalBalance} ${tickerSafe}. ` +
    `Buffer replenishes in ~10s; sell in chunks for the remainder.\n\n` +
    `Tap <b>Confirm</b> within 60s to submit the reduced amount.${tokenLine}`,
  SimplifiedChinese: (
    cappedProceedsUsd: number,
    originalProceedsUsd: number,
    percent: number,
    sellingAmount: string,
    totalBalance: string,
    tickerSafe: string,
    tokenLine: string,
  ) =>
    `⚠️ <b>流动性缓冲不足——已将卖出上限设为 $${cappedProceedsUsd.toFixed(2)}</b>` +
    `（${percent}% 原本约 $${originalProceedsUsd.toFixed(2)}）。\n` +
    `本次卖出 ${sellingAmount}，共持有 ${totalBalance} ${tickerSafe}。` +
    `流动性缓冲会在约 10 秒后补充；剩余部分请分批卖出。\n\n` +
    `请在 60 秒内点击 <b>确认</b> 以提交缩减后的金额。${tokenLine}`,
} as const;
export const SELL_PRESET_ALL_OF_SUFFIX = {
  English: (totalBalance: string) => ` all ${totalBalance}`,
  SimplifiedChinese: (totalBalance: string) => `（全部 ${totalBalance}）`,
} as const;
export const SELL_STAGING_BUFFER_CAPPED_HTML = {
  English: (
    cappedProceedsUsd: number,
    originalProceedsUsd: number,
    percent: number,
    tokenLine: string,
  ) =>
    `⚠️ <b>Buffer low — capping sell at $${cappedProceedsUsd.toFixed(2)}</b> ` +
    `(reduced from ≈$${originalProceedsUsd.toFixed(2)} for ${percent}%).\n` +
    `Buffer replenishes in ~10s; sell in chunks for the remainder.\n\n` +
    `Tap <b>Confirm</b> within 60s to submit the reduced amount.${tokenLine}`,
  SimplifiedChinese: (
    cappedProceedsUsd: number,
    originalProceedsUsd: number,
    percent: number,
    tokenLine: string,
  ) =>
    `⚠️ <b>流动性缓冲不足——已将卖出上限设为 $${cappedProceedsUsd.toFixed(2)}</b>` +
    `（${percent}% 原本约 $${originalProceedsUsd.toFixed(2)}）。\n` +
    `流动性缓冲会在约 10 秒后补充；剩余部分请分批卖出。\n\n` +
    `请在 60 秒内点击 <b>确认</b> 以提交缩减后的金额。${tokenLine}`,
} as const;

// ─── /withdraw — amount prompt + success receipt ───────────────────

export const WITHDRAW_AMOUNT_PROMPT = {
  English: (asset: string, formattedBalance: string) =>
    `How much ${asset}? Your ${asset} balance is ${formattedBalance}. Send a positive amount (e.g. 0.1).`,
  SimplifiedChinese: (asset: string, formattedBalance: string) =>
    `提币多少 ${asset}？您的 ${asset} 余额为 ${formattedBalance}。请发送正数（例如 0.1）。`,
} as const;
export const WITHDRAW_SUBMITTED_RECEIPT_HTML = {
  English: (txHash: string, explorerUrl: string) =>
    `✅ Withdraw submitted\n\nTx: <a href="${explorerUrl}">${txHash}</a>`,
  SimplifiedChinese: (txHash: string, explorerUrl: string) =>
    `✅ 提币已提交\n\n交易：<a href="${explorerUrl}">${txHash}</a>`,
} as const;

// ─── /referral — rewards wallet update fallback ────────────────────

export const REFERRAL_REWARDS_WALLET_UPDATED_FALLBACK_REPLY = {
  English: (rewardsWallet: string) =>
    `Rewards wallet updated to ${rewardsWallet}.`,
  SimplifiedChinese: (rewardsWallet: string) =>
    `奖励钱包已更新为 ${rewardsWallet}。`,
} as const;

// ─── /wallet — security status + empty-state hints ─────────────────

export const WALLET_STATUS_PIN_NOT_SET = {
  English: "• PIN: not set",
  SimplifiedChinese: "• PIN：未设置",
} as const;
export const WALLET_STATUS_PIN_RESET_READY = {
  English: "• PIN: reset ready — tap [Complete PIN reset] to set a new PIN",
  SimplifiedChinese: "• PIN：重置已就绪——点击 [完成 PIN 重置] 以设置新 PIN",
} as const;
export const WALLET_STATUS_PIN_RESET_PENDING = {
  English: (hoursRemaining: string) =>
    `• PIN: reset requested, available in ~${hoursRemaining} — tap [Cancel PIN reset] if you didn't request this`,
  SimplifiedChinese: (hoursRemaining: string) =>
    `• PIN：已申请重置，约 ${hoursRemaining} 后可用——如非您发起请点击 [取消 PIN 重置]`,
} as const;
export const WALLET_STATUS_PIN_SET = {
  English: "• PIN: set",
  SimplifiedChinese: "• PIN：已设置",
} as const;
export const WALLET_STATUS_WITHDRAW_LOCK_OFF = {
  English: "• Withdrawal lock: off",
  SimplifiedChinese: "• 提币锁定：关闭",
} as const;
export const WALLET_STATUS_WITHDRAW_LOCK_DISABLE_READY = {
  English:
    "• Withdrawal lock: on (disable ready — tap [Complete disable] to clear)",
  SimplifiedChinese:
    "• 提币锁定：开启（停用已就绪——点击 [完成停用] 以清除）",
} as const;
export const WALLET_STATUS_WITHDRAW_LOCK_DISABLE_PENDING = {
  English:
    "• Withdrawal lock: on (disable pending — 24h cooldown in progress)",
  SimplifiedChinese:
    "• 提币锁定：开启（停用待生效——24 小时冷却中）",
} as const;
export const WALLET_STATUS_WITHDRAW_LOCK_ON = {
  English: "• Withdrawal lock: on",
  SimplifiedChinese: "• 提币锁定：开启",
} as const;
export const WALLET_EMPTY_CREATE_HINT = {
  English: "• Create — generate a new bot-managed wallet to start trading",
  SimplifiedChinese: "• 新建 — 生成一个由机器人管理的新钱包以开始交易",
} as const;
export const WALLET_EMPTY_IMPORT_HINT = {
  English:
    "• Import — paste an existing private key (including a Privy key exported from the Web App)",
  SimplifiedChinese:
    "• 导入 — 粘贴已有的私钥（包括从 Web 应用导出的 Privy 私钥）",
} as const;
export const WALLET_LIST_HEADER = {
  English: (count: number, max: number) => `Wallets (${count}/${max})`,
  SimplifiedChinese: (count: number, max: number) =>
    `钱包（${count}/${max}）`,
} as const;
export const WALLET_UNLABELED_PLACEHOLDER = {
  English: "(unlabeled)",
  SimplifiedChinese: "（未命名）",
} as const;
export const WALLET_ACTIVE_LEGEND = {
  English: "* = active wallet (used for buy / sell / withdraw)",
  SimplifiedChinese: "* = 活动钱包（用于买入 / 卖出 / 提币）",
} as const;

// ─── /positions — per-row labels + pagination button ───────────────

export const POSITIONS_OPEN_LINE_DETAILS = {
  English: (balance: string, cost: string) => `${balance} · cost $${cost}`,
  SimplifiedChinese: (balance: string, cost: string) =>
    `${balance} · 成本 $${cost}`,
} as const;
export const POSITIONS_OPEN_LINE_VALUE_PNL = {
  English: (value: string, signedPnl: string, pnlPct: string) =>
    `value $${value} · PnL ${signedPnl} (${pnlPct})`,
  SimplifiedChinese: (value: string, signedPnl: string, pnlPct: string) =>
    `市值 $${value} · 盈亏 ${signedPnl} (${pnlPct})`,
} as const;
export const POSITIONS_REALISED_LINE_COST_PROCEEDS = {
  English: (cost: string, proceeds: string) =>
    `cost $${cost} · proceeds $${proceeds}`,
  SimplifiedChinese: (cost: string, proceeds: string) =>
    `成本 $${cost} · 收入 $${proceeds}`,
} as const;
export const POSITIONS_REALISED_LINE_REALIZED_PNL = {
  English: (signedPnl: string, pnlPct: string) =>
    `realized ${signedPnl} (${pnlPct})`,
  SimplifiedChinese: (signedPnl: string, pnlPct: string) =>
    `已实现 ${signedPnl} (${pnlPct})`,
} as const;
export const POSITIONS_PAGE_NAV_LABEL = {
  English: (arrow: string, target: number, totalPages: number, label: string) =>
    `${arrow ? `${arrow} ` : ""}Page ${target}/${totalPages} ${label}`,
  SimplifiedChinese: (
    arrow: string,
    target: number,
    totalPages: number,
    label: string,
  ) => `${arrow ? `${arrow} ` : ""}第 ${target}/${totalPages} 页 ${label}`,
} as const;

// ─── /track — trade side labels ────────────────────────────────────

export const TRACK_TRADE_SIDE_BUY = {
  English: "BUY",
  SimplifiedChinese: "买入",
} as const;
export const TRACK_TRADE_SIDE_SELL = {
  English: "SELL",
  SimplifiedChinese: "卖出",
} as const;

// ─── Chart — empty-state placeholder ───────────────────────────────

export const CHART_EMPTY_STATE_TEXT = {
  English: "No price data yet",
  SimplifiedChinese: "暂无价格数据",
} as const;

// ─── Action labels passed into localized PIN templates ─────────────
//
// PIN_LOCKED_REPLY / PIN_AUTHORISE_THE_PROMPT / PIN_VERIFY_PROMPT take
// an `actionLabel` interpolation. Callers that hardcoded English action
// names ("PIN change", "Withdraw") leaked English into otherwise
// localised PIN copy. These entries name each action in both locales so
// the template renders end-to-end translated.

export const PIN_ACTION_LABEL_WITHDRAW = {
  English: "Withdraw",
  SimplifiedChinese: "提币",
} as const;
export const PIN_ACTION_LABEL_PIN_CHANGE = {
  English: "PIN change",
  SimplifiedChinese: "PIN 修改",
} as const;
export const PIN_ACTION_LABEL_EXPORT = {
  English: "export",
  SimplifiedChinese: "导出",
} as const;
export const PIN_ACTION_LABEL_DELETE = {
  English: "delete",
  SimplifiedChinese: "删除",
} as const;

// ─── /settings — edit prompts + retry copy ─────────────────────────

export const SETTINGS_CUSTOM_SLIPPAGE_PROMPT = {
  English: (presetList: string, maxPct: number) =>
    [
      "Send a custom slippage percent (e.g. `0.75`, `3`, `7.5`).",
      `Quick presets: ${presetList}.`,
      `Max ${maxPct}% — past that the trade lib rejects.`,
      "",
      "Tap Home to exit and keep the current value.",
    ].join("\n"),
  SimplifiedChinese: (presetList: string, maxPct: number) =>
    [
      "请发送自定义滑点百分比（例如 `0.75`、`3`、`7.5`）。",
      `快捷预设：${presetList}。`,
      `最大 ${maxPct}%——超过后交易库会拒绝。`,
      "",
      "点击主页退出并保留当前值。",
    ].join("\n"),
} as const;
export const SETTINGS_SLIPPAGE_CAPPED_REPLY = {
  English: (maxPct: number) =>
    `Slippage capped at ${maxPct}% — send a smaller value.`,
  SimplifiedChinese: (maxPct: number) =>
    `滑点上限为 ${maxPct}%——请发送更小的值。`,
} as const;
export const SETTINGS_BUY_SLOT_PROMPT = {
  English: (minUsdc: number, maxUsdc: number) =>
    [
      "Change the value of the buy amount button.",
      "",
      `Send a USDC amount between $${minUsdc} and $${maxUsdc}.`,
      "",
      "Tap Home to exit and keep the current value.",
    ].join("\n"),
  SimplifiedChinese: (minUsdc: number, maxUsdc: number) =>
    [
      "修改买入金额按钮的值。",
      "",
      `请发送介于 $${minUsdc} 至 $${maxUsdc} 之间的 USDC 金额。`,
      "",
      "点击主页退出并保留当前值。",
    ].join("\n"),
} as const;
export const SETTINGS_BUY_SLOT_MIN_REPLY = {
  English: (minUsdc: number) =>
    `Minimum is $${minUsdc} USDC. Send a larger value.`,
  SimplifiedChinese: (minUsdc: number) =>
    `最小值为 $${minUsdc} USDC。请发送更大的值。`,
} as const;
export const SETTINGS_BUY_SLOT_MAX_REPLY = {
  English: (maxUsdc: number) =>
    `Capped at $${maxUsdc} USDC. Send a smaller value.`,
  SimplifiedChinese: (maxUsdc: number) =>
    `上限为 $${maxUsdc} USDC。请发送更小的值。`,
} as const;
export const SETTINGS_PHRASE_PROMPT_MAX_LINE = {
  English: (maxLen: number) => `Max ${maxLen} characters.`,
  SimplifiedChinese: (maxLen: number) => `最多 ${maxLen} 个字符。`,
} as const;
export const SETTINGS_PHRASE_TOO_LONG_REPLY = {
  English: (length: number, maxLen: number) =>
    `Phrase too long (${length}/${maxLen}). Send a shorter one.`,
  SimplifiedChinese: (length: number, maxLen: number) =>
    `短语过长 (${length}/${maxLen})。请发送更短的内容。`,
} as const;
export const SETTINGS_PHRASE_SAVED_HEADER = {
  English: "Phrase saved.",
  SimplifiedChinese: "短语已保存。",
} as const;
export const SETTINGS_SLIPPAGE_SAVED_CONFIRMATION = {
  English: (label: string) => `Slippage set to ${label}.`,
  SimplifiedChinese: (label: string) => `滑点已设置为 ${label}。`,
} as const;
export const PIN_SET_NOW_SEND_ONCE_MORE_PROMPT = {
  English: (actionLabel: string) =>
    `PIN set. Send it once more to authorize the ${actionLabel}.`,
  SimplifiedChinese: (actionLabel: string) =>
    `PIN 已设置。请再发送一次以授权${actionLabel}。`,
} as const;

// ─── /withdraw — inline arg parse errors ───────────────────────────

export const WITHDRAW_INLINE_INVALID_AMOUNT_REPLY = {
  English: (asset: string) =>
    `Invalid ${asset} amount. Send a positive number (e.g. 0.1).`,
  SimplifiedChinese: (asset: string) =>
    `${asset} 金额无效。请发送正数（例如 0.1）。`,
} as const;
export const WITHDRAW_INLINE_INVALID_DESTINATION_REPLY = {
  English: "Invalid destination. Must be a 0x-prefixed 40-char address.",
  SimplifiedChinese: "目标地址无效。必须是以 0x 开头的 40 位十六进制地址。",
} as const;
export const WITHDRAW_INLINE_UNSUPPORTED_ASSET_REPLY = {
  English: (assetRaw: string, hint: string) =>
    `Unsupported asset "${assetRaw}". ${hint}`,
  SimplifiedChinese: (assetRaw: string, hint: string) =>
    `不支持的资产 "${assetRaw}"。${hint}`,
} as const;
export const WITHDRAW_INLINE_INVALID_AMOUNT_PARSE_REPLY = {
  English: (amountRaw: string) =>
    `Invalid amount "${amountRaw}" — must be a positive decimal within the asset's precision.`,
  SimplifiedChinese: (amountRaw: string) =>
    `金额 "${amountRaw}" 无效——必须为正数且在该资产的精度范围内。`,
} as const;
export const WITHDRAW_INLINE_INVALID_DESTINATION_PARSE_REPLY = {
  English: (addressRaw: string) =>
    `Invalid destination address "${addressRaw}" — must be a 0x-prefixed 40-character hex string.`,
  SimplifiedChinese: (addressRaw: string) =>
    `目标地址 "${addressRaw}" 无效——必须是以 0x 开头的 40 位十六进制字符串。`,
} as const;
export const WITHDRAW_ASSET_BALANCE_LINE = {
  English: (usdcBalance: string, hypeBalance: string) =>
    `You have ${usdcBalance} and ${hypeBalance}.`,
  SimplifiedChinese: (usdcBalance: string, hypeBalance: string) =>
    `您当前持有 ${usdcBalance} 和 ${hypeBalance}。`,
} as const;
