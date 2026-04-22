import { describe, it, expect } from "vitest";

import {
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKEN_SYMBOL_LENGTH,
  isValidTokenName,
  isValidTokenSymbol,
  utf8ByteLength,
} from "../constants/validation.js";

describe("utf8ByteLength", () => {
  it("matches JS length for ASCII", () => {
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength("A")).toBe(1);
    expect(utf8ByteLength("HYPERBULL")).toBe(9);
  });

  it("counts bytes for multi-byte characters", () => {
    expect(utf8ByteLength("🚀")).toBe(4);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("中")).toBe(3);
  });

  it("counts combined runs correctly", () => {
    // "A🚀" = 1 + 4 bytes but JS string length is 3 (surrogate pair)
    expect("A🚀".length).toBe(3);
    expect(utf8ByteLength("A🚀")).toBe(5);
  });
});

describe("isValidTokenName", () => {
  it("accepts a single ASCII char", () => {
    expect(isValidTokenName("A")).toBe(true);
  });

  it("accepts a name exactly at the byte limit", () => {
    expect(isValidTokenName("A".repeat(MAX_TOKEN_NAME_LENGTH))).toBe(true);
  });

  it("rejects empty names", () => {
    expect(isValidTokenName("")).toBe(false);
  });

  it("rejects names that exceed the byte limit", () => {
    expect(isValidTokenName("A".repeat(MAX_TOKEN_NAME_LENGTH + 1))).toBe(false);
  });

  it("counts emoji against the byte budget, not the character count", () => {
    // 9 emoji = 36 bytes > 34, but JS length is 18. Must reject.
    expect(isValidTokenName("🚀".repeat(9))).toBe(false);
  });
});

describe("isValidTokenSymbol", () => {
  it("accepts a single ASCII char", () => {
    expect(isValidTokenSymbol("A")).toBe(true);
  });

  it("accepts a symbol exactly at the byte limit", () => {
    expect(isValidTokenSymbol("A".repeat(MAX_TOKEN_SYMBOL_LENGTH))).toBe(true);
  });

  it("rejects empty symbols", () => {
    expect(isValidTokenSymbol("")).toBe(false);
  });

  it("rejects symbols that exceed the byte limit", () => {
    expect(isValidTokenSymbol("A".repeat(MAX_TOKEN_SYMBOL_LENGTH + 1))).toBe(false);
  });

  it("rejects 3 emoji (12 bytes > 10) even though JS length is 6", () => {
    expect(isValidTokenSymbol("🚀🚀🚀")).toBe(false);
  });
});
