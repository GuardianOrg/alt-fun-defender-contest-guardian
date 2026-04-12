import { describe, it, expect } from "vitest";

import {
  buildTokenCreationMessage,
  buildCommentMessage,
  buildProfileUpdateMessage,
} from "../signing.js";
import type { TokenCreationPayload, ProfileUpdatePayload } from "../signing.js";

describe("buildTokenCreationMessage", () => {
  const payload: TokenCreationPayload = {
    address: "0xabc123",
    name: "Test Token",
    ticker: "TEST",
    description: "A test memecoin",
    imageUrl: "https://example.com/img.png",
    ltPair: "HYPE",
    ltDirection: "long",
    leverage: 2,
    creator: "0xcreator",
  };

  it("starts with the domain separator", () => {
    const msg = buildTokenCreationMessage(payload);
    expect(msg.startsWith("Create token metadata\n")).toBe(true);
  });

  it("includes all fields in correct order", () => {
    const msg = buildTokenCreationMessage(payload);
    const lines = msg.split("\n");
    expect(lines).toEqual([
      "Create token metadata",
      "address:0xabc123",
      "name:Test Token",
      "ticker:TEST",
      "description:A test memecoin",
      "imageUrl:https://example.com/img.png",
      "ltPair:HYPE",
      "ltDirection:long",
      "leverage:2",
      "creator:0xcreator",
    ]);
  });

  it("has exactly 10 lines", () => {
    const msg = buildTokenCreationMessage(payload);
    expect(msg.split("\n")).toHaveLength(10);
  });

  it("formats leverage as a number string", () => {
    const msg = buildTokenCreationMessage({ ...payload, leverage: 5 });
    expect(msg).toContain("leverage:5");
  });
});

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
