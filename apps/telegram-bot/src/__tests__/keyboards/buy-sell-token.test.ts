import { describe, expect, it } from "vitest";

import {
  BUY_TOKEN_CMD,
  SELL_TOKEN_CMD,
  buildBuyTokenKeyboard,
  buildSellTokenKeyboard,
} from "../../keyboards/buy-sell-token.js";

const TOKEN = "0x1111111111111111111111111111111111111111";

interface ButtonShape {
  text: string;
  callback_data?: string;
}

const flatLabels = (rows: ButtonShape[][]): string[] =>
  rows.flat().map((b) => b.text);

const flatCallbacks = (rows: ButtonShape[][]): string[] =>
  rows.flat().map((b) => b.callback_data ?? "");

describe("buildBuyTokenKeyboard", () => {
  it("labels the first button with the session defaultBuyUsdc", () => {
    expect(flatLabels(buildBuyTokenKeyboard(TOKEN, 20))).toContain(
      "Buy 20 USDC",
    );
    expect(flatLabels(buildBuyTokenKeyboard(TOKEN, 250))).toContain(
      "Buy 250 USDC",
    );
  });

  it("first-button callback resolves at click time (no amount in payload)", () => {
    const callbacks = flatCallbacks(buildBuyTokenKeyboard(TOKEN, 75));
    const firstCb = callbacks[0]!;
    expect(firstCb.startsWith(`${BUY_TOKEN_CMD.buyDefault}:`)).toBe(true);
    expect(firstCb).not.toContain("75");
  });

  it("keeps the 100 / Custom / Refresh buttons intact", () => {
    const labels = flatLabels(buildBuyTokenKeyboard(TOKEN, 20));
    expect(labels).toContain("Buy 100 USDC");
    expect(labels).toContain("Buy X USDC");
    expect(labels.some((t) => t.includes("Refresh"))).toBe(true);
  });
});

describe("buildSellTokenKeyboard", () => {
  it("labels the first button with the session defaultBuyUsdc", () => {
    expect(flatLabels(buildSellTokenKeyboard(TOKEN, 20))).toContain(
      "Sell 20 USDC",
    );
    expect(flatLabels(buildSellTokenKeyboard(TOKEN, 250))).toContain(
      "Sell 250 USDC",
    );
  });

  it("first-button callback resolves at click time (no amount in payload)", () => {
    const callbacks = flatCallbacks(buildSellTokenKeyboard(TOKEN, 75));
    const firstCb = callbacks[0]!;
    expect(firstCb.startsWith(`${SELL_TOKEN_CMD.sellDefault}:`)).toBe(true);
    expect(firstCb).not.toContain("75");
  });

  it("keeps the Sell All / Custom / Refresh buttons intact", () => {
    const labels = flatLabels(buildSellTokenKeyboard(TOKEN, 20));
    expect(labels).toContain("Sell All");
    expect(labels).toContain("Sell X USDC");
    expect(labels.some((t) => t.includes("Refresh"))).toBe(true);
  });
});
