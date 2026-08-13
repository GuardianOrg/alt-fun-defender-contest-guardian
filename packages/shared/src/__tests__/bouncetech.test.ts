import { describe, it, expect } from "vitest";

import type {
  LiveLeveragedToken,
  LeveragedTokenInfo,
} from "../constants/bouncetech.js";
import {
  filterMintableLTs,
  filterSupportedLTs,
  findLT,
  getAssetDisplayName,
  getHyperliquidDex,
  getLeverageOptions,
  HYPERLIQUID_XYZ_DEX,
  isSupportedUnderlying,
  mintableUnderlyingAssets,
  SUPPORTED_UNDERLYING_ASSETS,
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

  it("keeps contract-reported leverage values", () => {
    const lts = [
      makeLiveLT({ targetAsset: "HYPE", targetLeverage: 2 }),
      makeLiveLT({ targetAsset: "ETH", targetLeverage: 10 }),
      makeLiveLT({ targetAsset: "HYPE", targetLeverage: 1 }),
    ];
    const result = filterSupportedLTs(lts);
    expect(result).toHaveLength(3);
    expect(result.map((lt) => lt.targetLeverage)).toEqual([2, 10, 1]);
  });

  it("removes invalid contract leverage values", () => {
    const lts = [
      makeLiveLT({ targetAsset: "HYPE", targetLeverage: 2 }),
      makeLiveLT({ targetAsset: "ETH", targetLeverage: 0 }),
      makeLiveLT({ targetAsset: "BTC", targetLeverage: 1.5 }),
    ];
    const result = filterSupportedLTs(lts);
    expect(result).toHaveLength(1);
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

  it("filters by supported asset and valid contract leverage simultaneously", () => {
    const lts = [
      makeLiveLT({ targetAsset: "HYPE", targetLeverage: 10 }), // contract-backed leverage
      makeLiveLT({ targetAsset: "FAKEASSET", targetLeverage: 2 }), // bad asset
      makeLiveLT({ targetAsset: "HYPE", targetLeverage: 3 }), // good
    ];
    const result = filterSupportedLTs(lts);
    expect(result).toHaveLength(2);
    expect(result[0].targetAsset).toBe("HYPE");
    expect(result.map((lt) => lt.targetLeverage)).toEqual([10, 3]);
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
      "NEAR",
      "LIT",
      "XRP",
      "xyz:CBRS",
      "xyz:CL",
      "xyz:BRENTOIL",
      "xyz:GOLD",
      "xyz:SILVER",
      "xyz:NVDA",
      "xyz:TSLA",
      "xyz:SP500",
      "xyz:SPCX",
      "xyz:XYZ100",
      "xyz:BB",
      "xyz:MU",
      "xyz:SKHX",
      "xyz:CXMT",
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

describe("getLeverageOptions", () => {
  const lts: LeveragedTokenInfo[] = [
    makeLTInfo({ targetAsset: "HYPE", targetLeverage: 5, isLong: true }),
    makeLTInfo({ targetAsset: "HYPE", targetLeverage: 2, isLong: true }),
    makeLTInfo({ targetAsset: "HYPE", targetLeverage: 2, isLong: false }),
    makeLTInfo({ targetAsset: "xyz:SPCX", targetLeverage: 3, isLong: true }),
    makeLTInfo({ targetAsset: "xyz:SPCX", targetLeverage: 2, isLong: true }),
    makeLTInfo({ targetAsset: "xyz:SPCX", targetLeverage: 0, isLong: true }),
  ];

  it("derives sorted unique leverage options from LT records", () => {
    expect(getLeverageOptions(lts)).toEqual([2, 3, 5]);
  });

  it("can derive options for one asset", () => {
    expect(getLeverageOptions(lts, "xyz:SPCX")).toEqual([2, 3]);
  });

  it("can derive options for one asset and direction", () => {
    expect(getLeverageOptions(lts, "HYPE", false)).toEqual([2]);
  });
});

describe("filterMintableLTs", () => {
  it("drops mint-paused LTs and keeps the rest", () => {
    const lts = [
      makeLiveLT({ targetAsset: "HYPE", mintPaused: false }),
      makeLiveLT({
        address: "0x0000000000000000000000000000000000000002",
        targetAsset: "BTC",
        mintPaused: true,
      }),
    ];
    expect(filterMintableLTs(lts).map((lt) => lt.targetAsset)).toEqual(["HYPE"]);
  });

  it("returns an empty list when every LT is paused", () => {
    const lts = [makeLiveLT({ mintPaused: true })];
    expect(filterMintableLTs(lts)).toEqual([]);
  });
});

describe("mintableUnderlyingAssets", () => {
  it("keeps an asset when at least one LT is still mintable", () => {
    const lts = [
      makeLiveLT({ targetAsset: "BTC", targetLeverage: 2, mintPaused: true }),
      makeLiveLT({
        address: "0x0000000000000000000000000000000000000002",
        targetAsset: "BTC",
        targetLeverage: 3,
        mintPaused: false,
      }),
    ];
    expect(mintableUnderlyingAssets(lts)).toEqual(["BTC"]);
  });

  it("omits an asset when every LT for it is paused", () => {
    const lts = [
      makeLiveLT({ targetAsset: "BTC", targetLeverage: 2, mintPaused: true }),
      makeLiveLT({
        address: "0x0000000000000000000000000000000000000002",
        targetAsset: "BTC",
        targetLeverage: 3,
        mintPaused: true,
      }),
      makeLiveLT({
        address: "0x0000000000000000000000000000000000000003",
        targetAsset: "ETH",
        mintPaused: false,
      }),
    ];
    expect(mintableUnderlyingAssets(lts)).toEqual(["ETH"]);
  });

  it("can require a mintable LT in a specific direction", () => {
    const lts = [
      makeLiveLT({ targetAsset: "BTC", isLong: true, mintPaused: false }),
      makeLiveLT({
        address: "0x0000000000000000000000000000000000000002",
        targetAsset: "BTC",
        isLong: false,
        mintPaused: true,
      }),
    ];
    expect(mintableUnderlyingAssets(lts, true)).toEqual(["BTC"]);
    expect(mintableUnderlyingAssets(lts, false)).toEqual([]);
  });

  it("returns an empty list for an empty directory", () => {
    expect(mintableUnderlyingAssets([])).toEqual([]);
  });
});

describe("getAssetDisplayName", () => {
  it("strips the `xyz:` prefix for equity / commodity assets", () => {
    expect(getAssetDisplayName("xyz:SP500")).toBe("SP500");
    expect(getAssetDisplayName("xyz:NVDA")).toBe("NVDA");
    expect(getAssetDisplayName("xyz:BRENTOIL")).toBe("BRENTOIL");
    expect(getAssetDisplayName("xyz:SPCX")).toBe("SPCX");
  });

  it("leaves crypto assets untouched", () => {
    expect(getAssetDisplayName("HYPE")).toBe("HYPE");
    expect(getAssetDisplayName("kPEPE")).toBe("kPEPE");
    expect(getAssetDisplayName("NEAR")).toBe("NEAR");
  });
});

describe("getHyperliquidDex", () => {
  it("returns the xyz dex marker for equity / commodity assets", () => {
    expect(getHyperliquidDex("xyz:SP500")).toBe(HYPERLIQUID_XYZ_DEX);
    expect(getHyperliquidDex("xyz:GOLD")).toBe(HYPERLIQUID_XYZ_DEX);
    expect(getHyperliquidDex("xyz:SPCX")).toBe(HYPERLIQUID_XYZ_DEX);
  });

  it("returns null (default feed) for crypto assets", () => {
    expect(getHyperliquidDex("HYPE")).toBeNull();
    expect(getHyperliquidDex("BTC")).toBeNull();
    expect(getHyperliquidDex("kPEPE")).toBeNull();
    expect(getHyperliquidDex("NEAR")).toBeNull();
  });
});
