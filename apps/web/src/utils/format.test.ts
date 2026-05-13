import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RECENTLY_DEPLOYED_WINDOW_MS,
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
