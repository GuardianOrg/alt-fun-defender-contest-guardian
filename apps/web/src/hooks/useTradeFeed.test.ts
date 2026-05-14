import { describe, expect, it } from "vitest";

import {
  compareTradesByTimestampDesc,
  sortTradesByTimestampDesc,
} from "./useTradeFeed";

import type { Trade } from "../services/types";

/**
 * Build a minimal `Trade` for ordering tests. Only the two fields the
 * comparator actually reads are interesting (`timestamp`, `id`); the rest
 * are filler that keeps the type checker happy without contributing to
 * the sort behaviour.
 */
function makeTrade(overrides: Partial<Trade> & Pick<Trade, "id" | "timestamp">): Trade {
  return {
    side: "BUY",
    amountUsd: 100,
    tokensAmount: "1.0",
    walletAddress: "0x12…ab",
    walletAddressFull: "0x1234567890abcdef1234567890abcdef12345678",
    tokenAddress: "0xabc",
    tokenName: "TST",
    ...overrides,
  };
}

/**
 * Issue #824: the home-page RECENT TRADES feed showed apparent "gaps"
 * during heavy trading. Root cause was insertion-order rendering: WS
 * pushes interleaved with the initial REST poll's oldest-to-newest
 * iteration produced rows that were chronologically out of order, which
 * read as broken/missing rows because timestamps no longer flowed
 * monotonically down the list.
 *
 * The fix sorts by `timestamp` desc with `id` as a stable tiebreaker on
 * every mutation. These tests pin the comparator's exact behaviour so a
 * future refactor can't silently reintroduce the bug.
 */
describe("compareTradesByTimestampDesc", () => {
  it("orders strictly newer trades before older ones", () => {
    const newer = makeTrade({ id: "0xtx-1", timestamp: "2025-01-02T00:00:00Z" });
    const older = makeTrade({ id: "0xtx-2", timestamp: "2025-01-01T00:00:00Z" });

    // Returns negative → newer sorts before older (Array#sort ascending).
    expect(compareTradesByTimestampDesc(newer, older)).toBeLessThan(0);
    expect(compareTradesByTimestampDesc(older, newer)).toBeGreaterThan(0);
  });

  it("returns zero for an identical row (reflexive)", () => {
    const trade = makeTrade({ id: "0xtx-1", timestamp: "2025-01-01T00:00:00Z" });
    expect(compareTradesByTimestampDesc(trade, trade)).toBe(0);
  });

  // Same-block trades share a block timestamp but have different log
  // indices encoded in the `${txHash}-${logIndex}` id. The comparator
  // breaks ties on the numeric log index when the txHash matches so
  // the resulting order matches the indexer's `routerTrades(orderBy:
  // "timestamp", desc)` for trades sharing a block.
  it("breaks timestamp ties by id (later log index first)", () => {
    const sameBlockLater = makeTrade({
      id: "0xhash-5",
      timestamp: "2025-01-01T00:00:00Z",
    });
    const sameBlockEarlier = makeTrade({
      id: "0xhash-2",
      timestamp: "2025-01-01T00:00:00Z",
    });

    expect(compareTradesByTimestampDesc(sameBlockLater, sameBlockEarlier))
      .toBeLessThan(0);
    expect(compareTradesByTimestampDesc(sameBlockEarlier, sameBlockLater))
      .toBeGreaterThan(0);
  });

  // Multi-digit log indices on the same tx must sort numerically — a
  // plain lexical compare would put `0xhash-10` AFTER `0xhash-2`
  // because `1 < 2` as strings, silently reordering busy graduation /
  // sandwich txns. Reported by CodeRabbit on PR #861; pinned by this
  // test so a future refactor can't drop the numeric tie-break.
  it("orders multi-digit log indices on the same tx numerically", () => {
    const logIndex10 = makeTrade({
      id: "0xhash-10",
      timestamp: "2025-01-01T00:00:00Z",
    });
    const logIndex2 = makeTrade({
      id: "0xhash-2",
      timestamp: "2025-01-01T00:00:00Z",
    });

    // Higher log index should come first (newer within the block).
    expect(compareTradesByTimestampDesc(logIndex10, logIndex2)).toBeLessThan(0);
    expect(compareTradesByTimestampDesc(logIndex2, logIndex10))
      .toBeGreaterThan(0);

    // And inside a sort, the multi-digit row lands above the
    // single-digit one — the direct check the bug report described.
    const sorted = sortTradesByTimestampDesc([logIndex2, logIndex10]);
    expect(sorted.map((t) => t.id)).toEqual(["0xhash-10", "0xhash-2"]);
  });

  // Cross-tx ties (different `txHash`) keep the lexical fallback so
  // we always return a deterministic order — the numeric tie-break
  // only kicks in when both ids genuinely refer to the same tx.
  it("falls back to lexical compare for same-timestamp rows from different txs", () => {
    const txA = makeTrade({ id: "0xabc-1", timestamp: "2025-01-01T00:00:00Z" });
    const txB = makeTrade({ id: "0xabd-1", timestamp: "2025-01-01T00:00:00Z" });

    expect(compareTradesByTimestampDesc(txB, txA)).toBeLessThan(0);
    expect(compareTradesByTimestampDesc(txA, txB)).toBeGreaterThan(0);
  });

  // Malformed timestamps must not poison the comparator — a single
  // corrupt row shouldn't flip the entire list's ordering. We
  // demote NaN to the bottom (last) so the rest of the list stays
  // sorted correctly.
  it("pushes rows with malformed timestamps to the bottom", () => {
    const valid = makeTrade({ id: "0xtx-1", timestamp: "2025-01-01T00:00:00Z" });
    const corrupt = makeTrade({ id: "0xtx-2", timestamp: "not-a-date" });

    expect(compareTradesByTimestampDesc(valid, corrupt)).toBeLessThan(0);
    expect(compareTradesByTimestampDesc(corrupt, valid)).toBeGreaterThan(0);
  });
});

describe("sortTradesByTimestampDesc", () => {
  // The exact gap-producing scenario from issue #824: an out-of-order
  // input array gets normalised to newest-first. Mirrors what happens
  // inside `useTradeFeed.handleNew` when a WS broadcast races the
  // initial REST poll's oldest-to-newest iteration.
  it("returns trades sorted newest-first regardless of insertion order", () => {
    const t1 = makeTrade({ id: "0xtx-1", timestamp: "2025-01-01T00:00:00Z" });
    const t2 = makeTrade({ id: "0xtx-2", timestamp: "2025-01-02T00:00:00Z" });
    const t3 = makeTrade({ id: "0xtx-3", timestamp: "2025-01-03T00:00:00Z" });

    const sorted = sortTradesByTimestampDesc([t1, t3, t2]);
    expect(sorted.map((t) => t.id)).toEqual(["0xtx-3", "0xtx-2", "0xtx-1"]);
  });

  it("returns a new array (input is not mutated)", () => {
    const t1 = makeTrade({ id: "0xtx-1", timestamp: "2025-01-01T00:00:00Z" });
    const t2 = makeTrade({ id: "0xtx-2", timestamp: "2025-01-02T00:00:00Z" });
    const input = [t1, t2];
    const result = sortTradesByTimestampDesc(input);

    // Identity check: caller's array survives intact for any downstream
    // consumers that captured the reference.
    expect(result).not.toBe(input);
    expect(input).toEqual([t1, t2]);
  });

  it("preserves stable order for trades with the same id and timestamp", () => {
    const t1 = makeTrade({ id: "0xtx-1", timestamp: "2025-01-01T00:00:00Z" });
    const t1Again = makeTrade({ id: "0xtx-1", timestamp: "2025-01-01T00:00:00Z" });

    // Two refs with the same id+timestamp should preserve insertion order
    // — Array#sort is stable since ES2019 and the comparator returns 0
    // for equal trades, so re-sorting an already-sorted list is a no-op.
    const sorted = sortTradesByTimestampDesc([t1, t1Again]);
    expect(sorted[0]).toBe(t1);
    expect(sorted[1]).toBe(t1Again);
  });

  // Issue #824 repro: simulate the exact "WS pushes a newer trade
  // mid-REST-poll" race. The REST poll iterates oldest-to-newest and
  // prepends, so without the sort the WS-pushed newer row would end up
  // at the bottom of the list (older trades on top of newer). With the
  // sort, the chronological order is recovered.
  it("recovers chronological order when a fresh WS row interleaves with an older REST batch", () => {
    const newerWsTrade = makeTrade({
      id: "0xws-1",
      timestamp: "2025-01-05T00:00:00Z",
    });
    const olderRestRows = [
      makeTrade({ id: "0xrest-0", timestamp: "2025-01-04T00:00:00Z" }),
      makeTrade({ id: "0xrest-1", timestamp: "2025-01-03T00:00:00Z" }),
      makeTrade({ id: "0xrest-2", timestamp: "2025-01-02T00:00:00Z" }),
      makeTrade({ id: "0xrest-3", timestamp: "2025-01-01T00:00:00Z" }),
    ];

    // The REST poll iterates oldest → newest and prepends each, so the
    // pre-sort array looks like `[rest0, rest1, rest2, rest3, ws1]`
    // (newer REST rows on top of even-newer WS row at bottom).
    const insertionOrder = [...olderRestRows, newerWsTrade];

    const sorted = sortTradesByTimestampDesc(insertionOrder);
    expect(sorted.map((t) => t.id)).toEqual([
      "0xws-1",
      "0xrest-0",
      "0xrest-1",
      "0xrest-2",
      "0xrest-3",
    ]);
  });

  it("handles an empty array", () => {
    expect(sortTradesByTimestampDesc([])).toEqual([]);
  });

  it("handles a single-element array", () => {
    const t = makeTrade({ id: "0xtx-1", timestamp: "2025-01-01T00:00:00Z" });
    const input = [t];
    const sorted = sortTradesByTimestampDesc(input);
    expect(sorted).toEqual([t]);
    // Still a new array (sort always allocates) — see the JSDoc on
    // `sortTradesByTimestampDesc` for the identity-stability contract.
    expect(sorted).not.toBe(input);
  });
});
