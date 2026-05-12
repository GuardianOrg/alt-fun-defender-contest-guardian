import { describe, expect, it } from "vitest";

import { findLeveragedTokenByAddress } from "./useLeveragedTokens";

import type { LiveLeveragedToken } from "@launchpad/shared";

function makeLT(overrides: Partial<LiveLeveragedToken> = {}): LiveLeveragedToken {
  return {
    address: "0x0000000000000000000000000000000000000001",
    symbol: "HYPE2L",
    name: "HYPE 2x Long",
    targetAsset: "HYPE",
    targetLeverage: 2,
    isLong: true,
    decimals: 18,
    mintPaused: false,
    exchangeRate: "1000000000000000000",
    totalSupply: "1000000",
    totalAssets: "1000000",
    ...overrides,
  };
}

describe("findLeveragedTokenByAddress", () => {
  const checksummed = "0xAaBbCcDdEeFf00112233445566778899AaBbCcDd" as const;
  const lt = makeLT({ address: checksummed });

  it("returns the LT when the address matches", () => {
    const result = findLeveragedTokenByAddress([lt], checksummed);
    expect(result).toBe(lt);
  });

  it("matches case-insensitively against the directory address", () => {
    // The Postgres `tokens.ltPair` column stores the address lowercased,
    // but BounceTech's indexing API returns a checksummed string — without
    // the toLowerCase() on both sides the lookup would silently miss for
    // every token launched after the schema migration that lowercased
    // `ltPair`. Pin that contract here.
    const result = findLeveragedTokenByAddress([lt], checksummed.toLowerCase());
    expect(result).toBe(lt);
  });

  it("returns undefined when no LT matches", () => {
    const result = findLeveragedTokenByAddress(
      [lt],
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when the directory is empty", () => {
    expect(findLeveragedTokenByAddress([], checksummed)).toBeUndefined();
  });

  it("returns undefined when the directory hasn't loaded yet", () => {
    expect(findLeveragedTokenByAddress(undefined, checksummed)).toBeUndefined();
  });

  it("returns undefined when the caller has no address", () => {
    expect(findLeveragedTokenByAddress([lt], undefined)).toBeUndefined();
    expect(findLeveragedTokenByAddress([lt], "")).toBeUndefined();
  });

  it("scans across multiple LTs to find the right one", () => {
    const other = makeLT({
      address: "0x1111111111111111111111111111111111111111",
      symbol: "ETH3L",
    });
    const target = makeLT({
      address: "0x2222222222222222222222222222222222222222",
      symbol: "BTC5L",
    });
    const result = findLeveragedTokenByAddress(
      [other, target],
      "0x2222222222222222222222222222222222222222",
    );
    expect(result).toBe(target);
  });
});
