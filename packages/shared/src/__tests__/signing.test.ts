import { describe, it, expect } from "vitest";

import { isAdminWallet } from "../constants/admin.js";
import {
  buildProfileUpdateMessage,
  buildSessionMessage,
  SESSION_DURATION_MS,
} from "../signing.js";
import type { ProfileUpdatePayload } from "../signing.js";

describe("buildProfileUpdateMessage", () => {
  const payload: ProfileUpdatePayload = {
    address: "0xuser123",
    displayName: "Alice",
    bio: "Hello world",
    twitterUrl: "https://twitter.com/alice",
    timestamp: 1700000000,
  };

  it("starts with the domain separator", () => {
    const msg = buildProfileUpdateMessage(payload);
    expect(msg.startsWith("Update profile\n")).toBe(true);
  });

  it("includes all fields in correct order", () => {
    const msg = buildProfileUpdateMessage(payload);
    const lines = msg.split("\n");
    expect(lines).toEqual([
      "Update profile",
      "address:0xuser123",
      "displayName:Alice",
      "bio:Hello world",
      "twitterUrl:https://twitter.com/alice",
      "timestamp:1700000000",
    ]);
  });

  it("has exactly 6 lines", () => {
    const msg = buildProfileUpdateMessage(payload);
    expect(msg.split("\n")).toHaveLength(6);
  });

  it("handles empty optional fields", () => {
    const msg = buildProfileUpdateMessage({
      ...payload,
      displayName: "",
      bio: "",
      twitterUrl: "",
    });
    expect(msg).toContain("displayName:");
    expect(msg).toContain("bio:");
    expect(msg).toContain("twitterUrl:");
  });
});

describe("buildSessionMessage", () => {
  const address = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
  const expiresAt = 1700000000000;

  it("starts with the domain separator", () => {
    const msg = buildSessionMessage(address, expiresAt);
    expect(msg.startsWith("Sign in to Alt Fun\n")).toBe(true);
  });

  it("includes address and expiresAt in correct order", () => {
    const msg = buildSessionMessage(address, expiresAt);
    const lines = msg.split("\n");
    expect(lines).toEqual([
      "Sign in to Alt Fun",
      `address:${address}`,
      `expiresAt:${expiresAt}`,
    ]);
  });

  it("has exactly 3 lines", () => {
    const msg = buildSessionMessage(address, expiresAt);
    expect(msg.split("\n")).toHaveLength(3);
  });
});

describe("SESSION_DURATION_MS", () => {
  it("is 24 hours in milliseconds", () => {
    expect(SESSION_DURATION_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("isAdminWallet", () => {
  const allowlist = [
    "0xef126Ea643fC8940D9D6634DCd07F3989963Fbe6",
    "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
  ];

  it("matches the canonical checksum address", () => {
    expect(
      isAdminWallet("0xef126Ea643fC8940D9D6634DCd07F3989963Fbe6", allowlist),
    ).toBe(true);
  });

  it("matches lowercased input", () => {
    expect(
      isAdminWallet("0xef126ea643fc8940d9d6634dcd07f3989963fbe6", allowlist),
    ).toBe(true);
  });

  it("matches lowercased allowlist entries too", () => {
    expect(
      isAdminWallet("0xEF126EA643FC8940D9D6634DCD07F3989963FBE6", [
        "0xef126ea643fc8940d9d6634dcd07f3989963fbe6",
      ]),
    ).toBe(true);
  });

  it("rejects an address not in the allowlist", () => {
    expect(
      isAdminWallet("0x1111111111111111111111111111111111111111", allowlist),
    ).toBe(false);
  });

  it("returns false for empty / null / undefined input", () => {
    expect(isAdminWallet(null, allowlist)).toBe(false);
    expect(isAdminWallet(undefined, allowlist)).toBe(false);
    expect(isAdminWallet("", allowlist)).toBe(false);
  });

  it("rejects malformed input that isn't a 0x-prefixed 40-hex address", () => {
    // Guards against malformed-address bypass patterns: missing prefix,
    // truncated, non-hex char, off-by-one length. All must reject so a
    // typo can't accidentally produce a falsy lower-cased match.
    expect(isAdminWallet("ef126Ea643fC8940D9D6634DCd07F3989963Fbe6", allowlist)).toBe(false);
    expect(isAdminWallet("0xef126ea", allowlist)).toBe(false);
    expect(isAdminWallet("0xZZ126Ea643fC8940D9D6634DCd07F3989963Fbe6", allowlist)).toBe(false);
    expect(isAdminWallet("0xef126Ea643fC8940D9D6634DCd07F3989963Fb6", allowlist)).toBe(false);
  });

  it("skips malformed allowlist entries instead of treating them as matches", () => {
    // A garbage entry alongside a legit one — legit one still matches,
    // garbage doesn't accidentally pass through as a wildcard.
    expect(
      isAdminWallet("0xef126Ea643fC8940D9D6634DCd07F3989963Fbe6", [
        "not-an-address",
        "0xef126Ea643fC8940D9D6634DCd07F3989963Fbe6",
      ]),
    ).toBe(true);
    expect(
      isAdminWallet("not-an-address", ["not-an-address"]),
    ).toBe(false);
  });
});
