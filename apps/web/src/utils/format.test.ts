import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RECENTLY_DEPLOYED_WINDOW_MS,
  formatMcapUsd,
  formatMcapUsdOrDash,
  formatUsd,
  getErrorMessage,
  isRecentlyDeployed,
} from "./format";

describe("getErrorMessage", () => {
  // viem's `ContractFunctionRevertedError` surfaces unknown 4-byte
  // selectors verbatim in the message. The `Clones.FailedDeployment()`
  // selector has no entry in the Bonding/Zap ABI (it lives in OZ's
  // `Clones` library), so prior to the explicit branch in
  // `getErrorMessage` users would see the raw `0xb06ebf3d` blob and
  // have no way to recover. This pins both the raw selector and the
  // decoded name to the same actionable copy.
  it("decodes the raw `0xb06ebf3d` selector to a name-collision message", () => {
    const message = getErrorMessage(
      new Error(
        'The contract function "createToken" reverted with the ' +
          "following signature: 0xb06ebf3d Unable to decode signature " +
          '"0xb06ebf3d" as it was not found on the provided ABI.',
      ),
    );
    expect(message).toMatch(/already exists for your wallet/i);
    expect(message).toMatch(/change the name or ticker/i);
  });

  it("decodes the named `FailedDeployment` selector the same way", () => {
    const message = getErrorMessage(
      new Error("execution reverted: FailedDeployment()"),
    );
    expect(message).toMatch(/already exists for your wallet/i);
  });

  // Some RPC/wallet error wrappers normalise the revert message casing
  // (e.g. lowercase the whole string before re-throwing). Without the
  // case-insensitive match the recovery path silently drops the user
  // back onto the raw error fallback.
  it("decodes a lowercased `faileddeployment` revert string", () => {
    const message = getErrorMessage(
      new Error("execution reverted: faileddeployment()"),
    );
    expect(message).toMatch(/already exists for your wallet/i);
  });

  // The min-amount selector predates this fix; included as a sanity
  // guard so the new branch doesn't shadow the existing one (both
  // strings match `/0x.*/`).
  it("still decodes the BounceTech min-amount selector", () => {
    const message = getErrorMessage(new Error("reverted with 0x05eb05ac"));
    expect(message).toMatch(/below minimum/i);
  });

  it("falls back to the raw error message for unknown reverts", () => {
    const message = getErrorMessage(new Error("something unfamiliar happened"));
    expect(message).toBe("something unfamiliar happened");
  });

  it("handles non-Error inputs without throwing", () => {
    expect(getErrorMessage("plain string error")).toBe("Transaction failed");
    expect(getErrorMessage(null)).toBe("Transaction failed");
  });
});

describe("isRecentlyDeployed", () => {
  // Pin wall-clock so each case has a deterministic delta from `now`.
  // Mirrors what TokenRow uses to decide whether to coerce null mcap /
  // 24h-change to `0` for fresh launches (issue #709).
  const NOW = new Date("2025-01-15T12:00:00.000Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for a token created seconds ago", () => {
    const createdAt = new Date(NOW - 5_000).toISOString();
    expect(isRecentlyDeployed(createdAt)).toBe(true);
  });

  it("returns true at the upper edge of the default 24h window", () => {
    // 1ms inside the window — should still count as recent.
    const createdAt = new Date(
      NOW - RECENTLY_DEPLOYED_WINDOW_MS + 1,
    ).toISOString();
    expect(isRecentlyDeployed(createdAt)).toBe(true);
  });

  it("returns false at exactly 24h old (strict <)", () => {
    const createdAt = new Date(NOW - RECENTLY_DEPLOYED_WINDOW_MS).toISOString();
    expect(isRecentlyDeployed(createdAt)).toBe(false);
  });

  it("returns false for tokens older than 24h", () => {
    const createdAt = new Date(
      NOW - 2 * RECENTLY_DEPLOYED_WINDOW_MS,
    ).toISOString();
    expect(isRecentlyDeployed(createdAt)).toBe(false);
  });

  // Don't accidentally hide indexer degradation behind a "0" placeholder
  // when `createdAt` is missing — treat unknown age as "old".
  it("returns false for null / undefined / empty createdAt", () => {
    expect(isRecentlyDeployed(null)).toBe(false);
    expect(isRecentlyDeployed(undefined)).toBe(false);
    expect(isRecentlyDeployed("")).toBe(false);
  });

  it("returns false for an unparseable createdAt", () => {
    expect(isRecentlyDeployed("not-a-date")).toBe(false);
  });

  it("respects a custom window override", () => {
    const oneHour = 60 * 60 * 1_000;
    const thirtyMinAgo = new Date(NOW - 30 * 60 * 1_000).toISOString();
    const twoHoursAgo = new Date(NOW - 2 * 60 * 60 * 1_000).toISOString();
    expect(isRecentlyDeployed(thirtyMinAgo, oneHour)).toBe(true);
    expect(isRecentlyDeployed(twoHoursAgo, oneHour)).toBe(false);
  });

  // A future `createdAt` is treated as corrupted / bad clock skew, not
  // a fresh launch — otherwise the row would lock to "0" until
  // wall-clock caught up to the bogus timestamp.
  it("returns false for a createdAt in the future", () => {
    const oneMinuteAhead = new Date(NOW + 60_000).toISOString();
    const wayInTheFuture = new Date(
      NOW + 365 * 24 * 60 * 60 * 1_000,
    ).toISOString();
    expect(isRecentlyDeployed(oneMinuteAhead)).toBe(false);
    expect(isRecentlyDeployed(wayInTheFuture)).toBe(false);
  });
});

describe("formatMcapUsd", () => {
  // Issue #711: a sub-$1K market cap was rendering as `$123.45` on the
  // home-page rows. Sub-dollar precision on a market cap is noise — the
  // trailing cents distract from the column rather than informing it —
  // so the mcap-specific formatter rounds the sub-$1K regime to whole
  // dollars while leaving the K/M ranges identical to `formatUsd`.
  it("rounds sub-$1K values to whole dollars (no decimals)", () => {
    expect(formatMcapUsd(123.45)).toBe("$123");
    expect(formatMcapUsd(0.99)).toBe("$1");
    expect(formatMcapUsd(0)).toBe("$0");
    expect(formatMcapUsd(999.99)).toBe("$1,000");
  });

  // The K/M ranges deliberately mirror `formatUsd` — only the sub-$1K
  // regime changes. Pin both halves so a future refactor of either
  // formatter can't silently drift them apart.
  it("matches formatUsd for the K and M ranges", () => {
    const samples = [1_000, 1_234, 9_999, 10_000, 12_345, 999_999, 1_000_000, 12_345_678];
    for (const value of samples) {
      expect(formatMcapUsd(value)).toBe(formatUsd(value));
    }
  });

  it("uses locale separators for sub-$1K values that round to ≥ 1000", () => {
    expect(formatMcapUsd(999.5)).toBe("$1,000");
  });

  // A degraded indexer / off-by-one rounding upstream could surface a
  // tiny negative mcap; clamp to `$0` instead of leaking a `-$0` (which
  // `Math.round(-0.4).toLocaleString()` would otherwise produce).
  it("clamps negative inputs to $0", () => {
    expect(formatMcapUsd(-0.4)).toBe("$0");
    expect(formatMcapUsd(-50)).toBe("$0");
    expect(formatMcapUsd(-1_500_000)).toBe("$0");
  });

  // Without the `Number.isFinite` guard, `formatMcapUsd(NaN)` collapses
  // to `$NaN` and `Infinity` falls through to the M branch as
  // `$InfinityM`. Both surface in production whenever an upstream
  // division by a degraded `priceUsd === 0` field returns a non-finite
  // value — so `$0` is the safe rendering until real data arrives.
  it("collapses non-finite inputs to $0 rather than leaking $NaN / $InfinityM", () => {
    expect(formatMcapUsd(Number.NaN)).toBe("$0");
    expect(formatMcapUsd(Number.POSITIVE_INFINITY)).toBe("$0");
    expect(formatMcapUsd(Number.NEGATIVE_INFINITY)).toBe("$0");
  });
});

describe("formatMcapUsdOrDash", () => {
  it("renders an em-dash for null and undefined", () => {
    expect(formatMcapUsdOrDash(null)).toBe("—");
    expect(formatMcapUsdOrDash(undefined)).toBe("—");
  });

  it("delegates to formatMcapUsd for finite numbers", () => {
    expect(formatMcapUsdOrDash(123.45)).toBe("$123");
    expect(formatMcapUsdOrDash(12_345)).toBe("$12K");
  });
});
