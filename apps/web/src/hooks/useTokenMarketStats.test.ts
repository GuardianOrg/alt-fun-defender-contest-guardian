import { describe, expect, it } from "vitest";

import { buildTokenMarketStats } from "./useTokenMarketStats";

describe("buildTokenMarketStats", () => {
  it("surfaces loading state when upstream is loading", () => {
    const stats = buildTokenMarketStats(undefined, undefined, true, false);
    expect(stats).toEqual({
      mcapUsd: null,
      change24h: null,
      isLoading: true,
      isError: false,
    });
  });

  it("surfaces error state when market-data query errored", () => {
    const stats = buildTokenMarketStats(undefined, undefined, false, true);
    expect(stats.isError).toBe(true);
    expect(stats.mcapUsd).toBeNull();
    expect(stats.change24h).toBeNull();
  });

  it("prefers live mcap from useTokenPrices over backend mcap", () => {
    const stats = buildTokenMarketStats(
      12_345,
      { mcapUsd: 10_000, change24h: 5, past24hPriceUsd: 0.0001 },
      false,
      false,
    );
    expect(stats.mcapUsd).toBe(12_345);
    expect(stats.change24h).toBe(5);
  });

  it("falls back to backend mcap when live mcap is unavailable", () => {
    const stats = buildTokenMarketStats(
      0,
      { mcapUsd: 9_000, change24h: -3, past24hPriceUsd: 0.0001 },
      false,
      false,
    );
    expect(stats.mcapUsd).toBe(9_000);
    expect(stats.change24h).toBe(-3);
  });

  it("returns null change24h when market data is missing", () => {
    const stats = buildTokenMarketStats(15_000, undefined, false, false);
    expect(stats.mcapUsd).toBe(15_000);
    expect(stats.change24h).toBeNull();
  });

  it("returns null mcap when everything is missing", () => {
    const stats = buildTokenMarketStats(undefined, undefined, false, false);
    expect(stats.mcapUsd).toBeNull();
    expect(stats.change24h).toBeNull();
  });

  it("returns null change24h when backend reports null (too new to compute)", () => {
    const stats = buildTokenMarketStats(
      15_000,
      { mcapUsd: 15_000, change24h: null, past24hPriceUsd: null },
      false,
      false,
    );
    expect(stats.mcapUsd).toBe(15_000);
    expect(stats.change24h).toBeNull();
  });
});
