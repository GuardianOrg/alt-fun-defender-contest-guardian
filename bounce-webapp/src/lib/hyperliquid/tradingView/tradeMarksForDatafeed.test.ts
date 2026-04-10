import { describe, expect, it } from "vitest";

import {
  alignTradeToBarOpenMs,
  buildDatafeedMarksFromTrades,
  isMarkInVisibleRange,
  markTimeSecFromBarOpenMs,
  MAX_MARKS_PER_BAR,
  tradeTimestampToUnixSeconds,
} from "./tradeMarksForDatafeed";

import type { Trade } from "../../../hooks/Indexer/useTrades";

function mockTrade(partial: Partial<Trade> & Pick<Trade, "id">): Trade {
  return {
    id: partial.id,
    txHash: partial.txHash ?? "0x1",
    timestamp: partial.timestamp ?? 60,
    isBuy: partial.isBuy ?? true,
    isLong: partial.isLong ?? true,
    targetLeverage: partial.targetLeverage ?? 2,
    targetAsset: partial.targetAsset ?? "HYPE",
    leveragedToken: partial.leveragedToken ?? "0x2",
    profitAmount: partial.profitAmount ?? null,
    profitPercent: partial.profitPercent ?? null,
    baseAssetAmount: partial.baseAssetAmount ?? 0n,
    leveragedTokenAmount: partial.leveragedTokenAmount ?? 0n,
  };
}

describe("tradeTimestampToUnixSeconds", () => {
  it("normalizes ms and seconds", () => {
    expect(tradeTimestampToUnixSeconds(1_700_000_000_000)).toBe(1_700_000_000);
    expect(tradeTimestampToUnixSeconds(1_700_000_000)).toBe(1_700_000_000);
  });
});

describe("alignTradeToBarOpenMs", () => {
  it("aligns to interval bucket", () => {
    const m = 60_000;
    expect(alignTradeToBarOpenMs(60, m)).toBe(60_000);
    expect(alignTradeToBarOpenMs(61, m)).toBe(60_000);
  });
});

describe("markTimeSecFromBarOpenMs", () => {
  it("converts bar open ms to TV mark seconds", () => {
    expect(markTimeSecFromBarOpenMs(60_000)).toBe(60);
  });
});

describe("isMarkInVisibleRange", () => {
  it("is inclusive on both ends", () => {
    expect(isMarkInVisibleRange(100, 100, 200)).toBe(true);
    expect(isMarkInVisibleRange(200, 100, 200)).toBe(true);
    expect(isMarkInVisibleRange(99, 100, 200)).toBe(false);
    expect(isMarkInVisibleRange(201, 100, 200)).toBe(false);
  });
});

describe("buildDatafeedMarksFromTrades", () => {
  it("filters by coin and visible window", () => {
    const trades = [
      mockTrade({ id: "1", timestamp: 60, targetAsset: "HYPE" }),
      mockTrade({ id: "2", timestamp: 60, targetAsset: "BTC" }),
    ];
    const marks = buildDatafeedMarksFromTrades({
      trades,
      coin: "HYPE",
      fromSec: 50,
      toSec: 70,
      intervalMs: 60_000,
    });
    expect(marks).toHaveLength(1);
    expect(marks[0].id).toBe("1-60");
    expect(marks[0].time).toBe(60);
  });

  it("keeps last MAX_MARKS_PER_BAR trades per bar when over cap", () => {
    const trades = Array.from({ length: MAX_MARKS_PER_BAR + 5 }, (_, i) =>
      mockTrade({
        id: `id-${i}`,
        timestamp: 60 + i,
        targetAsset: "HYPE",
      }),
    );
    const marks = buildDatafeedMarksFromTrades({
      trades,
      coin: "HYPE",
      fromSec: 0,
      toSec: 200,
      intervalMs: 60_000,
    });
    expect(marks.length).toBe(MAX_MARKS_PER_BAR);
    expect(marks.some((m) => m.id === "id-0-60")).toBe(false);
    const lastIdx = MAX_MARKS_PER_BAR + 4;
    expect(marks.some((m) => m.id === `id-${lastIdx}-${60 + lastIdx}`)).toBe(
      true,
    );
  });

  it("hover text is Minted/Redeemed with token symbol only", () => {
    const marks = buildDatafeedMarksFromTrades({
      trades: [mockTrade({ id: "a", timestamp: 60, targetAsset: "HYPE" })],
      coin: "HYPE",
      fromSec: 0,
      toSec: 120,
      intervalMs: 60_000,
    });
    expect(marks[0].text).toBe("Minted HYPE2L");
  });

  it("redeem shows Redeemed and S label", () => {
    const marks = buildDatafeedMarksFromTrades({
      trades: [
        mockTrade({
          id: "b",
          timestamp: 60,
          targetAsset: "HYPE",
          isBuy: false,
        }),
      ],
      coin: "HYPE",
      fromSec: 0,
      toSec: 120,
      intervalMs: 60_000,
    });
    expect(marks[0].text).toBe("Redeemed HYPE2L");
    expect(marks[0].label).toBe("S");
  });
});
