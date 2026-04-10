import { describe, it, expect } from "vitest";

import { parseLeveragedTokenParam } from "./parseLeveragedTokenParam.util";

describe("parseLeveragedTokenParam", () => {
  // Plain asset params (backwards compatibility)
  it("parses plain asset symbol", () => {
    expect(parseLeveragedTokenParam("ETH")).toEqual({
      asset: "ETH",
      leverage: null,
      direction: null,
    });
  });

  it("parses plain asset symbol case-insensitively", () => {
    expect(parseLeveragedTokenParam("eth")).toEqual({
      asset: "ETH",
      leverage: null,
      direction: null,
    });
  });

  it("parses all valid plain assets", () => {
    for (const symbol of ["BTC", "ETH", "HYPE", "SOL", "PAXG"]) {
      const result = parseLeveragedTokenParam(symbol);
      expect(result).not.toBeNull();
      expect(result!.asset).toBe(symbol);
      expect(result!.leverage).toBeNull();
      expect(result!.direction).toBeNull();
    }
  });

  // Leveraged token symbols
  it("parses ETH5L as ETH, 5x, long", () => {
    expect(parseLeveragedTokenParam("ETH5L")).toEqual({
      asset: "ETH",
      leverage: 5,
      direction: "long",
    });
  });

  it("parses BTC3S as BTC, 3x, short", () => {
    expect(parseLeveragedTokenParam("BTC3S")).toEqual({
      asset: "BTC",
      leverage: 3,
      direction: "short",
    });
  });

  it("parses HYPE2L as HYPE, 2x, long", () => {
    expect(parseLeveragedTokenParam("HYPE2L")).toEqual({
      asset: "HYPE",
      leverage: 2,
      direction: "long",
    });
  });

  it("parses SOL5S as SOL, 5x, short", () => {
    expect(parseLeveragedTokenParam("SOL5S")).toEqual({
      asset: "SOL",
      leverage: 5,
      direction: "short",
    });
  });

  it("parses PAXG3L as PAXG, 3x, long", () => {
    expect(parseLeveragedTokenParam("PAXG3L")).toEqual({
      asset: "PAXG",
      leverage: 3,
      direction: "long",
    });
  });

  it("parses HYPE1S as HYPE, 1x, short", () => {
    expect(parseLeveragedTokenParam("HYPE1S")).toEqual({
      asset: "HYPE",
      leverage: 1,
      direction: "short",
    });
  });

  it("parses HYPE1L as HYPE, 1x, long (direction validation happens at routing level)", () => {
    expect(parseLeveragedTokenParam("HYPE1L")).toEqual({
      asset: "HYPE",
      leverage: 1,
      direction: "long",
    });
  });

  it("is case-insensitive for leveraged token symbols", () => {
    expect(parseLeveragedTokenParam("eth5l")).toEqual({
      asset: "ETH",
      leverage: 5,
      direction: "long",
    });
    expect(parseLeveragedTokenParam("btc3s")).toEqual({
      asset: "BTC",
      leverage: 3,
      direction: "short",
    });
  });

  // Unsupported leverage falls back to asset-only
  it("falls back to asset-only for unsupported leverage", () => {
    expect(parseLeveragedTokenParam("ETH7L")).toEqual({
      asset: "ETH",
      leverage: null,
      direction: null,
    });
  });

  // Invalid params
  it("returns null for completely invalid param", () => {
    expect(parseLeveragedTokenParam("INVALID")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseLeveragedTokenParam("")).toBeNull();
  });

  it("falls back to asset-only for partial match with invalid format", () => {
    expect(parseLeveragedTokenParam("ETH5")).toEqual({
      asset: "ETH",
      leverage: null,
      direction: null,
    });
    expect(parseLeveragedTokenParam("ETH5X")).toEqual({
      asset: "ETH",
      leverage: null,
      direction: null,
    });
    expect(parseLeveragedTokenParam("ETHLONG")).toEqual({
      asset: "ETH",
      leverage: null,
      direction: null,
    });
  });
});
