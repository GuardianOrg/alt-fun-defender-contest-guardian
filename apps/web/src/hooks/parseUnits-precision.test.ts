import { parseUnits } from "viem";
import { describe, expect, it } from "vitest";

const USDC_DECIMALS = 6;

describe("parseUnits precision guard (toFixed)", () => {
  it("handles excess decimal precision without throwing", () => {
    const value = 20.000_000_1;
    expect(() =>
      parseUnits(value.toFixed(USDC_DECIMALS), USDC_DECIMALS),
    ).not.toThrow();
    expect(parseUnits(value.toFixed(USDC_DECIMALS), USDC_DECIMALS)).toBe(
      20_000_000n,
    );
  });

  it("handles scientific-notation small numbers without throwing", () => {
    const value = 1e-7;
    expect(() =>
      parseUnits(value.toFixed(USDC_DECIMALS), USDC_DECIMALS),
    ).not.toThrow();
    expect(parseUnits(value.toFixed(USDC_DECIMALS), USDC_DECIMALS)).toBe(0n);
  });

  it("preserves normal values exactly", () => {
    expect(parseUnits((5.25).toFixed(USDC_DECIMALS), USDC_DECIMALS)).toBe(
      5_250_000n,
    );
  });

  it("rounds rather than errors on 7+ decimal digits", () => {
    const value = 5.123_456_789;
    expect(parseUnits(value.toFixed(USDC_DECIMALS), USDC_DECIMALS)).toBe(
      5_123_457n,
    );
  });
});
