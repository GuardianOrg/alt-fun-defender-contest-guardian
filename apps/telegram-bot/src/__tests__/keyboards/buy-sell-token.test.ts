import { describe, expect, it } from "vitest";

import {
  BUY_TOKEN_CMD,
  DEFAULT_BUY_PRESETS_USDC,
  DEFAULT_SELL_PRESETS_PCT,
  SELL_TOKEN_CMD,
  buildBuyTokenKeyboard,
  buildSellTokenKeyboard,
  normaliseBuyPresets,
  normaliseSellPresets,
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
  it("renders one Buy button per preset slot", () => {
    const labels = flatLabels(
      buildBuyTokenKeyboard(TOKEN, [...DEFAULT_BUY_PRESETS_USDC]),
    );
    for (const amount of DEFAULT_BUY_PRESETS_USDC) {
      expect(labels).toContain(`Buy ${amount} USDC`);
    }
  });

  it("encodes the preset amount directly in the callback payload (issue #818)", () => {
    const cbs = flatCallbacks(
      buildBuyTokenKeyboard(TOKEN, [...DEFAULT_BUY_PRESETS_USDC]),
    );
    for (const amount of DEFAULT_BUY_PRESETS_USDC) {
      expect(cbs).toContain(`${BUY_TOKEN_CMD.buyPreset}:${TOKEN}:${amount}`);
    }
  });

  it("reflects a customised preset list verbatim", () => {
    const custom = [25, 50, 75, 200, 500];
    const labels = flatLabels(buildBuyTokenKeyboard(TOKEN, custom));
    for (const amount of custom) {
      expect(labels).toContain(`Buy ${amount} USDC`);
    }
  });

  it("keeps the Buy X USDC + Refresh buttons", () => {
    const labels = flatLabels(
      buildBuyTokenKeyboard(TOKEN, [...DEFAULT_BUY_PRESETS_USDC]),
    );
    expect(labels).toContain("Buy X USDC");
    expect(labels.some((t) => t.includes("Refresh"))).toBe(true);
  });
});

describe("2-column layout (prevent Telegram label truncation)", () => {
  it("buy keyboard packs 5 presets + custom into three rows of two, then Refresh, then Back/Home", () => {
    const rows = buildBuyTokenKeyboard(TOKEN, [...DEFAULT_BUY_PRESETS_USDC]);
    expect(rows).toHaveLength(5);
    expect(rows[0]!.map((b) => b.text)).toEqual(["Buy 20 USDC", "Buy 40 USDC"]);
    expect(rows[1]!.map((b) => b.text)).toEqual([
      "Buy 60 USDC",
      "Buy 80 USDC",
    ]);
    expect(rows[2]!.map((b) => b.text)).toEqual(["Buy 100 USDC", "Buy X USDC"]);
    expect(rows[3]!.map((b) => b.text)).toEqual(["🔄 Refresh"]);
    expect(rows[4]!.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
  });

  it("sell keyboard packs 5 presets + custom into three rows of two, then Refresh, then Back/Home", () => {
    const rows = buildSellTokenKeyboard(TOKEN, [...DEFAULT_SELL_PRESETS_PCT]);
    expect(rows).toHaveLength(5);
    expect(rows[0]!.map((b) => b.text)).toEqual(["Sell 10%", "Sell 25%"]);
    expect(rows[1]!.map((b) => b.text)).toEqual(["Sell 50%", "Sell 75%"]);
    expect(rows[2]!.map((b) => b.text)).toEqual(["Sell 100%", "Sell X%"]);
    expect(rows[3]!.map((b) => b.text)).toEqual(["🔄 Refresh"]);
    expect(rows[4]!.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
  });

  it("buy keyboard caps each row at 2 buttons regardless of preset amount width", () => {
    const rows = buildBuyTokenKeyboard(TOKEN, [1000, 2500, 5000, 7500, 10000]);
    for (const row of rows.slice(0, -2)) {
      expect(row.length).toBeLessThanOrEqual(2);
    }
  });
});

describe("Back/Home row", () => {
  it("buy keyboard ends with a Back/Home row", () => {
    const rows = buildBuyTokenKeyboard(TOKEN, [...DEFAULT_BUY_PRESETS_USDC]);
    const last = rows[rows.length - 1]!;
    expect(last.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
    expect((last[0] as { callback_data: string }).callback_data).toBe("nav:b");
    expect((last[1] as { callback_data: string }).callback_data).toBe("nav:h");
  });

  it("sell keyboard ends with a Back/Home row", () => {
    const rows = buildSellTokenKeyboard(TOKEN, [...DEFAULT_SELL_PRESETS_PCT]);
    const last = rows[rows.length - 1]!;
    expect(last.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
    expect((last[0] as { callback_data: string }).callback_data).toBe("nav:b");
    expect((last[1] as { callback_data: string }).callback_data).toBe("nav:h");
  });
});

describe("buildSellTokenKeyboard", () => {
  it("renders one Sell button per default preset (5 slots, includes 75%)", () => {
    const labels = flatLabels(
      buildSellTokenKeyboard(TOKEN, [...DEFAULT_SELL_PRESETS_PCT]),
    );
    expect(labels).toContain("Sell 10%");
    expect(labels).toContain("Sell 25%");
    expect(labels).toContain("Sell 50%");
    expect(labels).toContain("Sell 75%");
    expect(labels).toContain("Sell 100%");
  });

  it("encodes the percent as a positional callback arg", () => {
    const cbs = flatCallbacks(
      buildSellTokenKeyboard(TOKEN, [...DEFAULT_SELL_PRESETS_PCT]),
    );
    for (const pct of DEFAULT_SELL_PRESETS_PCT) {
      expect(cbs).toContain(`${SELL_TOKEN_CMD.sellPercent}:${TOKEN}:${pct}`);
    }
  });

  it("reflects a customised preset list verbatim", () => {
    const custom = [5, 15, 33, 66, 90];
    const labels = flatLabels(buildSellTokenKeyboard(TOKEN, custom));
    for (const pct of custom) {
      expect(labels).toContain(`Sell ${pct}%`);
    }
  });

  it("renders Sell X% / Refresh buttons", () => {
    const labels = flatLabels(
      buildSellTokenKeyboard(TOKEN, [...DEFAULT_SELL_PRESETS_PCT]),
    );
    expect(labels).toContain("Sell X%");
    expect(labels.some((t) => t.includes("Refresh"))).toBe(true);
  });

  it("Sell X% callback enters the custom-percent flow (no amount in payload)", () => {
    const cbs = flatCallbacks(
      buildSellTokenKeyboard(TOKEN, [...DEFAULT_SELL_PRESETS_PCT]),
    );
    expect(cbs).toContain(`${SELL_TOKEN_CMD.sellCustomPercent}:${TOKEN}`);
  });
});

describe("normaliseBuyPresets (issue #818)", () => {
  it("returns the default 5-slot list when nothing is stored", () => {
    expect(normaliseBuyPresets(undefined, 20)).toEqual([20, 40, 60, 80, 100]);
  });

  it("lifts a legacy defaultBuyUsdc into slot 0 when no preset list exists", () => {
    expect(normaliseBuyPresets(undefined, 75)).toEqual([75, 40, 60, 80, 100]);
  });

  it("returns the stored 5-slot list when valid", () => {
    const stored = [25, 100, 250, 500, 1000];
    expect(normaliseBuyPresets(stored, 20)).toEqual(stored);
  });

  it("clamps any slot below MIN_USDC_BUY_AMOUNT up to the floor", () => {
    expect(normaliseBuyPresets([5, 40, 60, 80, 100], 20)).toEqual([
      20,
      40,
      60,
      80,
      100,
    ]);
  });
});

describe("normaliseSellPresets (issue #818)", () => {
  it("returns the default 5-slot list when nothing is stored", () => {
    expect(normaliseSellPresets(undefined)).toEqual([10, 25, 50, 75, 100]);
  });

  it("returns the stored list when each slot is in [1, 100]", () => {
    const stored = [5, 15, 33, 66, 90];
    expect(normaliseSellPresets(stored)).toEqual(stored);
  });

  it("replaces any out-of-range slot with the same-index default", () => {
    expect(normaliseSellPresets([0, 25, 200, 75, 100])).toEqual([
      10,
      25,
      50,
      75,
      100,
    ]);
  });
});
