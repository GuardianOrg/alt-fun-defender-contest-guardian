import { describe, expect, it } from "vitest";

import { dedupeTokensByAddress } from "./useTokens";

import type { Token } from "../services/types";

const baseToken: Token = {
  address: "0xabc",
  name: "Test",
  ticker: "TEST",
  emoji: "",
  description: "",
  direction: "long",
  underlying: "HYPE",
  leverage: 2,
  ltName: "HYPE 2× Long",
  ltAddress: "0xdef",
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
  creatorAddress: "0xfeed",
  communityTakeoverAt: null,
  createdAt: "2025-01-01T00:00:00Z",
  isHidden: false,
};

function makeToken(address: string, overrides: Partial<Token> = {}): Token {
  return { ...baseToken, address, ...overrides };
}

describe("dedupeTokensByAddress", () => {
  // Pure-passthrough sanity: with no duplicates the helper must not
  // mutate ordering or drop anything — TokenTable relies on the API's
  // trending-sorted order being preserved for the rows that survive
  // the dedupe.
  it("returns input unchanged when there are no duplicates", () => {
    const tokens = [makeToken("0xaaa"), makeToken("0xbbb"), makeToken("0xccc")];
    const result = dedupeTokensByAddress(tokens);
    expect(result.map((t) => t.address)).toEqual(["0xaaa", "0xbbb", "0xccc"]);
  });

  // The core fix for issue #877. The home-page TRENDING tab paginates
  // a re-scored 500-candidate pool: between the page-N and page-(N+1)
  // fetch a fresh trade can move a token across the page boundary,
  // so the same address appears in two consecutive pages. The flatten
  // step in `useInfiniteTokens` would then render two rows for the
  // same ticker until the next refetch shuffled them apart.
  it("drops the later duplicate when a token straddles two pages", () => {
    const pageOne = [
      makeToken("0xaaa", { ticker: "AAA" }),
      makeToken("0xbbb", { ticker: "BBB" }),
    ];
    const pageTwo = [
      makeToken("0xbbb", { ticker: "BBB" }),
      makeToken("0xccc", { ticker: "CCC" }),
    ];
    const result = dedupeTokensByAddress([...pageOne, ...pageTwo]);
    expect(result.map((t) => t.address)).toEqual(["0xaaa", "0xbbb", "0xccc"]);
  });

  // Address comparison must be case-insensitive: every other layer of
  // the codebase normalises addresses to lowercase before keying, so
  // a mixed-case page boundary collision must not slip past the
  // dedupe. The retained entry should be the first occurrence — its
  // case is preserved, which matches `useInfiniteTokens`'s contract of
  // surfacing the API's chosen presentation.
  it("treats addresses as equal regardless of case", () => {
    const tokens = [
      makeToken("0xAbCdEf"),
      makeToken("0xabcdef", { ticker: "DUP" }),
      makeToken("0xABCDEF", { ticker: "DUP2" }),
    ];
    const result = dedupeTokensByAddress(tokens);
    expect(result).toHaveLength(1);
    expect(result[0]?.address).toBe("0xAbCdEf");
  });

  // Empty input is a real code path: `query.data?.pages.flat() ?? []`
  // lands here on the first render before any page resolves, and the
  // hook must return an array (not undefined) so consumers can map
  // over it without an extra guard.
  it("handles an empty list", () => {
    expect(dedupeTokensByAddress([])).toEqual([]);
  });

  // The first occurrence wins — important for the mock-merge path in
  // `useInfiniteTokens`, which prepends dev-injected mock tokens to
  // the real query pages on the assumption that the mock copy stays
  // pinned at the top.
  it("keeps the first occurrence and drops later ones", () => {
    const tokens = [
      makeToken("0xaaa", { ticker: "FIRST" }),
      makeToken("0xaaa", { ticker: "SECOND" }),
    ];
    const result = dedupeTokensByAddress(tokens);
    expect(result).toHaveLength(1);
    expect(result[0]?.ticker).toBe("FIRST");
  });
});
