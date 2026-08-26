import { describe, expect, it } from "vitest";

import {
  formatLockPercent,
  formatUnlockDate,
  indexTokenLocks,
  lockClaim,
} from "./locks";

import type { ApiTokenLock } from "../services/api";

function makeLock(overrides: Partial<ApiTokenLock> = {}): ApiTokenLock {
  return {
    tokenAddress: "0x7f7430a1ad9a9b0e86849c332bf27facfd700000",
    lockedAmount: (750_000_000n * 10n ** 18n).toString(),
    lockedPercent: 75,
    unlocksAt: "2026-11-25T15:05:21.000Z",
    ...overrides,
  };
}

describe("indexTokenLocks", () => {
  it("keys by lowercased address so checksummed lookups hit", () => {
    const lock = makeLock({
      tokenAddress: "0x7F7430A1AD9A9B0E86849C332BF27FACFD700000",
    });
    const map = indexTokenLocks([lock]);
    expect(
      map.get("0x7f7430a1ad9a9b0e86849c332bf27facfd700000"),
    ).toBe(lock);
  });

  it("returns an empty map for no locks", () => {
    expect(indexTokenLocks([]).size).toBe(0);
  });
});

describe("formatUnlockDate", () => {
  it("returns null for an unparseable timestamp", () => {
    // Callers drop the date rather than rendering "Invalid Date" at users.
    expect(formatUnlockDate("not-a-date")).toBeNull();
  });

  it("formats a valid ISO timestamp", () => {
    expect(formatUnlockDate("2026-11-25T15:05:21.000Z")).toBeTruthy();
  });
});

describe("formatLockPercent", () => {
  it("rounds to whole percent", () => {
    expect(formatLockPercent(74.62)).toBe("75%");
  });

  it("renders a sub-half-percent lock as <1% rather than 0%", () => {
    // The API omits unlocked tokens, so any percentage reaching here is
    // nonzero — "0% LOCKED" would read as a broken number, not a small one.
    expect(formatLockPercent(0.3)).toBe("<1%");
    expect(formatLockPercent(0.0001)).toBe("<1%");
  });
});

describe("lockClaim", () => {
  it("names the denominator so the percentage can't read as circulating supply", () => {
    const claim = lockClaim(75, "2026-11-25T15:05:21.000Z");
    expect(claim).toContain("75%");
    expect(claim).toContain("1B initial supply");
    expect(claim).toContain("Sablier");
  });

  it("shares the pill's percentage formatting", () => {
    expect(lockClaim(0.3, "2026-11-25T15:05:21.000Z")).toContain("<1%");
  });

  it("frames the date as an upper bound, not a duration for the whole amount", () => {
    // `unlocksAt` is the latest cliff across every lock on the token, so with
    // several locks only part of the percentage survives to that date.
    // "Locked until X" would over-state how much stays locked.
    const claim = lockClaim(75, "2026-11-25T15:05:21.000Z");
    expect(claim).toContain("fully released by");
    expect(claim).not.toContain("until");
  });

  it("drops the date clause when the timestamp is unusable", () => {
    const claim = lockClaim(75, "not-a-date");
    expect(claim).toBe("75% of the 1B initial supply is locked in Sablier");
    expect(claim).not.toContain("until");
  });
});
