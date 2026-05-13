import { describe, it, expect } from "vitest";

import type { TokenInfo } from "../../lib/api.js";
import {
  renderBuyTokenCardText,
  renderSellTokenCardText,
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
  ...overrides,
});

describe("renderBuyTokenCardText", () => {
  it("renders ticker, market cap, price, change, volume, and balance", () => {
    const text = renderBuyTokenCardText(baseToken(), 50_000_000n);
    expect(text).toContain("Test Token");
    expect(text).toContain("TEST");
    expect(text).toContain("24h Change");
    expect(text).toContain("+5.20%");
    expect(text).toContain("LT 24h");
    expect(text).toContain("Market Cap");
    expect(text).toContain("24h Volume");
    expect(text).toContain("$12.3K");
    expect(text).toContain("Your USDC Balance");
    expect(text).toContain("$50.00");
    expect(text).toContain("View on Explorer");
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
  });

  it("shows zero balance when user holds none", () => {
    const text = renderSellTokenCardText(baseToken(), 0n);
    expect(text).toContain("0 TEST");
  });
});
