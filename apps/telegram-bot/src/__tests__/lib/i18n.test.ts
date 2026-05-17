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
