import { describe, expect, it } from "vitest";

import * as i18n from "../../lib/i18n.js";
import type { Localised } from "../../lib/i18n.js";
import { t } from "../../lib/i18n.js";

const isLanguageDict = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  Object.prototype.hasOwnProperty.call(value, "English");

describe("i18n module", () => {
  it("declares English as the default language", () => {
    expect(i18n.DEFAULT_LANGUAGE).toBe("English");
  });

  it("every exported entry is keyed by a language", () => {
    const NON_ENTRY_EXPORTS = new Set([
      "DEFAULT_LANGUAGE",
      "HELP_HEADER_PLACEHOLDER_TOKEN",
      "getCtxLanguage",
      "t",
    ]);
    const entries = Object.entries(i18n).filter(
      ([key]) => !NON_ENTRY_EXPORTS.has(key) && typeof i18n[key as keyof typeof i18n] !== "function",
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, value] of entries) {
      expect(isLanguageDict(value), `entry ${key} is not keyed by language`).toBe(
        true,
      );
    }
  });

  it("static entries resolve to non-empty strings", () => {
    expect(i18n.BACK_BUTTON_TEXT.English).toBe("← Back");
    expect(i18n.HOME_BUTTON_TEXT.English).toBe("🏠 Home");
    expect(i18n.REFRESH_BUTTON_TEXT.English).toContain("Refresh");
    expect(i18n.OUTAGE_REPLY.English).toContain("temporarily unavailable");
  });

  it("renders parameterised entries with arguments", () => {
    expect(i18n.BUY_AMOUNT_BUTTON.English(20)).toBe("Buy 20 USDC");
    expect(i18n.SELL_PERCENT_BUTTON.English(50)).toBe("Sell 50%");
    expect(i18n.SETTINGS_BUY_PRESET_BUTTON.English(40)).toBe("✏️ 40 USDC");
    expect(i18n.SETTINGS_SELL_PRESET_BUTTON.English(25)).toBe("✏️ 25%");
  });

  it("renders the help overview with the topic list", () => {
    const topics = ["wallet", "trading"];
    const body = i18n.HELP_OVERVIEW_HTML.English(topics);
    expect(body).toContain(i18n.HELP_HEADER_PLACEHOLDER_TOKEN);
    expect(body).toContain("<code>/help wallet</code>");
    expect(body).toContain("<code>/help trading</code>");
  });

  it("renders the unknown-topic body with comma-separated topics", () => {
    const body = i18n.HELP_UNKNOWN_TOPIC_HTML.English(["wallet", "trading"]);
    expect(body).toContain("Unknown help topic.");
    expect(body).toContain("<code>wallet</code>, <code>trading</code>");
  });

  it("renders the buy card loading text with the full address so tap-to-copy yields the full hex", () => {
    const full = "0x1234567890abcdef1234567890abcdef12345678";
    const english = i18n.BUY_CARD_LOADING_HTML.English(full);
    expect(english).toBe(`⏳ Loading <code>${full}</code>…`);
    expect(english).not.toContain("…</code>");
    const zh = i18n.BUY_CARD_LOADING_HTML.SimplifiedChinese(full);
    expect(zh).toBe(`⏳ 正在加载 <code>${full}</code>…`);
    expect(zh).not.toContain("…</code>");
  });

  it("renders the sell buffer banner with the formatted max and minimum", () => {
    const body = i18n.SELL_BUFFER_BELOW_MIN_HTML.English(8.5, 12);
    expect(body).toContain("≈$8.50");
    expect(body).toContain("$12 minimum");
  });

  it("renders newly extracted wallet toasts and prompts", () => {
    expect(i18n.WALLET_RENAME_LENGTH_INVALID_REPLY.English(32)).toBe(
      "Label must be 1–32 characters. Rename canceled.",
    );
    expect(
      i18n.WALLET_DELETE_CONFIRM_PROMPT.English("main", "0x12…cd"),
    ).toContain("permanently removes main (0x12…cd)");
    expect(i18n.WALLET_PIN_SET_HEADER.English).toBe("PIN set.");
    expect(i18n.WALLET_PIN_CHANGED_HEADER.English).toBe("PIN changed.");
    expect(i18n.WALLET_PIN_RESET_COMPLETE_HEADER.English).toBe(
      "PIN reset complete.",
    );
    expect(
      i18n.WALLET_RESET_NOT_READY_WITH_CANCEL_HINT_REPLY.English("3h"),
    ).toContain("~3h remaining");
    expect(i18n.WALLET_RESET_NOT_READY_REPLY.English("12h")).toBe(
      "Reset not yet available — ~12h remaining.",
    );
    expect(i18n.TOAST_WALLET_CREATED.English("0xabcd…1234")).toBe(
      "Created 0xabcd…1234",
    );
    expect(i18n.TOAST_WALLET_CAP_REACHED.English(5)).toContain(
      "Wallet cap reached (5)",
    );
    expect(i18n.TOAST_WALLET_SWITCHED_TO.English("hot")).toBe(
      "Switched to hot",
    );
    expect(i18n.TOAST_WALLET_SWITCHED.English).toBe("Switched.");
    expect(i18n.TOAST_PIN_RESET_REQUESTED.English("24h")).toContain(
      "Complete in ~24h",
    );
    expect(i18n.TOAST_LOCK_DISABLE_REQUESTED.English("24h")).toContain(
      "completes in ~24h",
    );
  });

  it("renders newly extracted PIN-flow prompts and replies", () => {
    expect(i18n.PIN_VERIFY_PROMPT.English("PIN change")).toBe(
      "Send your current 6-digit PIN to authorize PIN change.",
    );
    expect(i18n.PIN_AUTHORISE_THE_PROMPT.English("export")).toBe(
      "Send your 6-digit PIN to authorize the export.",
    );
    expect(i18n.PIN_LOCKED_REPLY.English(5, "Export")).toBe(
      "Too many wrong PIN attempts — locked for ~5 min. Export canceled.",
    );
    expect(i18n.PIN_WRONG_RETRY_REPLY.English(3)).toBe(
      "Wrong PIN. 3 attempts remaining. Try again.",
    );
    expect(i18n.PIN_STATE_LOST_REPLY.English("/wallet → Export key")).toBe(
      "PIN state lost — re-run /wallet → Export key.",
    );
  });

  it("uses US English spelling in user-facing strings", () => {
    expect(i18n.TOAST_RESET_CANCELLED.English).toBe("Reset canceled.");
    expect(i18n.TOAST_DISABLE_CANCELLED.English).toBe("Disable canceled.");
    expect(i18n.TOAST_DELETE_CANCELLED.English).toBe("Delete canceled.");
    expect(i18n.TOAST_CANCELLED.English).toBe("Canceled.");
    expect(i18n.TOAST_CONFIRM_CLEARED.English).toBe("Canceled");
    expect(i18n.POSITIONS_REALISED_POS_HEADER.English).toBe("Realized Pos");
    expect(i18n.BOT_COMMAND_POSITIONS_DESCRIPTION.English).toBe(
      "Show open and realized positions",
    );
    expect(i18n.WITHDRAW_PIN_PROMPT.English).toBe(
      "Send your 6-digit PIN to authorize the withdraw.",
    );
    expect(i18n.REFERRAL_VERIFY_PIN_PROMPT.English).toBe(
      "Send your 6-digit PIN to authorize the rewards-wallet change.",
    );
    expect(i18n.WALLET_RENAME_NO_LONGER_EXISTS_REPLY.English).toBe(
      "Wallet no longer exists. Rename canceled.",
    );
    expect(i18n.WALLET_IMPORT_ALREADY_EXISTS_REPLY.English).toBe(
      "That wallet is already in your list. Import canceled.",
    );
    expect(i18n.SETTINGS_ANTI_PHISHING_PROMPT.English).toContain(
      "recognize messages",
    );
  });

  it("renders newly extracted buy/sell/settings toasts", () => {
    expect(i18n.BUY_INSUFFICIENT_USDC_REPLY.English(120.5, 100)).toBe(
      "Insufficient USDC: need $120.50, have $100.00.",
    );
    expect(i18n.SELL_NO_BALANCE_REPLY.English("WIF")).toBe(
      "You hold no WIF.",
    );
    expect(i18n.SELL_PERCENT_ROUNDS_TO_ZERO_REPLY.English(10, "WIF")).toBe(
      "10% of your WIF balance rounds to zero.",
    );
    expect(
      i18n.SELL_PERCENT_ROUNDS_TO_ZERO_TRY_LARGER_REPLY.English(5, "WIF"),
    ).toContain("try a larger percent");
    expect(i18n.SELL_PROCEEDS_BELOW_MIN_REPLY.English(8.123, 12)).toBe(
      "Estimated proceeds ≈$8.12 would be below the $12 minimum.",
    );
    expect(
      i18n.SELL_PROCEEDS_BELOW_MIN_TRY_LARGER_REPLY.English(8.5, 12),
    ).toContain("Increase the percent");
    expect(i18n.SELL_LT_BUFFER_TOO_LOW_REPLY.English(6.7, 12)).toContain(
      "≈$6.70 < $12 min",
    );
    expect(i18n.SETTINGS_SLIPPAGE_SET_REPLY.English("2%")).toBe(
      "Slippage set to 2%.",
    );
    expect(i18n.SETTINGS_EXECUTION_SPEED_SET_REPLY.English("Fast")).toBe(
      "Execution speed set to Fast.",
    );
  });

  it("renders newly extracted start / token-card / referral lines", () => {
    expect(i18n.START_WELCOME_LEAD.English("CortisolBot")).toContain(
      "Welcome to CortisolBot",
    );
    expect(i18n.START_WELCOME_LEAD.English("CortisolBot")).toContain(
      "alt.fun",
    );
    expect(i18n.REFERRAL_CHANGE_REWARDS_WALLET_ACTION_LABEL.English).toBe(
      "Rewards-wallet change",
    );
    expect(i18n.REFERRAL_CHANGE_REWARDS_WALLET_RETRY_HINT.English).toBe(
      "/referral → Change rewards wallet",
    );
    expect(i18n.START_BALANCE_LABEL.English("12.34")).toBe(
      "Balance: 12.34 USDC",
    );
    expect(i18n.START_GAS_BALANCE_LABEL.English("0.5")).toBe(
      "Gas balance: 0.5 HYPE",
    );
    expect(i18n.TAP_TO_COPY_HINT.English).toBe("(Tap to copy)");
    expect(i18n.TOKEN_CARD_MARKET_CAP_HTML.English("$12K")).toBe(
      "💰 <b>Market Cap:</b> $12K",
    );
    expect(i18n.TOKEN_CARD_PRICE_HTML.English("$0.0001")).toContain("Price:");
    expect(i18n.TOKEN_CARD_CHANGE_24H_HTML.English("+5%")).toContain(
      "24h Change:",
    );
    expect(i18n.TOKEN_CARD_VOLUME_24H_HTML.English("$5K")).toContain(
      "24h Volume:",
    );
    expect(i18n.TOKEN_CARD_CURVE_FILLED_HTML.English("42%")).toContain(
      "Curve Filled:",
    );
    expect(
      i18n.TOKEN_CARD_VIEW_ON_EXPLORER_HTML.English("https://x"),
    ).toContain("View on Explorer");
    expect(i18n.TOKEN_CARD_VIEW_ON_ALT_FUN_HTML.English("https://x")).toContain(
      "View on Alt Fun",
    );
    expect(
      i18n.TOKEN_CARD_YOUR_USDC_BALANCE_HTML.English("$10"),
    ).toContain("Your USDC Balance:");
    expect(i18n.TOKEN_CARD_YOUR_BALANCE_HTML.English("1 WIF")).toContain(
      "Your Balance:",
    );
    expect(i18n.TOKEN_CARD_BALANCE_UNAVAILABLE.English).toBe(
      "— (balance unavailable)",
    );
    expect(i18n.REFERRAL_REFERRED_USERS_LABEL.English(7)).toBe(
      "Referred users: 7",
    );
    expect(i18n.REFERRAL_LIFETIME_EARNED_LABEL.English("3.21")).toBe(
      "Lifetime earned: $3.21 USDC",
    );
  });

  it("renders newly extracted trade confirm + tx-status copy", () => {
    expect(i18n.CONFIRM_EXPIRED_REPLY.English).toContain("trade confirmation");
    expect(i18n.TRADE_VERB_BUY.English).toBe("Buy");
    expect(i18n.TRADE_VERB_SELL.English).toBe("Sell");
    expect(i18n.TRADE_RECEIVED_TOKENS.English("1.5", "WIF")).toBe(
      "Received: 1.5 WIF\n",
    );
    expect(i18n.TRADE_RECEIVED_USDC.English("10.00")).toBe(
      "Received: $10.00 USDC\n",
    );
    expect(i18n.TRADE_CONFIRMED_HEADER_HTML.English("Buy", "WIF")).toBe(
      "✅ <b>Buy confirmed for WIF</b>",
    );
    expect(i18n.TRADE_TX_LABEL.English).toBe("Tx:");
    expect(i18n.TRADE_STATUS_BUYING.English("$20", "WIF")).toBe(
      "Buying $20 USDC of WIF",
    );
    expect(i18n.TRADE_STATUS_SELLING.English("1", "WIF")).toBe(
      "Selling 1 WIF",
    );
    expect(i18n.TX_SENDING_HEADER_HTML.English).toBe("⏳ <b>Tx sending</b>");
    expect(i18n.TX_PENDING_HEADER_HTML.English).toBe("⏳ <b>Tx pending</b>");
    expect(i18n.TX_PENDING_BODY.English).toContain(
      "Still waiting for the network",
    );
  });

  it("renders newly extracted execution-error variants", () => {
    expect(
      i18n.TX_PENDING_POLLING_REPLY.English(20, "https://ex/tx"),
    ).toContain("Still polling in the background");
    expect(
      i18n.TX_PENDING_NO_POLLING_REPLY.English("https://ex/tx"),
    ).toContain("no longer polling");
    expect(
      i18n.TX_PENDING_NEUTRAL_REPLY.English("https://ex/tx"),
    ).toContain("Check the explorer");
    expect(
      i18n.TX_SUBMITTED_RECEIPT_MISSING_REPLY.English("https://ex/tx"),
    ).toContain("Tx submitted but receipt not seen");
    expect(i18n.RPC_UNAVAILABLE_REPLY.English).toBe(
      "RPC unavailable — please try again in a moment.",
    );
    expect(i18n.TRADING_NOT_YET_OPEN_REPLY.English("")).toContain(
      "Trading not yet open",
    );
    expect(i18n.LT_BUFFER_LOW_REPLY.English("")).toContain(
      "BounceTech LT buffer low",
    );
    expect(i18n.SLIPPAGE_EXCEEDED_REPLY.English("")).toContain(
      "raise slippage",
    );
    expect(i18n.BUYS_PAUSED_MINT_PAUSED_REPLY.English("")).toContain(
      "Sells still work",
    );
    expect(
      i18n.TX_REVERTED_ON_CHAIN_REPLY.English("oops", "https://ex/tx"),
    ).toBe("Transaction reverted on-chain: oops. See https://ex/tx.");
    expect(i18n.TX_REVERTED_ON_CHAIN_REPLY.English("", "https://ex/tx")).toBe(
      "Transaction reverted on-chain. See https://ex/tx.",
    );
    expect(i18n.TX_FAILED_GENERIC_REPLY.English("nope")).toBe(
      "Transaction failed: nope.",
    );
    expect(i18n.TX_FAILED_GENERIC_REPLY.English("")).toBe(
      "Transaction failed.",
    );
    expect(i18n.RPC_UNAVAILABLE_WITH_REASON_REPLY.English("timeout")).toBe(
      "RPC unavailable: timeout — try again in a moment.",
    );
    expect(i18n.RPC_UNAVAILABLE_WITH_REASON_REPLY.English("")).toBe(
      "RPC unavailable — try again in a moment.",
    );
    expect(
      i18n.TRANSACTION_REVERTED_WITH_REASON_REPLY.English("revert reason"),
    ).toBe("Transaction reverted: revert reason.");
  });

  it("renders round-3 i18n keys (settings edit prompts, withdraw asset balance, sell preset staging)", () => {
    // /settings — custom slippage prompt
    expect(
      i18n.SETTINGS_CUSTOM_SLIPPAGE_PROMPT.English("0.5% / 2% / 5%", 50),
    ).toContain("custom slippage percent");
    expect(
      t(i18n.SETTINGS_CUSTOM_SLIPPAGE_PROMPT, "SimplifiedChinese")(
        "0.5% / 2% / 5%",
        50,
      ),
    ).toContain("请发送自定义滑点百分比");

    expect(i18n.SETTINGS_SLIPPAGE_CAPPED_REPLY.English(50)).toBe(
      "Slippage capped at 50% — send a smaller value.",
    );
    expect(
      t(i18n.SETTINGS_SLIPPAGE_CAPPED_REPLY, "SimplifiedChinese")(50),
    ).toContain("滑点上限");

    // Buy slot prompt + min/max retries
    expect(i18n.SETTINGS_BUY_SLOT_PROMPT.English(20, 10000)).toContain(
      "between $20 and $10000",
    );
    expect(
      t(i18n.SETTINGS_BUY_SLOT_PROMPT, "SimplifiedChinese")(20, 10000),
    ).toContain("$20 至 $10000");
    expect(i18n.SETTINGS_BUY_SLOT_MIN_REPLY.English(20)).toBe(
      "Minimum is $20 USDC. Send a larger value.",
    );
    expect(
      t(i18n.SETTINGS_BUY_SLOT_MIN_REPLY, "SimplifiedChinese")(20),
    ).toContain("最小值");
    expect(i18n.SETTINGS_BUY_SLOT_MAX_REPLY.English(10000)).toBe(
      "Capped at $10000 USDC. Send a smaller value.",
    );
    expect(
      t(i18n.SETTINGS_BUY_SLOT_MAX_REPLY, "SimplifiedChinese")(10000),
    ).toContain("上限");

    // Anti-phishing phrase too long + saved header
    expect(i18n.SETTINGS_PHRASE_TOO_LONG_REPLY.English(70, 64)).toContain(
      "Phrase too long (70/64)",
    );
    expect(
      t(i18n.SETTINGS_PHRASE_TOO_LONG_REPLY, "SimplifiedChinese")(70, 64),
    ).toContain("短语过长");
    expect(i18n.SETTINGS_PHRASE_SAVED_HEADER.English).toBe("Phrase saved.");
    expect(t(i18n.SETTINGS_PHRASE_SAVED_HEADER, "SimplifiedChinese")).toBe(
      "短语已保存。",
    );
    expect(i18n.SETTINGS_PHRASE_PROMPT_MAX_LINE.English(64)).toBe(
      "Max 64 characters.",
    );
    expect(
      t(i18n.SETTINGS_PHRASE_PROMPT_MAX_LINE, "SimplifiedChinese")(64),
    ).toBe("最多 64 个字符。");
    expect(i18n.SETTINGS_SLIPPAGE_SAVED_CONFIRMATION.English("2%")).toBe(
      "Slippage set to 2%.",
    );
    expect(
      t(i18n.SETTINGS_SLIPPAGE_SAVED_CONFIRMATION, "SimplifiedChinese")("2%"),
    ).toBe("滑点已设置为 2%。");

    // /withdraw asset-balance line
    expect(
      i18n.WITHDRAW_ASSET_BALANCE_LINE.English("100 USDC", "0.5 HYPE"),
    ).toBe("You have 100 USDC and 0.5 HYPE.");
    expect(
      t(i18n.WITHDRAW_ASSET_BALANCE_LINE, "SimplifiedChinese")(
        "100 USDC",
        "0.5 HYPE",
      ),
    ).toBe("您当前持有 100 USDC 和 0.5 HYPE。");

    // /sell preset staging
    expect(
      i18n.SELL_STAGING_READY_PRESET_HTML.English(
        50,
        " all 100",
        "WIF",
        10.5,
        "\n\ntoken",
      ),
    ).toContain("Ready to sell 50% all 100 of WIF");
    expect(
      t(i18n.SELL_STAGING_READY_PRESET_HTML, "SimplifiedChinese")(
        50,
        "（全部 100）",
        "WIF",
        10.5,
        "\n\ntoken",
      ),
    ).toContain("准备卖出 WIF 的 50%（全部 100）");
    expect(
      i18n.SELL_STAGING_BUFFER_CAPPED_PRESET_HTML.English(
        5,
        10,
        50,
        "5",
        "10",
        "WIF",
        "\n\ntoken",
      ),
    ).toContain("Selling 5 of 10 WIF");
    expect(
      t(
        i18n.SELL_STAGING_BUFFER_CAPPED_PRESET_HTML,
        "SimplifiedChinese",
      )(5, 10, 50, "5", "10", "WIF", "\n\ntoken"),
    ).toContain("本次卖出 5，共持有 10 WIF");
    expect(i18n.SELL_PRESET_ALL_OF_SUFFIX.English("100")).toBe(" all 100");
    expect(t(i18n.SELL_PRESET_ALL_OF_SUFFIX, "SimplifiedChinese")("100")).toBe(
      "（全部 100）",
    );

    // Shared staging Token: line (used by buy + sell)
    expect(
      i18n.TRADE_STAGING_TOKEN_LINE_HTML.English("https://x", "WIF", "0xabc"),
    ).toContain('Token: <a href="https://x">WIF</a>');
    expect(
      t(i18n.TRADE_STAGING_TOKEN_LINE_HTML, "SimplifiedChinese")(
        "https://x",
        "WIF",
        "0xabc",
      ),
    ).toContain("代币：");

    // /withdraw confirmation summary labels
    expect(i18n.WITHDRAW_SUMMARY_ASSET_LABEL.English("USDC")).toBe(
      "• Asset: USDC",
    );
    expect(
      t(i18n.WITHDRAW_SUMMARY_ASSET_LABEL, "SimplifiedChinese")("USDC"),
    ).toBe("• 资产：USDC");
    expect(i18n.WITHDRAW_SUMMARY_AMOUNT_LABEL.English("1", "USDC")).toBe(
      "• Amount: 1 USDC",
    );
    expect(
      t(i18n.WITHDRAW_SUMMARY_AMOUNT_LABEL, "SimplifiedChinese")("1", "USDC"),
    ).toBe("• 金额：1 USDC");
    expect(i18n.WITHDRAW_SUMMARY_AVAILABLE_LABEL.English("5 USDC")).toBe(
      "• Available balance: 5 USDC",
    );
    expect(
      t(i18n.WITHDRAW_SUMMARY_AVAILABLE_LABEL, "SimplifiedChinese")("5 USDC"),
    ).toBe("• 可用余额：5 USDC");
    expect(i18n.WITHDRAW_SUMMARY_DESTINATION_LABEL.English("0xabc")).toBe(
      "• Destination: 0xabc",
    );
    expect(
      t(i18n.WITHDRAW_SUMMARY_DESTINATION_LABEL, "SimplifiedChinese")("0xabc"),
    ).toBe("• 目标地址：0xabc");

    // /wallet reveal + import/delete completion
    expect(i18n.WALLET_EXPORT_REVEAL_ADDRESS_LABEL.English("0xabc")).toBe(
      "Address: 0xabc",
    );
    expect(
      t(i18n.WALLET_EXPORT_REVEAL_ADDRESS_LABEL, "SimplifiedChinese")("0xabc"),
    ).toBe("地址：0xabc");
    expect(i18n.WALLET_EXPORT_REVEAL_PRIVATE_KEY_LABEL.English("0xkey")).toBe(
      "Private key: 0xkey",
    );
    expect(
      t(i18n.WALLET_EXPORT_REVEAL_PRIVATE_KEY_LABEL, "SimplifiedChinese")(
        "0xkey",
      ),
    ).toBe("私钥：0xkey");
    expect(i18n.WALLET_IMPORT_CAP_REACHED_REPLY.English(10)).toContain(
      "Wallet cap reached (10)",
    );
    expect(
      t(i18n.WALLET_IMPORT_CAP_REACHED_REPLY, "SimplifiedChinese")(10),
    ).toContain("已达到钱包数量上限（10）");
    expect(i18n.WALLET_IMPORTED_HEADER.English("0xab…cd")).toBe(
      "Imported 0xab…cd.",
    );
    expect(
      t(i18n.WALLET_IMPORTED_HEADER, "SimplifiedChinese")("0xab…cd"),
    ).toBe("已导入 0xab…cd。");
    expect(i18n.WALLET_DELETED_HEADER.English("0xab…cd")).toBe(
      "Deleted 0xab…cd.",
    );
    expect(t(i18n.WALLET_DELETED_HEADER, "SimplifiedChinese")("0xab…cd")).toBe(
      "已删除 0xab…cd。",
    );

    // /referral safety-banner sentence bodies
    expect(i18n.REFERRAL_BANNER_BAD_PAYMENT_BODY.English(1)).toBe(
      "1 referral payment rolled into treasury and are not recoverable.",
    );
    expect(i18n.REFERRAL_BANNER_BAD_PAYMENT_BODY.English(3)).toBe(
      "3 referral payments rolled into treasury and are not recoverable.",
    );
    expect(
      t(i18n.REFERRAL_BANNER_BAD_PAYMENT_BODY, "SimplifiedChinese")(3),
    ).toContain("3 笔推荐返佣");
    expect(i18n.REFERRAL_BANNER_ATTRIBUTION_DROPPED_BODY.English(2)).toContain(
      "2 users hit your link",
    );
    expect(
      t(
        i18n.REFERRAL_BANNER_ATTRIBUTION_DROPPED_BODY,
        "SimplifiedChinese",
      )(2),
    ).toContain("2 位用户");
  });

  it("renders round-2 i18n keys (positions row labels, track sides, chart, PIN action labels, inline withdraw errors)", () => {
    // /positions row + page-nav templates
    expect(i18n.POSITIONS_OPEN_LINE_DETAILS.English("1.5", "20.00")).toBe(
      "1.5 · cost $20.00",
    );
    expect(
      t(i18n.POSITIONS_OPEN_LINE_DETAILS, "SimplifiedChinese")("1.5", "20.00"),
    ).toBe("1.5 · 成本 $20.00");
    expect(
      i18n.POSITIONS_OPEN_LINE_VALUE_PNL.English("21.50", "+1.50", "+7.5%"),
    ).toBe("value $21.50 · PnL +1.50 (+7.5%)");
    expect(
      t(i18n.POSITIONS_OPEN_LINE_VALUE_PNL, "SimplifiedChinese")(
        "21.50",
        "+1.50",
        "+7.5%",
      ),
    ).toBe("市值 $21.50 · 盈亏 +1.50 (+7.5%)");
    expect(
      i18n.POSITIONS_REALISED_LINE_COST_PROCEEDS.English("10.00", "15.00"),
    ).toBe("cost $10.00 · proceeds $15.00");
    expect(
      t(i18n.POSITIONS_REALISED_LINE_COST_PROCEEDS, "SimplifiedChinese")(
        "10.00",
        "15.00",
      ),
    ).toBe("成本 $10.00 · 收入 $15.00");
    expect(
      i18n.POSITIONS_REALISED_LINE_REALIZED_PNL.English("+5.00", "+50%"),
    ).toBe("realized +5.00 (+50%)");
    expect(
      t(i18n.POSITIONS_REALISED_LINE_REALIZED_PNL, "SimplifiedChinese")(
        "+5.00",
        "+50%",
      ),
    ).toBe("已实现 +5.00 (+50%)");
    expect(i18n.POSITIONS_PAGE_NAV_LABEL.English("→", 2, 5, "Open Pos")).toBe(
      "→ Page 2/5 Open Pos",
    );
    expect(
      t(i18n.POSITIONS_PAGE_NAV_LABEL, "SimplifiedChinese")(
        "→",
        2,
        5,
        "持仓",
      ),
    ).toBe("→ 第 2/5 页 持仓");

    // /track trade side labels
    expect(i18n.TRACK_TRADE_SIDE_BUY.English).toBe("BUY");
    expect(t(i18n.TRACK_TRADE_SIDE_BUY, "SimplifiedChinese")).toBe("买入");
    expect(i18n.TRACK_TRADE_SIDE_SELL.English).toBe("SELL");
    expect(t(i18n.TRACK_TRADE_SIDE_SELL, "SimplifiedChinese")).toBe("卖出");

    // Chart empty-state
    expect(i18n.CHART_EMPTY_STATE_TEXT.English).toBe("No price data yet");
    expect(t(i18n.CHART_EMPTY_STATE_TEXT, "SimplifiedChinese")).toBe(
      "暂无价格数据",
    );

    // PIN action labels passed into localised templates
    expect(i18n.PIN_ACTION_LABEL_WITHDRAW.English).toBe("Withdraw");
    expect(t(i18n.PIN_ACTION_LABEL_WITHDRAW, "SimplifiedChinese")).toBe(
      "提币",
    );
    expect(i18n.PIN_ACTION_LABEL_PIN_CHANGE.English).toBe("PIN change");
    expect(t(i18n.PIN_ACTION_LABEL_PIN_CHANGE, "SimplifiedChinese")).toBe(
      "PIN 修改",
    );
    expect(i18n.PIN_ACTION_LABEL_EXPORT.English).toBe("export");
    expect(t(i18n.PIN_ACTION_LABEL_EXPORT, "SimplifiedChinese")).toBe(
      "导出",
    );
    expect(i18n.PIN_ACTION_LABEL_DELETE.English).toBe("delete");
    expect(t(i18n.PIN_ACTION_LABEL_DELETE, "SimplifiedChinese")).toBe(
      "删除",
    );
    expect(i18n.PIN_SET_NOW_SEND_ONCE_MORE_PROMPT.English("export")).toBe(
      "PIN set. Send it once more to authorize the export.",
    );
    expect(
      t(i18n.PIN_SET_NOW_SEND_ONCE_MORE_PROMPT, "SimplifiedChinese")("导出"),
    ).toContain("PIN 已设置");

    // /withdraw inline-arg parse errors
    expect(
      i18n.WITHDRAW_INLINE_UNSUPPORTED_ASSET_REPLY.English("BTC", "Usage…"),
    ).toBe('Unsupported asset "BTC". Usage…');
    expect(
      t(i18n.WITHDRAW_INLINE_UNSUPPORTED_ASSET_REPLY, "SimplifiedChinese")(
        "BTC",
        "Usage…",
      ),
    ).toContain("不支持的资产");
    expect(
      i18n.WITHDRAW_INLINE_INVALID_AMOUNT_PARSE_REPLY.English("0.x"),
    ).toContain("Invalid amount");
    expect(
      t(i18n.WITHDRAW_INLINE_INVALID_AMOUNT_PARSE_REPLY, "SimplifiedChinese")(
        "0.x",
      ),
    ).toContain("金额");
    expect(
      i18n.WITHDRAW_INLINE_INVALID_DESTINATION_PARSE_REPLY.English("0xnope"),
    ).toContain("Invalid destination address");
    expect(
      t(
        i18n.WITHDRAW_INLINE_INVALID_DESTINATION_PARSE_REPLY,
        "SimplifiedChinese",
      )("0xnope"),
    ).toContain("目标地址");
  });

  it("renders newly threaded buy/sell/withdraw/referral/wallet copy in both languages", () => {
    // /buy — custom-amount wizard
    expect(i18n.BUY_CUSTOM_AMOUNT_PROMPT.English(20)).toContain(
      "Enter the USDC amount to buy",
    );
    expect(t(i18n.BUY_CUSTOM_AMOUNT_PROMPT, "SimplifiedChinese")(20)).toContain(
      "请输入要买入的 USDC 金额",
    );
    expect(i18n.BUY_INVALID_NUMBER_RETRY_REPLY.English(20)).toContain(
      "Please enter a valid number",
    );
    expect(
      t(i18n.BUY_INVALID_NUMBER_RETRY_REPLY, "SimplifiedChinese")(20),
    ).toContain("请输入有效数字");
    expect(i18n.BUY_MINIMUM_BUY_RETRY_REPLY.English(20)).toBe(
      "Minimum buy is $20 USDC. Enter a larger amount.",
    );
    expect(
      t(i18n.BUY_MINIMUM_BUY_RETRY_REPLY, "SimplifiedChinese")(20),
    ).toContain("最低买入金额");
    expect(i18n.BUY_UNABLE_VERIFY_USDC_BALANCE_REPLY.English).toContain(
      "Unable to verify",
    );
    expect(
      t(i18n.BUY_UNABLE_VERIFY_USDC_BALANCE_REPLY, "SimplifiedChinese"),
    ).toContain("无法核实");
    expect(
      i18n.BUY_INSUFFICIENT_USDC_RETRY_REPLY.English(120.5, "$100"),
    ).toContain("Insufficient USDC balance");
    expect(
      t(i18n.BUY_INSUFFICIENT_USDC_RETRY_REPLY, "SimplifiedChinese")(120.5, "$100"),
    ).toContain("USDC 余额不足");
    expect(
      i18n.BUY_STAGING_HTML.English(20.5, "WIF", "0xabc", "https://x"),
    ).toContain("Ready to buy");
    expect(
      t(i18n.BUY_STAGING_HTML, "SimplifiedChinese")(
        20.5,
        "WIF",
        "0xabc",
        "https://x",
      ),
    ).toContain("准备买入");

    // /sell — staging copy
    expect(
      i18n.SELL_STAGING_READY_HTML.English(50, "WIF", 10.5, "\n\ntoken"),
    ).toContain("Ready to sell 50% of WIF");
    expect(
      t(i18n.SELL_STAGING_READY_HTML, "SimplifiedChinese")(
        50,
        "WIF",
        10.5,
        "\n\ntoken",
      ),
    ).toContain("准备卖出");
    expect(
      i18n.SELL_STAGING_BUFFER_CAPPED_HTML.English(
        5,
        10,
        50,
        "\n\ntoken",
      ),
    ).toContain("Buffer low");
    expect(
      t(i18n.SELL_STAGING_BUFFER_CAPPED_HTML, "SimplifiedChinese")(
        5,
        10,
        50,
        "\n\ntoken",
      ),
    ).toContain("流动性缓冲不足");

    // /withdraw — amount prompt + receipt
    expect(i18n.WITHDRAW_AMOUNT_PROMPT.English("USDC", "100 USDC")).toContain(
      "How much USDC?",
    );
    expect(
      t(i18n.WITHDRAW_AMOUNT_PROMPT, "SimplifiedChinese")("USDC", "100 USDC"),
    ).toContain("提币多少");
    expect(
      i18n.WITHDRAW_SUBMITTED_RECEIPT_HTML.English("0xhash", "https://ex/tx"),
    ).toContain("Withdraw submitted");
    expect(
      t(i18n.WITHDRAW_SUBMITTED_RECEIPT_HTML, "SimplifiedChinese")(
        "0xhash",
        "https://ex/tx",
      ),
    ).toContain("提币已提交");

    // /referral — rewards-wallet update fallback
    expect(
      i18n.REFERRAL_REWARDS_WALLET_UPDATED_FALLBACK_REPLY.English("0xabc"),
    ).toBe("Rewards wallet updated to 0xabc.");
    expect(
      t(
        i18n.REFERRAL_REWARDS_WALLET_UPDATED_FALLBACK_REPLY,
        "SimplifiedChinese",
      )("0xabc"),
    ).toContain("奖励钱包已更新");

    // /wallet — security status + empty-state hints
    expect(i18n.WALLET_STATUS_PIN_NOT_SET.English).toBe("• PIN: not set");
    expect(
      t(i18n.WALLET_STATUS_PIN_NOT_SET, "SimplifiedChinese"),
    ).toContain("PIN：未设置");
    expect(i18n.WALLET_STATUS_PIN_SET.English).toBe("• PIN: set");
    expect(
      t(i18n.WALLET_STATUS_PIN_SET, "SimplifiedChinese"),
    ).toContain("PIN：已设置");
    expect(i18n.WALLET_STATUS_PIN_RESET_READY.English).toContain(
      "Complete PIN reset",
    );
    expect(
      t(i18n.WALLET_STATUS_PIN_RESET_READY, "SimplifiedChinese"),
    ).toContain("完成 PIN 重置");
    expect(i18n.WALLET_STATUS_PIN_RESET_PENDING.English("3h")).toContain(
      "reset requested, available in ~3h",
    );
    expect(
      t(i18n.WALLET_STATUS_PIN_RESET_PENDING, "SimplifiedChinese")("3h"),
    ).toContain("已申请重置，约 3h 后可用");
    expect(i18n.WALLET_STATUS_WITHDRAW_LOCK_OFF.English).toBe(
      "• Withdrawal lock: off",
    );
    expect(
      t(i18n.WALLET_STATUS_WITHDRAW_LOCK_OFF, "SimplifiedChinese"),
    ).toContain("提币锁定：关闭");
    expect(i18n.WALLET_STATUS_WITHDRAW_LOCK_ON.English).toBe(
      "• Withdrawal lock: on",
    );
    expect(
      t(i18n.WALLET_STATUS_WITHDRAW_LOCK_ON, "SimplifiedChinese"),
    ).toContain("提币锁定：开启");
    expect(i18n.WALLET_EMPTY_CREATE_HINT.English).toContain("Create");
    expect(
      t(i18n.WALLET_EMPTY_CREATE_HINT, "SimplifiedChinese"),
    ).toContain("新建");
    expect(i18n.WALLET_EMPTY_IMPORT_HINT.English).toContain("Privy");
    expect(
      t(i18n.WALLET_EMPTY_IMPORT_HINT, "SimplifiedChinese"),
    ).toContain("Privy");
    expect(i18n.WALLET_LIST_HEADER.English(1, 10)).toBe("Wallets (1/10)");
    expect(t(i18n.WALLET_LIST_HEADER, "SimplifiedChinese")(1, 10)).toBe(
      "钱包（1/10）",
    );
    expect(i18n.WALLET_UNLABELED_PLACEHOLDER.English).toBe("(unlabeled)");
    expect(
      t(i18n.WALLET_UNLABELED_PLACEHOLDER, "SimplifiedChinese"),
    ).toBe("（未命名）");
    expect(i18n.WALLET_ACTIVE_LEGEND.English).toContain("active wallet");
    expect(
      t(i18n.WALLET_ACTIVE_LEGEND, "SimplifiedChinese"),
    ).toContain("活跃钱包");
  });

  it("renders newly extracted /track copy", () => {
    expect(i18n.TRACK_RECENT_TRADES_HEADER_HTML.English).toBe(
      "<b>Recent trades</b>",
    );
    expect(i18n.TRACK_NO_TRADES_YET_HTML.English).toBe(
      "<i>No trades yet.</i>",
    );
    const rel = i18n.TRACK_RELATIVE_TIME.English;
    expect(rel.justNow).toBe("just now");
    expect(rel.seconds(5)).toBe("5s ago");
    expect(rel.minutes(2)).toBe("2m ago");
    expect(rel.hours(3)).toBe("3h ago");
    expect(rel.days(1)).toBe("1d ago");
  });

  it("every entry carries the default language; additional locales are allowed", () => {
    for (const [key, value] of Object.entries(i18n)) {
      if (
        key === "DEFAULT_LANGUAGE" ||
        key === "HELP_HEADER_PLACEHOLDER_TOKEN" ||
        key === "getCtxLanguage" ||
        key === "t" ||
        typeof value === "function"
      ) {
        continue;
      }
      const langKeys = Object.keys(value as Record<string, unknown>);
      // English is required (the fallback every locale resolves through);
      // additional locales (Spanish, etc.) can be added per-entry without
      // touching the rest of the dictionary. Asserting `toContain` instead
      // of `toEqual` lets a translator ship partial coverage without
      // tripping this guard.
      expect(
        langKeys,
        `entry ${key} is missing the default language`,
      ).toContain(i18n.DEFAULT_LANGUAGE);
      expect(
        langKeys.length,
        `entry ${key} has no language keys`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("t() resolver with partial overrides", () => {
  // The dictionary itself ships English-only today, so partial-override
  // behaviour is exercised against synthetic entries that mirror the
  // production shape (a `Localised<T>` record with English required and
  // any other locale optional).
  it("returns the English value when no override is provided", () => {
    const entry: Localised<string> = { English: "Refresh" };
    expect(t(entry)).toBe("Refresh");
  });

  it("falls back to English when the requested locale is missing", () => {
    const entry: Localised<string> = { English: "Refresh" };
    expect(t(entry, "English")).toBe("Refresh");
  });

  it("returns the locale-specific override when present", () => {
    // Cast widens `Language` so the test can demonstrate a future locale
    // without modifying the production type union.
    const entry = {
      English: "Refresh",
      Spanish: "Actualizar",
    } as unknown as Localised<string>;
    expect(t(entry, "Spanish" as i18n.Language)).toBe("Actualizar");
  });

  it("falls back per-entry — partial coverage works without translating the rest", () => {
    const translated = {
      English: "Refresh",
      Spanish: "Actualizar",
    } as unknown as Localised<string>;
    const untranslated: Localised<string> = { English: "Back" };
    const spanish = "Spanish" as i18n.Language;
    expect(t(translated, spanish)).toBe("Actualizar");
    // No Spanish key → English fallback.
    expect(t(untranslated, spanish)).toBe("Back");
  });

  it("resolves parameterised entries and applies the locale override to the function", () => {
    const buy = {
      English: (amount: number) => `Buy ${amount} USDC`,
      Spanish: (amount: number) => `Comprar ${amount} USDC`,
    } as unknown as Localised<(amount: number) => string>;
    expect(t(buy)(20)).toBe("Buy 20 USDC");
    expect(t(buy, "Spanish" as i18n.Language)(20)).toBe("Comprar 20 USDC");
  });

  it("preserves direct .English access for callsites that haven't been migrated", () => {
    // Direct property reads bypass the resolver and always return the
    // canonical English copy — used by callsites that are intentionally
    // locale-agnostic (logs, fixed-format strings, tests).
    expect(i18n.REFRESH_BUTTON_TEXT.English).toBe("🔄 Refresh");
    expect(t(i18n.REFRESH_BUTTON_TEXT)).toBe(i18n.REFRESH_BUTTON_TEXT.English);
  });
});

describe("Simplified Chinese locale", () => {
  it("declares SimplifiedChinese as a valid Language", () => {
    // Pure type-level assertion via assignment — if the union ever
    // drops `SimplifiedChinese`, this stops compiling.
    const lang: i18n.Language = "SimplifiedChinese";
    expect(lang).toBe("SimplifiedChinese");
  });

  it("renders static entries in Simplified Chinese", () => {
    expect(t(i18n.BACK_BUTTON_TEXT, "SimplifiedChinese")).toBe("← 返回");
    expect(t(i18n.HOME_BUTTON_TEXT, "SimplifiedChinese")).toBe("🏠 主页");
    expect(t(i18n.START_BUY_BUTTON, "SimplifiedChinese")).toBe("买入");
    expect(t(i18n.OUTAGE_REPLY, "SimplifiedChinese")).toContain("暂时无法");
  });

  it("renders parameterised entries in Simplified Chinese", () => {
    expect(t(i18n.BUY_AMOUNT_BUTTON, "SimplifiedChinese")(20)).toBe(
      "买入 20 USDC",
    );
    expect(t(i18n.SELL_PERCENT_BUTTON, "SimplifiedChinese")(50)).toBe(
      "卖出 50%",
    );
  });

  it("preserves brand names verbatim in Simplified Chinese translations", () => {
    // Brand names listed in the i18n.ts header must never be translated.
    // Sample-check a few canonical entries — the `t()` resolver should
    // emit the brand strings exactly as written, no Chinese variants.
    const help = t(i18n.HELP_OVERVIEW_HTML, "SimplifiedChinese")([
      "wallet",
    ]);
    expect(help).toContain("alt.fun");
    expect(help).toContain("BounceTech");
    expect(help).toContain("HyperSwap");
    expect(help).toContain("USDC");
    expect(help).toContain("HYPE");
    expect(help).toContain("LT");
    const trading = t(i18n.HELP_TRADING_HTML, "SimplifiedChinese");
    expect(trading).toContain("/buy");
    expect(trading).toContain("/sell");
    expect(trading).toContain("BounceTech");
    expect(trading).toContain("InsufficientBalance");
    const welcome = t(i18n.START_WELCOME_LEAD, "SimplifiedChinese")(
      "CortisolBot",
    );
    expect(welcome).toContain("HyperEVM");
    expect(welcome).toContain("CortisolBot");
    expect(welcome).toContain("alt.fun");
  });
});

describe("getCtxLanguage", () => {
  it("returns the session language when set", () => {
    expect(
      i18n.getCtxLanguage({ session: { language: "SimplifiedChinese" } }),
    ).toBe("SimplifiedChinese");
    expect(i18n.getCtxLanguage({ session: { language: "English" } })).toBe(
      "English",
    );
  });

  it("falls back to English when the session has no language picked", () => {
    expect(i18n.getCtxLanguage({ session: {} })).toBe("English");
    expect(i18n.getCtxLanguage({})).toBe("English");
    expect(i18n.getCtxLanguage(undefined)).toBe("English");
  });

  it("falls back to English when reading `session` throws (replay / channel ctx)", () => {
    const ctx = {
      get session() {
        throw new Error("session not bound on this ctx flavor");
      },
    } as { session?: { language?: i18n.Language } };
    expect(i18n.getCtxLanguage(ctx)).toBe("English");
  });
});
