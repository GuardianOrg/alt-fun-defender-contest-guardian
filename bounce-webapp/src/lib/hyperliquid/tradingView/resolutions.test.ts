import { describe, expect, it } from "vitest";

import { hyperliquidCandleIntervals } from "./hyperliquidCandleIntervals";
import {
  HYPERLIQUID_TRADING_VIEW_RESOLUTIONS,
  tradingViewResolutionToHyperliquidInterval,
} from "./resolutions";

import type { ResolutionString } from "../../../types/chartingLibrary";

describe("tradingViewResolutionToHyperliquidInterval", () => {
  it("maps minute and day TV strings to Hyperliquid intervals", () => {
    expect(
      tradingViewResolutionToHyperliquidInterval("1" as ResolutionString),
    ).toBe("1m");
    expect(
      tradingViewResolutionToHyperliquidInterval("3" as ResolutionString),
    ).toBe("3m");
    expect(
      tradingViewResolutionToHyperliquidInterval("480" as ResolutionString),
    ).toBe("8h");
    expect(
      tradingViewResolutionToHyperliquidInterval("720" as ResolutionString),
    ).toBe("12h");
    expect(
      tradingViewResolutionToHyperliquidInterval("60" as ResolutionString),
    ).toBe("1h");
    expect(
      tradingViewResolutionToHyperliquidInterval("1D" as ResolutionString),
    ).toBe("1d");
    expect(
      tradingViewResolutionToHyperliquidInterval("3D" as ResolutionString),
    ).toBe("3d");
    expect(
      tradingViewResolutionToHyperliquidInterval("1W" as ResolutionString),
    ).toBe("1w");
    expect(
      tradingViewResolutionToHyperliquidInterval("1M" as ResolutionString),
    ).toBe("1M");
  });

  it("returns null for unsupported resolutions", () => {
    expect(
      tradingViewResolutionToHyperliquidInterval("10" as ResolutionString),
    ).toBe(null);
    expect(
      tradingViewResolutionToHyperliquidInterval("333" as ResolutionString),
    ).toBe(null);
  });
});

describe("HYPERLIQUID_TRADING_VIEW_RESOLUTIONS", () => {
  it("covers every Hyperliquid interval exactly once", () => {
    expect(HYPERLIQUID_TRADING_VIEW_RESOLUTIONS).toHaveLength(
      hyperliquidCandleIntervals.length,
    );
    for (const hl of hyperliquidCandleIntervals) {
      const count = HYPERLIQUID_TRADING_VIEW_RESOLUTIONS.filter(
        (r) => tradingViewResolutionToHyperliquidInterval(r) === hl,
      ).length;
      expect(count).toBe(1);
    }
  });
});
