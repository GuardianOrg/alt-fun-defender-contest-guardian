import { describe, it, expect } from "vitest";

import type {
  LiveLeveragedToken,
  LeveragedTokenInfo,
} from "../constants/bouncetech.js";
import {
  filterSupportedLTs,
  findLT,
  getAssetDisplayName,
  getHyperliquidDex,
  HYPERLIQUID_XYZ_DEX,
  isSupportedUnderlying,
  SUPPORTED_UNDERLYING_ASSETS,
  SUPPORTED_LEVERAGES,
} from "../constants/bouncetech.js";

function makeLiveLT(
  overrides: Partial<LiveLeveragedToken> = {},
): LiveLeveragedToken {
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
    baseAssetBalance: "0",
    ...overrides,
  };
}

function makeLTInfo(
  overrides: Partial<LeveragedTokenInfo> = {},
): LeveragedTokenInfo {
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

  it("keeps LTs across the full crypto + xyz: equity set", () => {
    const lts = [
      makeLiveLT({ targetAsset: "DOGE", targetLeverage: 3 }),
      makeLiveLT({ targetAsset: "ZEC", targetLeverage: 2 }),
      makeLiveLT({ targetAsset: "kPEPE", targetLeverage: 5 }),
      makeLiveLT({ targetAsset: "xyz:SP500", targetLeverage: 3 }),
      makeLiveLT({ targetAsset: "xyz:NVDA", targetLeverage: 5 }),
    ];
    const result = filterSupportedLTs(lts);
    expect(result).toHaveLength(5);
  });

  it("removes LTs with unsupported assets", () => {
    const lts = [
      makeLiveLT({ targetAsset: "HYPE", targetLeverage: 2 }),
      makeLiveLT({ targetAsset: "FAKEASSET", targetLeverage: 2 }),
      makeLiveLT({ targetAsset: "xyz:DELISTED", targetLeverage: 3 }),
    ];
    const result = filterSupportedLTs(lts);
    expect(result).toHaveLength(1);
    expect(result[0].targetAsset).toBe("HYPE");
  });

  it("removes LTs with unsupported leverages", () => {
    const lts = [
      makeLiveLT({ targetAsset: "HYPE", targetLeverage: 2 }),
      makeLiveLT({ targetAsset: "ETH", targetLeverage: 10 }),
      // HYPE 1x Short ships in the BounceTech directory but Alt Fun caps at
      // 2x/3x/5x — make sure 1x leverage still filters out even though the
      // asset is supported.
      makeLiveLT({ targetAsset: "HYPE", targetLeverage: 1 }),
    ];
    const result = filterSupportedLTs(lts);
    expect(result).toHaveLength(1);
    expect(result[0].targetAsset).toBe("HYPE");
    expect(result[0].targetLeverage).toBe(2);
  });

  it("returns empty array when no LTs match", () => {
    const lts = [makeLiveLT({ targetAsset: "FAKEASSET", targetLeverage: 10 })];
    const result = filterSupportedLTs(lts);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(filterSupportedLTs([])).toHaveLength(0);
  });

  it("filters by both asset and leverage simultaneously", () => {
    const lts = [
      makeLiveLT({ targetAsset: "HYPE", targetLeverage: 10 }), // bad leverage
      makeLiveLT({ targetAsset: "FAKEASSET", targetLeverage: 2 }), // bad asset
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
  it("covers the Bounce LT set (crypto + xyz: equities/commodities)", () => {
    expect([...SUPPORTED_UNDERLYING_ASSETS]).toEqual([
      "HYPE",
      "ETH",
      "BTC",
      "SOL",
      "DOGE",
      "ZEC",
      "kPEPE",
      "FARTCOIN",
      "xyz:CBRS",
      "xyz:CL",
      "xyz:BRENTOIL",
      "xyz:GOLD",
      "xyz:SILVER",
      "xyz:NVDA",
      "xyz:TSLA",
      "xyz:SP500",
      "xyz:XYZ100",
    ]);
  });
});

describe("isSupportedUnderlying", () => {
  it("returns true for supported underlying assets", () => {
    for (const supported of SUPPORTED_UNDERLYING_ASSETS) {
      expect(isSupportedUnderlying(supported)).toBe(true);
    }
  });

  it("returns false for unknown assets", () => {
    expect(isSupportedUnderlying("FAKEASSET")).toBe(false);
  });
});

describe("SUPPORTED_LEVERAGES", () => {
  it("contains exactly 2, 3, 5", () => {
    expect([...SUPPORTED_LEVERAGES]).toEqual([2, 3, 5]);
  });
});

describe("getAssetDisplayName", () => {
  it("strips the `xyz:` prefix for equity / commodity assets", () => {
    expect(getAssetDisplayName("xyz:SP500")).toBe("SP500");
    expect(getAssetDisplayName("xyz:NVDA")).toBe("NVDA");
    expect(getAssetDisplayName("xyz:BRENTOIL")).toBe("BRENTOIL");
  });

  it("leaves crypto assets untouched", () => {
    expect(getAssetDisplayName("HYPE")).toBe("HYPE");
    expect(getAssetDisplayName("kPEPE")).toBe("kPEPE");
  });
});

describe("getHyperliquidDex", () => {
  it("returns the xyz dex marker for equity / commodity assets", () => {
    expect(getHyperliquidDex("xyz:SP500")).toBe(HYPERLIQUID_XYZ_DEX);
    expect(getHyperliquidDex("xyz:GOLD")).toBe(HYPERLIQUID_XYZ_DEX);
  });

  it("returns null (default feed) for crypto assets", () => {
    expect(getHyperliquidDex("HYPE")).toBeNull();
    expect(getHyperliquidDex("BTC")).toBeNull();
    expect(getHyperliquidDex("kPEPE")).toBeNull();
  });
});
