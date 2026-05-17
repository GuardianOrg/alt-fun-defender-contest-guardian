import { describe, expect, it } from "vitest";

import * as i18n from "../../lib/i18n.js";

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
    const entries = Object.entries(i18n).filter(
      ([key]) => key !== "DEFAULT_LANGUAGE" && key !== "HELP_HEADER_PLACEHOLDER_TOKEN",
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

  it("every static-string entry has a stable language key set", () => {
    for (const [key, value] of Object.entries(i18n)) {
      if (key === "DEFAULT_LANGUAGE" || key === "HELP_HEADER_PLACEHOLDER_TOKEN") {
        continue;
      }
      const langKeys = Object.keys(value as Record<string, unknown>);
      // Today the dictionary only ships English; this assertion locks in
      // the shape so adding a locale forces every entry to be translated.
      expect(langKeys, `entry ${key} has unexpected language keys`).toEqual([
        "English",
      ]);
    }
  });
});
