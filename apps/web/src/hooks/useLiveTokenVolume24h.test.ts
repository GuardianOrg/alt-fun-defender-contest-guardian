import { describe, expect, it } from "vitest";

import { composeLiveVolume, tradeBroadcastToUsd } from "./useLiveTokenVolume24h";

import type { TradeBroadcast } from "../services/types";

describe("composeLiveVolume", () => {
  it("returns null when base is null (preserves indexer-degraded signal)", () => {
    expect(composeLiveVolume(null, 0)).toBeNull();
    expect(composeLiveVolume(null, 1_234)).toBeNull();
  });

  it("returns base when there are no live deltas", () => {
    expect(composeLiveVolume(0, 0)).toBe(0);
    expect(composeLiveVolume(2_500.5, 0)).toBe(2_500.5);
  });

  it("adds the delta to the polled base", () => {
    expect(composeLiveVolume(1_000, 250.25)).toBe(1_250.25);
    expect(composeLiveVolume(0, 12.5)).toBe(12.5);
  });
});

describe("tradeBroadcastToUsd", () => {
  function tradeListVariant(usdcAmount: string): TradeBroadcast {
    return {
      id: "0xabc-1",
      tokenAddress: "0xtoken",
      timestamp: "1700000000",
      usdcAmount,
      tokenAmount: "1000000000000000000",
      trader: "0xtrader",
      isBuy: true,
    };
  }

  function chartStateVariant(): TradeBroadcast {
    return {
      id: "0xabc-2",
      tokenAddress: "0xtoken",
      timestamp: "1700000000",
      curveSupply: "999000000000000000000000000",
      ltReserve: "5000000000000000000",
    };
  }

  it("returns the chart-state variant as null (carries no USD)", () => {
    expect(tradeBroadcastToUsd(chartStateVariant())).toBeNull();
  });

  it("scales 1e6 usdc strings into floating-point USD", () => {
    expect(tradeBroadcastToUsd(tradeListVariant("100000000"))).toBe(100);
    expect(tradeBroadcastToUsd(tradeListVariant("12500000"))).toBe(12.5);
    expect(tradeBroadcastToUsd(tradeListVariant("0"))).toBe(0);
  });

  it("returns null on malformed bigint strings rather than throwing", () => {
    expect(tradeBroadcastToUsd(tradeListVariant("not-a-number"))).toBeNull();
  });
});
