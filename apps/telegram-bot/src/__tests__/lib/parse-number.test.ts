import { describe, expect, it } from "vitest";

import {
  MAX_USDC_AMOUNT,
  parseUserAmount,
} from "../../lib/parse-number.js";

describe("parseUserAmount", () => {
  it("parses a plain positive number", () => {
    expect(parseUserAmount("50", { max: 1000 })).toBe(50);
  });

  it("strips $ and , separators", () => {
    expect(parseUserAmount("$1,234.56", { max: 10_000 })).toBe(1234.56);
  });

  it("trims surrounding whitespace", () => {
    expect(parseUserAmount("  42  ", { max: 100 })).toBe(42);
  });

  it("rejects empty / whitespace-only input", () => {
    expect(parseUserAmount("", { max: 100 })).toBeNull();
    expect(parseUserAmount("   ", { max: 100 })).toBeNull();
    expect(parseUserAmount("$,", { max: 100 })).toBeNull();
  });

  it("rejects non-numeric text", () => {
    expect(parseUserAmount("abc", { max: 100 })).toBeNull();
    expect(parseUserAmount("1.2.3", { max: 100 })).toBeNull();
    expect(parseUserAmount("1 2", { max: 100 })).toBeNull();
  });

  it("rejects zero and negative values", () => {
    expect(parseUserAmount("0", { max: 100 })).toBeNull();
    expect(parseUserAmount("-5", { max: 100 })).toBeNull();
  });

  it("rejects exponent inputs that overflow to Infinity", () => {
    // `Number("1e400") === Infinity` — the bug the parser exists to
    // prevent. Must not leak through to `Math.round(x * 1_000_000)` /
    // `BigInt(...)`.
    expect(parseUserAmount("1e400", { max: MAX_USDC_AMOUNT })).toBeNull();
  });

  it("rejects literal Infinity / NaN spellings", () => {
    expect(parseUserAmount("Infinity", { max: MAX_USDC_AMOUNT })).toBeNull();
    expect(parseUserAmount("-Infinity", { max: MAX_USDC_AMOUNT })).toBeNull();
    expect(parseUserAmount("NaN", { max: MAX_USDC_AMOUNT })).toBeNull();
  });

  it("rejects values past Number.MAX_SAFE_INTEGER", () => {
    // Past `MAX_SAFE_INTEGER`, `Math.round(x * 1_000_000)` loses
    // precision and the resulting `BigInt` no longer matches what the
    // user typed.
    const overflow = String(Number.MAX_SAFE_INTEGER) + "0";
    expect(parseUserAmount(overflow, { max: Number.MAX_VALUE })).toBeNull();
  });

  it("rejects values past the caller's max bound", () => {
    expect(parseUserAmount("101", { max: 100 })).toBeNull();
    // Boundary: exactly at max is accepted, just over is not.
    expect(parseUserAmount("100", { max: 100 })).toBe(100);
    expect(parseUserAmount("100.0001", { max: 100 })).toBeNull();
  });

  it("accepts large but bounded MAX_USDC_AMOUNT inputs", () => {
    expect(
      parseUserAmount(String(MAX_USDC_AMOUNT), { max: MAX_USDC_AMOUNT }),
    ).toBe(MAX_USDC_AMOUNT);
  });

  it("guards the buy-fee multiplication from overflow", () => {
    // The original `amount * (1 + COMBINED_FEE_RATE)` overflowed to
    // `Infinity` for huge inputs and then the downstream
    // `BigInt(Math.round(amount * 1_000_000))` threw `RangeError`.
    // After parsing through the bounded helper, the math stays inside
    // safe-integer territory and serialises cleanly to bigint.
    const parsed = parseUserAmount("1e400", { max: MAX_USDC_AMOUNT });
    expect(parsed).toBeNull();
    // Sanity: a parsed bounded value survives the same pipeline.
    const ok = parseUserAmount(String(MAX_USDC_AMOUNT), {
      max: MAX_USDC_AMOUNT,
    });
    expect(ok).not.toBeNull();
    const totalNeeded = (ok ?? 0) * 1.01;
    expect(Number.isFinite(totalNeeded)).toBe(true);
    expect(() =>
      BigInt(Math.round((ok ?? 0) * 1_000_000)),
    ).not.toThrow();
  });
});
