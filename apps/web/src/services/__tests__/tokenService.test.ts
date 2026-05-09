import { describe, expect, it } from "vitest";

import { fromApiToken } from "../tokenService";

import type { ApiToken } from "../api";

const baseApiToken: ApiToken = {
  address: "0xabc",
  name: "Test",
  ticker: "TEST",
  description: "",
  imageUrl: "",
  ltPair: "HYPE2L",
  ltDirection: "long",
  leverage: 2,
  underlying: "HYPE",
  status: "curve",
  twitterUrl: "",
  telegramUrl: "",
  websiteUrl: "",
  creator: "0xdef",
  isHidden: false,
  createdAt: "2025-01-01T00:00:00Z",
};

describe("fromApiToken socialLinks", () => {
  it("expands bare Twitter / Telegram handles + bare website to fully-qualified URLs", () => {
    // Mirrors what the API actually stores (see
    // `apps/api/src/lib/token-registration.ts`): Twitter and Telegram are
    // bare handles, website is the full URL the sanitiser rewrote it to.
    // Issue #471: rendering `href="alice"` produces a relative URL that
    // 404s under `https://alt.fun/alice`.
    const token = fromApiToken({
      ...baseApiToken,
      twitterUrl: "alice",
      telegramUrl: "alice",
      websiteUrl: "https://example.com/",
    });

    expect(token.socialLinks).toStrictEqual({
      twitter: "https://x.com/alice",
      telegram: "https://t.me/alice",
      website: "https://example.com/",
    });
  });

  it("expands a Telegram invite-link tail to a t.me/+… URL", () => {
    const token = fromApiToken({
      ...baseApiToken,
      telegramUrl: "+abc1234",
    });

    expect(token.socialLinks?.telegram).toBe("https://t.me/+abc1234");
  });

  it("returns undefined socialLinks when every field is empty", () => {
    const token = fromApiToken(baseApiToken);
    expect(token.socialLinks).toBeUndefined();
  });

  it("drops fields that fail the shared sanitisation gate", () => {
    // A `javascript:` payload is rejected by `buildTwitterUrl`; the resulting
    // `socialLinks` should silently omit Twitter rather than render a
    // tampered link. See `packages/shared/src/social-links.ts`.
    const token = fromApiToken({
      ...baseApiToken,
      twitterUrl: "javascript:alert(1)",
      websiteUrl: "https://example.com/",
    });

    // `toStrictEqual` (rather than `toEqual`) so the assertion fails if
    // the implementation regresses to `{ website, twitter: undefined }`
    // — `toEqual` ignores explicit `undefined` keys.
    expect(token.socialLinks).toStrictEqual({
      website: "https://example.com/",
    });
  });
});
