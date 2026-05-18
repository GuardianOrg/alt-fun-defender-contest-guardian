import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Module-mock `services/api` so each test can swap `API_BASE` between
// the production `.alt.fun` host (transforms ON) and the local-dev
// `localhost` host (transforms OFF). `vi.resetModules()` + dynamic
// `import` is what lets the helper re-read the mock cleanly — its
// origin lookup is cached per-isolate behind a private `__reset` hook.
vi.mock("../services/api", () => ({ API_BASE: "https://api.alt.fun" }));

beforeEach(async () => {
  vi.resetModules();
  vi.doMock("../services/api", () => ({ API_BASE: "https://api.alt.fun" }));
});

afterEach(() => {
  vi.doUnmock("../services/api");
});

async function loadHelper() {
  const mod = await import("./image");
  mod.__resetApiOriginCacheForTests();
  return mod;
}

describe("transformImageUrl (enabled — api.alt.fun)", () => {
  it("rewrites an R2-served token image to the /cdn-cgi/image/ proxy", async () => {
    const { transformImageUrl } = await loadHelper();
    const out = transformImageUrl(
      "https://api.alt.fun/images/tokens/abc.png",
      { width: 64 },
    );
    expect(out).toBe(
      "https://api.alt.fun/cdn-cgi/image/width=64,quality=85,format=auto/images/tokens/abc.png",
    );
  });

  it("honors custom quality / format / fit options", async () => {
    const { transformImageUrl } = await loadHelper();
    const out = transformImageUrl(
      "https://api.alt.fun/images/tokens/abc.png",
      { width: 96, quality: 70, format: "webp", fit: "contain" },
    );
    expect(out).toBe(
      "https://api.alt.fun/cdn-cgi/image/width=96,quality=70,format=webp,fit=contain/images/tokens/abc.png",
    );
  });

  it("preserves the query string on the original URL", async () => {
    const { transformImageUrl } = await loadHelper();
    const out = transformImageUrl(
      "https://api.alt.fun/images/tokens/abc.png?v=2",
      { width: 64 },
    );
    expect(out).toBe(
      "https://api.alt.fun/cdn-cgi/image/width=64,quality=85,format=auto/images/tokens/abc.png?v=2",
    );
  });

  it("returns the original src for the public DEFAULT_TOKEN_IMAGE path", async () => {
    const { transformImageUrl } = await loadHelper();
    // `/default-token-image.png` is served from the web app's own
    // origin (not the API), and the helper sees it as a root-relative
    // path that doesn't start with `http`.
    const out = transformImageUrl("/default-token-image.png", { width: 64 });
    expect(out).toBe("/default-token-image.png");
  });

  it("returns the original src for blob/data URIs (local upload preview)", async () => {
    const { transformImageUrl } = await loadHelper();
    expect(
      transformImageUrl("blob:https://alt.fun/abc-123", { width: 64 }),
    ).toBe("blob:https://alt.fun/abc-123");
    expect(
      transformImageUrl("data:image/png;base64,iVBORw0KG", { width: 64 }),
    ).toBe("data:image/png;base64,iVBORw0KG");
  });

  it("returns the original src for foreign origins (third-party CDNs)", async () => {
    const { transformImageUrl } = await loadHelper();
    const out = transformImageUrl(
      "https://other-cdn.example.com/logo.png",
      { width: 64 },
    );
    expect(out).toBe("https://other-cdn.example.com/logo.png");
  });

  it("does not double-wrap an already-transformed URL", async () => {
    const { transformImageUrl } = await loadHelper();
    const pre =
      "https://api.alt.fun/cdn-cgi/image/width=64,quality=85,format=auto/images/tokens/abc.png";
    expect(transformImageUrl(pre, { width: 128 })).toBe(pre);
  });

  it("returns empty string for empty input", async () => {
    const { transformImageUrl } = await loadHelper();
    expect(transformImageUrl("", { width: 64 })).toBe("");
  });

  it("passes undefined through unchanged (Token.image is optional)", async () => {
    const { transformImageUrl, srcSetFor } = await loadHelper();
    expect(transformImageUrl(undefined, { width: 64 })).toBeUndefined();
    expect(srcSetFor(undefined, 64)).toBe("");
  });
});

describe("srcSetFor (enabled — api.alt.fun)", () => {
  it("builds a 1x/2x retina pair at the requested width", async () => {
    const { srcSetFor } = await loadHelper();
    const out = srcSetFor("https://api.alt.fun/images/tokens/abc.png", 64);
    expect(out).toBe(
      "https://api.alt.fun/cdn-cgi/image/width=64,quality=85,format=auto/images/tokens/abc.png 1x, " +
        "https://api.alt.fun/cdn-cgi/image/width=128,quality=85,format=auto/images/tokens/abc.png 2x",
    );
  });

  it("returns an empty string when the src is non-transformable (caller omits srcSet)", async () => {
    const { srcSetFor } = await loadHelper();
    expect(srcSetFor("/default-token-image.png", 64)).toBe("");
    expect(srcSetFor("https://other-cdn.example.com/logo.png", 64)).toBe("");
    expect(srcSetFor("", 64)).toBe("");
  });
});

describe("transformImageUrl (disabled — local dev / non-alt.fun host)", () => {
  beforeEach(() => {
    vi.doMock("../services/api", () => ({ API_BASE: "http://localhost:8787" }));
  });

  it("returns the original src unchanged even for the API origin", async () => {
    const { transformImageUrl, srcSetFor } = await loadHelper();
    const localApiUrl = "http://localhost:8787/images/tokens/abc.png";
    expect(transformImageUrl(localApiUrl, { width: 64 })).toBe(localApiUrl);
    expect(srcSetFor(localApiUrl, 64)).toBe("");
  });
});
