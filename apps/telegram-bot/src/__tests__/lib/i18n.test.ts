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
      "t",
    ]);
    const entries = Object.entries(i18n).filter(
      ([key]) => !NON_ENTRY_EXPORTS.has(key),
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

  it("renders the buy card loading text with a short address", () => {
    expect(i18n.BUY_CARD_LOADING_HTML.English("0x1234…abcd")).toBe(
      "⏳ Loading <code>0x1234…abcd</code>…",
    );
  });

  it("renders the sell buffer banner with the formatted max and minimum", () => {
    const body = i18n.SELL_BUFFER_BELOW_MIN_HTML.English(8.5, 12);
    expect(body).toContain("≈$8.50");
    expect(body).toContain("$12 minimum");
  });

  it("renders newly extracted wallet toasts and prompts", () => {
    expect(i18n.WALLET_RENAME_LENGTH_INVALID_REPLY.English(32)).toBe(
      "Label must be 1–32 characters. Rename cancelled.",
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
      "Send your current 6-digit PIN to authorise PIN change.",
    );
    expect(i18n.PIN_AUTHORISE_THE_PROMPT.English("export")).toBe(
      "Send your 6-digit PIN to authorise the export.",
    );
    expect(i18n.PIN_LOCKED_REPLY.English(5, "Export")).toBe(
      "Too many wrong PIN attempts — locked for ~5 min. Export cancelled.",
    );
    expect(i18n.PIN_WRONG_RETRY_REPLY.English(3)).toBe(
      "Wrong PIN. 3 attempts remaining. Try again.",
    );
    expect(i18n.PIN_STATE_LOST_REPLY.English("/wallet → Export key")).toBe(
      "PIN state lost — re-run /wallet → Export key.",
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
    expect(i18n.POSITIONS_BUY_TICKER_BUTTON.English("WIF")).toBe("Buy WIF");
    expect(i18n.POSITIONS_SELL_TICKER_BUTTON.English("WIF")).toBe("Sell WIF");
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
        key === "t"
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
