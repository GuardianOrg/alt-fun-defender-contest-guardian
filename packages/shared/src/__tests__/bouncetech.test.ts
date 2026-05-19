import { describe, it, expect } from "vitest";

import type { LiveLeveragedToken, LeveragedTokenInfo } from "../constants/bouncetech.js";
import {
  BOUNCE_UI_BASE_URL,
  EXCLUDED_UNDERLYING_ASSETS,
  filterSupportedLTs,
  findLT,
  getAssetDisplayName,
  getBounceLtImageUrl,
  getHyperliquidDex,
  HYPERLIQUID_DEFAULT_ASSETS,
  HYPERLIQUID_XYZ_DEX,
  isExcludedUnderlying,
  SUPPORTED_UNDERLYING_ASSETS,
  SUPPORTED_LEVERAGES,
  XYZ_DEX_ASSETS,
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
    baseAssetBalance: "0",
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

  it("drops LTs whose underlying is in EXCLUDED_UNDERLYING_ASSETS", () => {
    // PAXG ships in the BounceTech directory but Alt Fun retired it
    // (issue #639). Mixing supported + excluded LTs proves
    // `filterSupportedLTs` and `EXCLUDED_UNDERLYING_ASSETS` stay aligned —
    // adding an entry to the excluded list must immediately drop matching
    // LTs without a separate code change here.
    const lts = [
      makeLiveLT({ targetAsset: "HYPE", targetLeverage: 2 }),
      makeLiveLT({ targetAsset: "PAXG", targetLeverage: 2 }),
      makeLiveLT({ targetAsset: "PAXG", targetLeverage: 5 }),
    ];
    const result = filterSupportedLTs(lts);
    expect(result).toHaveLength(1);
    expect(result[0].targetAsset).toBe("HYPE");
  });

  it("rejects every excluded underlying explicitly (not just by omission from SUPPORTED_UNDERLYING_ASSETS)", () => {
    // Belt-and-braces: the filter must drop excluded LTs even if a future
    // refactor accidentally leaves them in `SUPPORTED_UNDERLYING_ASSETS`.
    // Loop over the live excluded list so adding a new entry there
    // automatically gets covered here without touching this test.
    for (const excluded of EXCLUDED_UNDERLYING_ASSETS) {
      const lts = [
        makeLiveLT({ targetAsset: excluded, targetLeverage: 2 }),
        makeLiveLT({ targetAsset: excluded, targetLeverage: 3 }),
        makeLiveLT({ targetAsset: excluded, targetLeverage: 5 }),
      ];
      expect(filterSupportedLTs(lts)).toHaveLength(0);
    }
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
    const lts = [
      makeLiveLT({ targetAsset: "FAKEASSET", targetLeverage: 10 }),
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
  it("covers the Bounce LT set (crypto + xyz: equities/commodities) minus excluded markets", () => {
    expect([...SUPPORTED_UNDERLYING_ASSETS]).toEqual([
      "HYPE",
      "ETH",
      "BTC",
      "SOL",
      "DOGE",
      "ZEC",
      "kPEPE",
      "FARTCOIN",
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

  it("partitions cleanly between Hyperliquid default and xyz dex feeds", () => {
    const partition = new Set([
      ...HYPERLIQUID_DEFAULT_ASSETS,
      ...XYZ_DEX_ASSETS,
    ]);
    expect(partition.size).toBe(SUPPORTED_UNDERLYING_ASSETS.length);
    for (const asset of SUPPORTED_UNDERLYING_ASSETS) {
      expect(partition.has(asset)).toBe(true);
    }
  });

  it("does not include any excluded markets", () => {
    for (const excluded of EXCLUDED_UNDERLYING_ASSETS) {
      expect(SUPPORTED_UNDERLYING_ASSETS as readonly string[]).not.toContain(excluded);
    }
  });
});

describe("EXCLUDED_UNDERLYING_ASSETS", () => {
  it("currently lists PAXG (BounceTech is winding the LT down — issue #639)", () => {
    expect([...EXCLUDED_UNDERLYING_ASSETS]).toEqual(["PAXG"]);
  });
});

describe("isExcludedUnderlying", () => {
  it("returns true for assets in EXCLUDED_UNDERLYING_ASSETS", () => {
    for (const excluded of EXCLUDED_UNDERLYING_ASSETS) {
      expect(isExcludedUnderlying(excluded)).toBe(true);
    }
  });

  it("returns false for supported underlying assets", () => {
    for (const supported of SUPPORTED_UNDERLYING_ASSETS) {
      expect(isExcludedUnderlying(supported)).toBe(false);
    }
  });

  it("returns false for unknown assets (no false positives on typos)", () => {
    expect(isExcludedUnderlying("paxg")).toBe(false);
    expect(isExcludedUnderlying("FAKEASSET")).toBe(false);
    expect(isExcludedUnderlying("")).toBe(false);
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

describe("getBounceLtImageUrl", () => {
  it("builds the canonical BounceTech UI logo URL for a given LT symbol", () => {
    expect(getBounceLtImageUrl("HYPE5L")).toBe(
      `${BOUNCE_UI_BASE_URL}/leveraged-tokens/HYPE5L.png`,
    );
    expect(getBounceLtImageUrl("BTC2S")).toBe(
      `${BOUNCE_UI_BASE_URL}/leveraged-tokens/BTC2S.png`,
    );
  });

  it("does not URL-encode the symbol (BounceTech symbols are ASCII-only)", () => {
    // Regression guard: encoding would turn `HYPE5L` into `HYPE5L` (no-op)
    // but break exotic future symbols like `kPEPE5L`. We intentionally keep
    // the raw symbol so the URL matches the on-disk filename.
    expect(getBounceLtImageUrl("kPEPE5L")).toContain("kPEPE5L.png");
  });
});
