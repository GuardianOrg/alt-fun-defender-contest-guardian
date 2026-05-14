import { describe, it, expect } from "vitest";

import type { TokenInfo } from "../../lib/api.js";
import {
  renderBuyTokenCardText,
  renderSellTokenCardText,
  renderTrackTokenCardText,
} from "../../lib/token-card.js";

const baseToken = (overrides: Partial<TokenInfo> = {}): TokenInfo => ({
  address: "0x1111111111111111111111111111111111111111",
  name: "Test Token",
  ticker: "TEST",
  priceUsd: 0.001,
  mcapUsd: 5000,
  change24h: 5.2,
  ltChange24h: 2.1,
  volume24hUsd: 12_345,
  curveFilled: 30,
  status: "curve",
  ltPair: null,
  underlying: "HYPE",
  leverage: 5,
  ltDirection: "long",
  ...overrides,
});

describe("renderBuyTokenCardText", () => {
  it("renders ticker, market cap, price, change, volume, and balance", () => {
    const text = renderBuyTokenCardText(baseToken(), 50_000_000n);
    expect(text).toContain("Test Token");
    expect(text).toContain("TEST");
    expect(text).toContain("24h Change");
    expect(text).toContain("+5.20%");
    expect(text).not.toContain("LT 24h");
    expect(text).toContain("Market Cap");
    expect(text).toContain("Price:");
    expect(text).toContain("24h Volume");
    expect(text.indexOf("Market Cap")).toBeLessThan(text.indexOf("Price:"));
    expect(text).toContain("$12.3K");
    expect(text).toContain("Your USDC Balance");
    expect(text).toContain("$50.00");
    expect(text).toContain("View on Explorer");
    expect(text).toContain("View on Alt Fun");
    expect(text).toContain(
      `https://alt.fun/token/0x1111111111111111111111111111111111111111`,
    );
    const explorerIdx = text.indexOf("View on Explorer");
    const altFunIdx = text.indexOf("View on Alt Fun");
    expect(altFunIdx).toBeGreaterThan(explorerIdx);
  });

  it("renders dash when volume24hUsd is null (older API response)", () => {
    const text = renderBuyTokenCardText(
      baseToken({ volume24hUsd: null }),
      null,
    );
    expect(text).toContain("24h Volume:</b> —");
  });
});

describe("renderSellTokenCardText", () => {
  it("renders holding text with USD equivalent and 24h volume", () => {
    const text = renderSellTokenCardText(baseToken(), 1_000_000_000_000_000_000n);
    expect(text).toContain("Test Token");
    expect(text).toContain("24h Volume");
    expect(text).toContain("$12.3K");
    expect(text).toContain("Your Balance");
    expect(text).toContain("TEST");
    expect(text).not.toContain("LT 24h");
    expect(text).toContain("Market Cap");
    expect(text).toContain("Price:");
    expect(text.indexOf("Market Cap")).toBeLessThan(text.indexOf("Price:"));
  });

  it("shows zero balance when user holds none", () => {
    const text = renderSellTokenCardText(baseToken(), 0n);
    expect(text).toContain("0 TEST");
  });

  it("includes Alt Fun link after Explorer link", () => {
    const text = renderSellTokenCardText(baseToken(), 0n);
    expect(text).toContain("View on Explorer");
    expect(text).toContain("View on Alt Fun");
    expect(text).toContain(
      `https://alt.fun/token/0x1111111111111111111111111111111111111111`,
    );
    expect(text.indexOf("View on Alt Fun")).toBeGreaterThan(
      text.indexOf("View on Explorer"),
    );
  });
});

describe("renderTrackTokenCardText", () => {
  it("includes Alt Fun link after Explorer link", () => {
    const text = renderTrackTokenCardText(baseToken());
    expect(text).toContain("View on Explorer");
    expect(text).toContain("View on Alt Fun");
    expect(text).toContain(
      `https://alt.fun/token/0x1111111111111111111111111111111111111111`,
    );
    expect(text.indexOf("View on Alt Fun")).toBeGreaterThan(
      text.indexOf("View on Explorer"),
    );
  });

  it("orders fields Market Cap → Price → 24h Change → 24h Volume and omits LT 24h", () => {
    const text = renderTrackTokenCardText(baseToken());
    expect(text).not.toContain("LT 24h");
    const mcapIdx = text.indexOf("Market Cap");
    const priceIdx = text.indexOf("Price:");
    const changeIdx = text.indexOf("24h Change");
    const volumeIdx = text.indexOf("24h Volume");
    expect(mcapIdx).toBeGreaterThan(-1);
    expect(priceIdx).toBeGreaterThan(mcapIdx);
    expect(changeIdx).toBeGreaterThan(priceIdx);
    expect(volumeIdx).toBeGreaterThan(changeIdx);
  });

  it("still omits LT 24h even when ltChange24h is present (matches buy/sell cards)", () => {
    const text = renderTrackTokenCardText(baseToken({ ltChange24h: 8.4 }));
    expect(text).not.toContain("LT 24h");
    expect(text).not.toContain("+8.40%");
  });
});

describe("header LT symbol (issue #820)", () => {
  const expectHeader = (text: string, expected: string) => {
    expect(text.split("\n")[0]).toBe(expected);
  };

  it("renders ticker + LT symbol on the buy card", () => {
    const text = renderBuyTokenCardText(baseToken(), 0n);
    expectHeader(
      text,
      "<b>Test Token</b> (<code>TEST</code> / <code>HYPE5L</code>)",
    );
  });

  it("renders ticker + LT symbol on the sell card", () => {
    const text = renderSellTokenCardText(baseToken(), 0n);
    expectHeader(
      text,
      "<b>Test Token</b> (<code>TEST</code> / <code>HYPE5L</code>)",
    );
  });

  it("renders ticker + LT symbol on the track card", () => {
    const text = renderTrackTokenCardText(baseToken());
    expectHeader(
      text,
      "<b>Test Token</b> (<code>TEST</code> / <code>HYPE5L</code>)",
    );
  });

  it("uses S suffix for short LT", () => {
    const text = renderTrackTokenCardText(
      baseToken({ underlying: "ETH", leverage: 3, ltDirection: "short" }),
    );
    expectHeader(
      text,
      "<b>Test Token</b> (<code>TEST</code> / <code>ETH3S</code>)",
    );
  });

  it("falls back to bare ticker when underlying is missing (older api)", () => {
    const text = renderTrackTokenCardText(baseToken({ underlying: null }));
    expectHeader(text, "<b>Test Token</b> (<code>TEST</code>)");
  });

  it("falls back to bare ticker when leverage is missing", () => {
    const text = renderTrackTokenCardText(baseToken({ leverage: null }));
    expectHeader(text, "<b>Test Token</b> (<code>TEST</code>)");
  });

  it("falls back to bare ticker when ltDirection is missing", () => {
    const text = renderTrackTokenCardText(baseToken({ ltDirection: null }));
    expectHeader(text, "<b>Test Token</b> (<code>TEST</code>)");
  });

  it("falls back to bare ticker on an unrecognised direction", () => {
    const text = renderTrackTokenCardText(
      baseToken({ ltDirection: "neutral" }),
    );
    expectHeader(text, "<b>Test Token</b> (<code>TEST</code>)");
  });
});
