import { describe, it, expect } from "vitest";

import {
  buildCommentMessage,
  buildProfileUpdateMessage,
  buildSessionMessage,
  SESSION_DURATION_MS,
} from "../signing.js";
import type { ProfileUpdatePayload } from "../signing.js";

describe("buildCommentMessage", () => {
  it("starts with the domain separator", () => {
    const msg = buildCommentMessage("0xtoken", "Hello", 1700000000);
    expect(msg.startsWith("Post comment\n")).toBe(true);
  });

  it("includes token, content, and timestamp in correct order", () => {
    const msg = buildCommentMessage("0xtoken", "Great project!", 1700000000);
    const lines = msg.split("\n");
    expect(lines).toEqual([
      "Post comment",
      "token:0xtoken",
      "content:Great project!",
      "timestamp:1700000000",
    ]);
  });

  it("has exactly 4 lines", () => {
    const msg = buildCommentMessage("0xtoken", "test", 123);
    expect(msg.split("\n")).toHaveLength(4);
  });

  it("includes the timestamp value", () => {
    const ts = 1700000000;
    const msg = buildCommentMessage("0xtoken", "test", ts);
    expect(msg).toContain(`timestamp:${ts}`);
  });
});

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
