import { describe, expect, it } from "vitest";

import { isListLiveTradeUpdate } from "./useTokenListLiveFeed";

import type { TradeBroadcast } from "../services/types";

describe("isListLiveTradeUpdate", () => {
  function tradeListVariant(tokenAddress: string): TradeBroadcast {
    return {
      id: "0xabc-1",
      tokenAddress,
      timestamp: "1700000000",
      usdcAmount: "100000000",
      tokenAmount: "1000000000000000000",
      trader: "0xtrader",
      isBuy: true,
    };
  }

  function chartStateVariant(tokenAddress: string): TradeBroadcast {
    return {
      id: "0xabc-2",
      tokenAddress,
      timestamp: "1700000000",
      curveSupply: "999000000000000000000000000",
      ltReserve: "5000000000000000000",
    };
  }

  // Both variants ride the same `trade` channel and both signal that the
  // token's mcap / curve state moved — the home-page list invalidator
  // is variant-blind by design. See JSDoc on `isListLiveTradeUpdate`.
  it("accepts both broadcast variants on the trade channel", () => {
    expect(isListLiveTradeUpdate(tradeListVariant("0xabc"))).toBe(true);
    expect(isListLiveTradeUpdate(chartStateVariant("0xabc"))).toBe(true);
  });

  // Address case is irrelevant — the predicate only checks that a
  // tokenAddress is *present*. Routing/normalisation is handled at the
  // WS-shard layer.
  it("accepts addresses regardless of case", () => {
    expect(isListLiveTradeUpdate(tradeListVariant("0xABCDEF"))).toBe(true);
    expect(isListLiveTradeUpdate(tradeListVariant("0xabcdef"))).toBe(true);
  });

  // `tokenAddress` is typed `string` on `TradeBroadcastBase`, but the
  // WS server could in principle ship a malformed payload. The hook
  // should silently drop these rather than triggering a wasteful
  // catalogue refetch.
  it("rejects broadcasts missing tokenAddress", () => {
    const broken: Partial<TradeBroadcast> = { ...tradeListVariant("0x") };
    delete broken.tokenAddress;
    expect(isListLiveTradeUpdate(broken as TradeBroadcast)).toBe(false);
  });

  // An empty-string address is just as useless as a missing one — the
  // catalogue refetch would invalidate state for a non-existent token.
  it("rejects broadcasts with an empty tokenAddress", () => {
    const empty: TradeBroadcast = { ...tradeListVariant(""), tokenAddress: "" };
    expect(isListLiveTradeUpdate(empty)).toBe(false);
  });

  // Whitespace-only addresses are equally non-actionable — trim before
  // the emptiness check so a malformed `"   "` payload doesn't trigger
  // a wasteful catalogue refetch.
  it("rejects broadcasts with a whitespace-only tokenAddress", () => {
    const whitespace: TradeBroadcast = {
      ...tradeListVariant("   "),
      tokenAddress: "   ",
    };
    expect(isListLiveTradeUpdate(whitespace)).toBe(false);
  });
});
