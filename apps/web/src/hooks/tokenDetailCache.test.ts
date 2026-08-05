// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { cacheTokenDetail, readCachedToken } from "./tokenDetailCache";

import type { Token } from "../services/types";

function token(address: string, ticker: string): Token {
  return {
    address,
    name: ticker,
    ticker,
    emoji: "",
    description: "",
    direction: "long",
    underlying: "HYPE",
    leverage: 2,
    ltName: "HYPE 2x Long",
    ltAddress: "0xlt",
    buyMomentum: 0,
    leverageBoost: 0,
    organicFilled: null,
    curveFilled: null,
    curveRaisedUsd: null,
    volume24h: null,
    totalVolumeUsd: null,
    athUsd: 0,
    priceUsd: null,
    mcapUsd: null,
    change24h: null,
    status: "active",
    creatorAddress: "0xcreator",
    communityTakeoverAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    isHidden: false,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("token detail cache", () => {
  it("stores and reads a token by address case-insensitively", () => {
    cacheTokenDetail(token("0xAbC", "ABC"));

    expect(readCachedToken("0xabc")?.ticker).toBe("ABC");
  });

  it("keeps only the most recent eight tokens", () => {
    let now = 1;
    vi.spyOn(Date, "now").mockImplementation(() => now++);
    for (let i = 0; i < 9; i++) {
      cacheTokenDetail(token(`0x${i}`, `T${i}`));
    }

    expect(readCachedToken("0x0")).toBeUndefined();
    expect(readCachedToken("0x8")?.ticker).toBe("T8");
  });
});
