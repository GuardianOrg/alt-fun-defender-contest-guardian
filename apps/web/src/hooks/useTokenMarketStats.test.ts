import { describe, expect, it } from "vitest";

import { buildTokenMarketStats } from "./useTokenMarketStats";

describe("buildTokenMarketStats", () => {
  it("surfaces loading state when upstream is loading", () => {
    const stats = buildTokenMarketStats(undefined, undefined, true, false);
    expect(stats).toEqual({
      mcapUsd: null,
      change24h: null,
      volume24hUsd: null,
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

  it("prefers a positive live mcap input over the backend mcap fallback", () => {
    const stats = buildTokenMarketStats(
      12_345,
      {
        priceUsd: 0.00001,
        mcapUsd: 10_000,
        change24h: 5,
        past24hPriceUsd: 0.0001,
        volume24hUsd: 8_000,
      },
      false,
      false,
    );
    expect(stats.mcapUsd).toBe(12_345);
    expect(stats.change24h).toBe(5);
    expect(stats.volume24hUsd).toBe(8_000);
  });

  it("falls back to backend mcap when live mcap is unavailable", () => {
    const stats = buildTokenMarketStats(
      0,
      {
        priceUsd: 0.000009,
        mcapUsd: 9_000,
        change24h: -3,
        past24hPriceUsd: 0.0001,
        volume24hUsd: 0,
      },
      false,
      false,
    );
    expect(stats.mcapUsd).toBe(9_000);
    expect(stats.change24h).toBe(-3);
    expect(stats.volume24hUsd).toBe(0);
  });

  it("returns null change24h when market data is missing", () => {
    const stats = buildTokenMarketStats(15_000, undefined, false, false);
    expect(stats.mcapUsd).toBe(15_000);
    expect(stats.change24h).toBeNull();
    expect(stats.volume24hUsd).toBeNull();
  });

  it("returns null mcap when everything is missing", () => {
    const stats = buildTokenMarketStats(undefined, undefined, false, false);
    expect(stats.mcapUsd).toBeNull();
    expect(stats.change24h).toBeNull();
  });

  it("returns null change24h when backend reports null (too new to compute)", () => {
    const stats = buildTokenMarketStats(
      15_000,
      {
        priceUsd: 0.000015,
        mcapUsd: 15_000,
        change24h: null,
        past24hPriceUsd: null,
        volume24hUsd: null,
      },
      false,
      false,
    );
    expect(stats.mcapUsd).toBe(15_000);
    expect(stats.change24h).toBeNull();
    expect(stats.volume24hUsd).toBeNull();
  });

  it("surfaces a polled volume24hUsd alongside mcap", () => {
    const stats = buildTokenMarketStats(
      20_000,
      {
        priceUsd: 0.00002,
        mcapUsd: 20_000,
        change24h: 12,
        past24hPriceUsd: 0.0001,
        volume24hUsd: 4_321.5,
      },
      false,
      false,
    );
    expect(stats.volume24hUsd).toBe(4_321.5);
  });
});
