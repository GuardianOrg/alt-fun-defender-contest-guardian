import { describe, it, expect } from "vitest";

import {
  CDN_CACHE_CONTROL_HEADER,
  applyEdgeCacheHeaders,
  cdnEdgeCacheHeader,
  edgeCacheableJsonHeader,
  setEdgeCacheHeaders,
  setImmutableAssetHeaders,
} from "../utils/cache-control.js";

/** Stand-in for the `c.header(...)` surface the Hono context exposes. */
function headerCollector() {
  const headers = new Map<string, string>();
  return {
    header: (key: string, value: string) => headers.set(key, value),
    get: (key: string) => headers.get(key) ?? null,
  };
}

describe("edgeCacheableJsonHeader", () => {
  it("declares max-age=0 so the browser can't apply heuristic freshness", () => {
    expect(edgeCacheableJsonHeader(30)).toBe(
      "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
    );
  });

  it("accepts a stale window that isn't the 2× default", () => {
    expect(edgeCacheableJsonHeader(300, 3600)).toBe(
      "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
    );
  });
});

describe("cdnEdgeCacheHeader", () => {
  it("uses max-age, not s-maxage — s-maxage disables Cloudflare's own SWR", () => {
    expect(cdnEdgeCacheHeader(30)).toBe(
      "public, max-age=30, stale-while-revalidate=60",
    );
    expect(cdnEdgeCacheHeader(30)).not.toContain("s-maxage");
  });

  it("accepts a stale window that isn't the 2× default", () => {
    expect(cdnEdgeCacheHeader(15, 60)).toBe(
      "public, max-age=15, stale-while-revalidate=60",
    );
  });
});

describe("setEdgeCacheHeaders", () => {
  it("stamps both the browser/Worker and the Cloudflare-zone directive", () => {
    const c = headerCollector();
    setEdgeCacheHeaders(c, 15);

    expect(c.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
    );
    expect(c.get(CDN_CACHE_CONTROL_HEADER)).toBe(
      "public, max-age=15, stale-while-revalidate=30",
    );
  });

  it("threads a custom stale window into both directives", () => {
    const c = headerCollector();
    setEdgeCacheHeaders(c, 300, 3600);

    expect(c.get("Cache-Control")).toContain("stale-while-revalidate=3600");
    expect(c.get(CDN_CACHE_CONTROL_HEADER)).toContain(
      "stale-while-revalidate=3600",
    );
  });
});

describe("applyEdgeCacheHeaders", () => {
  it("stamps both directives on an existing response and returns it", () => {
    const response = new Response("{}", { status: 200 });
    const returned = applyEdgeCacheHeaders(response, 5);

    expect(returned).toBe(response);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=5, stale-while-revalidate=10",
    );
    expect(response.headers.get(CDN_CACHE_CONTROL_HEADER)).toBe(
      "public, max-age=5, stale-while-revalidate=10",
    );
  });
});

describe("setImmutableAssetHeaders", () => {
  it("gives the browser the full year too — the key is content-addressed", () => {
    const c = headerCollector();
    setImmutableAssetHeaders(c);

    expect(c.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(c.get(CDN_CACHE_CONTROL_HEADER)).toBe(
      "public, max-age=31536000, immutable",
    );
  });
});
