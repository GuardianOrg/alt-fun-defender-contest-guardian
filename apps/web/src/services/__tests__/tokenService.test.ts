import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fromApiToken, TOKENS_PAGE_SIZE, tokenService } from "../tokenService";

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

describe("getTokensPage", () => {
  // Capture the URL the implementation hits so we can assert pagination
  // params (limit/offset) and the filter→sort/status mapping in one go.
  let fetchMock: ReturnType<typeof vi.fn>;
  const okJson = (data: ApiToken[]) =>
    new Response(JSON.stringify({ status: "success", data, error: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  beforeEach(() => {
    fetchMock = vi.fn(async (_input: RequestInfo | URL) => okJson([]));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function lastUrl(): URL {
    const call = fetchMock.mock.calls.at(-1);
    if (!call) throw new Error("fetch was never called");
    const raw = call[0];
    return new URL(typeof raw === "string" ? raw : raw.toString());
  }

  it("forwards offset and limit to the tokens endpoint", async () => {
    await tokenService.getTokensPage("new", 60, TOKENS_PAGE_SIZE);

    const url = lastUrl();
    expect(url.pathname).toBe("/api/v1/tokens");
    expect(url.searchParams.get("offset")).toBe("60");
    expect(url.searchParams.get("limit")).toBe(String(TOKENS_PAGE_SIZE));
    // `new` is the default `createdAt desc` sort, so no `sort=…` should
    // be appended — the API picks it up implicitly. Asserting the
    // absence prevents the home-page page-2 fetch from drifting to a
    // different ordering than page 1.
    expect(url.searchParams.has("sort")).toBe(false);
    expect(url.searchParams.has("status")).toBe(false);
  });

  it("maps `trending` to `sort=trending`", async () => {
    await tokenService.getTokensPage("trending", 0, TOKENS_PAGE_SIZE);
    expect(lastUrl().searchParams.get("sort")).toBe("trending");
  });

  it("maps `graduating` to `status=graduating`", async () => {
    await tokenService.getTokensPage("graduating", 0, TOKENS_PAGE_SIZE);
    expect(lastUrl().searchParams.get("status")).toBe("graduating");
  });

  it("maps `graduated` to `status=graduated`", async () => {
    await tokenService.getTokensPage("graduated", 0, TOKENS_PAGE_SIZE);
    expect(lastUrl().searchParams.get("status")).toBe("graduated");
  });

  it("rejects rather than silently returning an empty page on API error", async () => {
    // The infinite-scroll caller leans on a thrown error to mark the page
    // as failed (so TanStack Query keeps `hasNextPage` accurate). If we
    // silently swallowed errors here, the list would stop loading without
    // any retry path and the user would see a half-loaded catalogue.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: "error", data: null, error: "boom" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      tokenService.getTokensPage("trending", 0, TOKENS_PAGE_SIZE),
    ).rejects.toThrow("boom");
  });

  it("forwards underlying/leverage/direction facets as query params", async () => {
    await tokenService.getTokensPage("trending", 0, TOKENS_PAGE_SIZE, {
      underlying: "HYPE",
      leverage: 3,
      direction: "short",
    });

    const url = lastUrl();
    expect(url.searchParams.get("sort")).toBe("trending");
    expect(url.searchParams.get("underlying")).toBe("HYPE");
    expect(url.searchParams.get("leverage")).toBe("3");
    expect(url.searchParams.get("direction")).toBe("short");
  });

  it("omits unset facet params so the cache key stays minimal", async () => {
    await tokenService.getTokensPage("new", 0, TOKENS_PAGE_SIZE, {
      direction: "long",
    });

    const url = lastUrl();
    expect(url.searchParams.get("direction")).toBe("long");
    expect(url.searchParams.has("underlying")).toBe(false);
    expect(url.searchParams.has("leverage")).toBe(false);
  });

  it("ignores an empty facets object", async () => {
    await tokenService.getTokensPage("trending", 0, TOKENS_PAGE_SIZE, {});

    const url = lastUrl();
    expect(url.searchParams.has("underlying")).toBe(false);
    expect(url.searchParams.has("leverage")).toBe(false);
    expect(url.searchParams.has("direction")).toBe(false);
  });
});
