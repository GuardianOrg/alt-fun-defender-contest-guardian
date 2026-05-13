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

describe("Close row", () => {
  it("buy keyboard ends with a Close row", () => {
    const rows = buildBuyTokenKeyboard(TOKEN, 20);
    const last = rows[rows.length - 1]!;
    expect(last.map((b) => b.text)).toEqual(["Close"]);
    expect((last[0] as { callback_data: string }).callback_data).toBe("cls");
  });

  it("sell keyboard ends with a Close row", () => {
    const rows = buildSellTokenKeyboard(TOKEN);
    const last = rows[rows.length - 1]!;
    expect(last.map((b) => b.text)).toEqual(["Close"]);
    expect((last[0] as { callback_data: string }).callback_data).toBe("cls");
  });
});

describe("buildSellTokenKeyboard", () => {
  it("renders Sell 10% / 25% / 50% / 100% buttons", () => {
    const labels = flatLabels(buildSellTokenKeyboard(TOKEN));
    expect(labels).toContain("Sell 10%");
    expect(labels).toContain("Sell 25%");
    expect(labels).toContain("Sell 50%");
    expect(labels).toContain("Sell 100%");
  });

  it("encodes the percent as a positional callback arg", () => {
    const cbs = flatCallbacks(buildSellTokenKeyboard(TOKEN));
    expect(cbs).toContain(`${SELL_TOKEN_CMD.sellPercent}:${TOKEN}:10`);
    expect(cbs).toContain(`${SELL_TOKEN_CMD.sellPercent}:${TOKEN}:25`);
    expect(cbs).toContain(`${SELL_TOKEN_CMD.sellPercent}:${TOKEN}:50`);
    expect(cbs).toContain(`${SELL_TOKEN_CMD.sellPercent}:${TOKEN}:100`);
  });

  it("renders Sell X% / Refresh buttons", () => {
    const labels = flatLabels(buildSellTokenKeyboard(TOKEN));
    expect(labels).toContain("Sell X%");
    expect(labels.some((t) => t.includes("Refresh"))).toBe(true);
  });

  it("Sell X% callback enters the custom-percent flow (no amount in payload)", () => {
    const cbs = flatCallbacks(buildSellTokenKeyboard(TOKEN));
    expect(cbs).toContain(`${SELL_TOKEN_CMD.sellCustomPercent}:${TOKEN}`);
  });
});
