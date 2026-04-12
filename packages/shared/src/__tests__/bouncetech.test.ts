import { describe, it, expect } from "vitest";

import type { LiveLeveragedToken, LeveragedTokenInfo } from "../constants/bouncetech.js";
import {
  filterSupportedLTs,
  findLT,
  SUPPORTED_UNDERLYING_ASSETS,
  SUPPORTED_LEVERAGES,
} from "../constants/bouncetech.js";

function makeLiveLT(overrides: Partial<LiveLeveragedToken> = {}): LiveLeveragedToken {
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

function makeLTInfo(overrides: Partial<LeveragedTokenInfo> = {}): LeveragedTokenInfo {
  return {
    address: "0x0000000000000000000000000000000000000001",
    symbol: "HYPE2L",
    name: "HYPE 2x Long",
    targetAsset: "HYPE",
    targetLeverage: 2,
    isLong: true,
    decimals: 18,
    ...overrides,
  };
}

describe("filterSupportedLTs", () => {
  it("keeps LTs with supported asset and leverage", () => {
    const lts = [
      makeLiveLT({ targetAsset: "HYPE", targetLeverage: 2 }),
      makeLiveLT({ targetAsset: "ETH", targetLeverage: 3 }),
      makeLiveLT({ targetAsset: "BTC", targetLeverage: 5 }),
      makeLiveLT({ targetAsset: "SOL", targetLeverage: 2 }),
    ];
    const result = filterSupportedLTs(lts);
    expect(result).toHaveLength(4);
  });

  it("removes LTs with unsupported assets", () => {
    const lts = [
      makeLiveLT({ targetAsset: "HYPE", targetLeverage: 2 }),
      makeLiveLT({ targetAsset: "PAXG", targetLeverage: 2 }),
      makeLiveLT({ targetAsset: "DOGE", targetLeverage: 3 }),
    ];
    const result = filterSupportedLTs(lts);
    expect(result).toHaveLength(1);
    expect(result[0].targetAsset).toBe("HYPE");
  });

  it("removes LTs with unsupported leverages", () => {
    const lts = [
      makeLiveLT({ targetAsset: "HYPE", targetLeverage: 2 }),
      makeLiveLT({ targetAsset: "ETH", targetLeverage: 10 }),
      makeLiveLT({ targetAsset: "BTC", targetLeverage: 1 }),
    ];
    const result = filterSupportedLTs(lts);
    expect(result).toHaveLength(1);
    expect(result[0].targetAsset).toBe("HYPE");
  });

  it("returns empty array when no LTs match", () => {
    const lts = [
      makeLiveLT({ targetAsset: "PAXG", targetLeverage: 10 }),
    ];
    const result = filterSupportedLTs(lts);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(filterSupportedLTs([])).toHaveLength(0);
  });

  it("filters by both asset and leverage simultaneously", () => {
    const lts = [
      makeLiveLT({ targetAsset: "HYPE", targetLeverage: 10 }), // bad leverage
      makeLiveLT({ targetAsset: "PAXG", targetLeverage: 2 }), // bad asset
      makeLiveLT({ targetAsset: "HYPE", targetLeverage: 3 }), // good
    ];
    const result = filterSupportedLTs(lts);
    expect(result).toHaveLength(1);
    expect(result[0].targetAsset).toBe("HYPE");
    expect(result[0].targetLeverage).toBe(3);
  });
});

describe("findLT", () => {
  const lts: LeveragedTokenInfo[] = [
    makeLTInfo({ targetAsset: "HYPE", targetLeverage: 2, isLong: true }),
    makeLTInfo({ targetAsset: "HYPE", targetLeverage: 2, isLong: false }),
    makeLTInfo({ targetAsset: "ETH", targetLeverage: 3, isLong: true }),
    makeLTInfo({ targetAsset: "BTC", targetLeverage: 5, isLong: true }),
  ];

  it("finds an LT by asset, leverage, and direction", () => {
    const result = findLT(lts, "HYPE", 2, true);
    expect(result).toBeDefined();
    expect(result?.targetAsset).toBe("HYPE");
    expect(result?.targetLeverage).toBe(2);
    expect(result?.isLong).toBe(true);
  });

  it("distinguishes long from short", () => {
    const long = findLT(lts, "HYPE", 2, true);
    const short = findLT(lts, "HYPE", 2, false);
    expect(long).toBeDefined();
    expect(short).toBeDefined();
    expect(long?.isLong).toBe(true);
    expect(short?.isLong).toBe(false);
  });

  it("returns undefined when asset does not match", () => {
    expect(findLT(lts, "SOL", 2, true)).toBeUndefined();
  });

  it("returns undefined when leverage does not match", () => {
    expect(findLT(lts, "HYPE", 5, true)).toBeUndefined();
  });

  it("returns undefined when direction does not match", () => {
    expect(findLT(lts, "ETH", 3, false)).toBeUndefined();
  });

  it("returns undefined for empty list", () => {
    expect(findLT([], "HYPE", 2, true)).toBeUndefined();
  });
});

describe("SUPPORTED_UNDERLYING_ASSETS", () => {
  it("contains exactly HYPE, ETH, BTC, SOL", () => {
    expect([...SUPPORTED_UNDERLYING_ASSETS]).toEqual(["HYPE", "ETH", "BTC", "SOL"]);
  });
});

describe("SUPPORTED_LEVERAGES", () => {
  it("contains exactly 2, 3, 5", () => {
    expect([...SUPPORTED_LEVERAGES]).toEqual([2, 3, 5]);
  });
});
