import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";

import { serveFromEdgeCache } from "../middleware/edge-cache.js";
import {
  SWR_REVALIDATE_HEADER,
  putWithSwr,
} from "../utils/swr-cache.js";
import { edgeCacheableJsonHeader } from "../utils/cache-control.js";
import type { AppBindings } from "../lib/types.js";

/**
 * Fake `caches.default` backed by an in-memory map keyed on the
 * request URL. Mirrors Cloudflare's real Cache API closely enough for
 * the middleware's `match`/`put` contract; per the platform docs the
 * cache is URL-keyed and only stores Responses with cacheable status
 * codes (we only care about 200 here, so the lifting is minimal).
 */
function installFakeCache(): { match: ReturnType<typeof vi.fn> } {
  const store = new Map<string, Response>();
  const match = vi.fn(async (req: Request) => {
    const stored = store.get(req.url);
    return stored ? stored.clone() : undefined;
  });
  const put = vi.fn(async (req: Request, res: Response) => {
    store.set(req.url, res.clone());
  });
  (globalThis as { caches?: { default: unknown } }).caches = {
    default: { match, put },
  };
  return { match };
}

function uninstallCache() {
  delete (globalThis as { caches?: unknown }).caches;
}

function makeEnv(): AppBindings {
  return {
    ADMIN_API_KEY: "",
    DATABASE_URL: "",
    BOUNCETECH_DATABASE_URL: "",
    PONDER_URL: "",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

describe("serveFromEdgeCache middleware", () => {
  beforeEach(() => {
    uninstallCache();
  });

  it("serves a cached response without invoking downstream handlers", async () => {
    const cacheStore = new Map<string, Response>();
    const cached = new Response(
      JSON.stringify({ cached: true }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
    cacheStore.set("http://localhost/api/v1/tokens", cached);
    (globalThis as { caches?: { default: unknown } }).caches = {
      default: {
        match: async (req: Request) => {
          const hit = cacheStore.get(req.url);
          return hit ? hit.clone() : undefined;
        },
        put: vi.fn(),
      },
    };

    const downstream = vi.fn((c) => c.json({ cached: false }));
    const app = new Hono<{ Bindings: AppBindings }>();
    app.use("/api/v1/*", serveFromEdgeCache);
    app.get("/api/v1/tokens", downstream);

    const res = await app.request("/api/v1/tokens", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cached: boolean };
    expect(body.cached).toBe(true);
    expect(downstream).not.toHaveBeenCalled();
  });

  it("falls through when the cache misses", async () => {
    installFakeCache();

    const downstream = vi.fn((c) => c.json({ ok: true }));
    const app = new Hono<{ Bindings: AppBindings }>();
    app.use("/api/v1/*", serveFromEdgeCache);
    app.get("/api/v1/tokens", downstream);

    const res = await app.request("/api/v1/tokens", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(downstream).toHaveBeenCalledOnce();
  });

  it("never serves from cache for non-GET requests", async () => {
    // A cache entry exists but a POST must still run the full chain —
    // otherwise a write would silently no-op behind a stale read entry.
    const cacheStore = new Map<string, Response>();
    cacheStore.set(
      "http://localhost/api/v1/tokens",
      new Response(JSON.stringify({ stale: true }), { status: 200 }),
    );
    (globalThis as { caches?: { default: unknown } }).caches = {
      default: {
        match: async (req: Request) => {
          const hit = cacheStore.get(req.url);
          return hit ? hit.clone() : undefined;
        },
        put: vi.fn(),
      },
    };

    const downstream = vi.fn((c) => c.json({ wrote: true }));
    const app = new Hono<{ Bindings: AppBindings }>();
    app.use("/api/v1/*", serveFromEdgeCache);
    app.post("/api/v1/tokens", downstream);

    const res = await app.request(
      "/api/v1/tokens",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { wrote: boolean };
    expect(body.wrote).toBe(true);
    expect(downstream).toHaveBeenCalledOnce();
  });

  it("falls through when no global caches API is available", async () => {
    // Some test environments (and the vitest default) don't expose
    // `globalThis.caches`. The middleware must no-op rather than throw.
    uninstallCache();

    const downstream = vi.fn((c) => c.json({ ok: true }));
    const app = new Hono<{ Bindings: AppBindings }>();
    app.use("/api/v1/*", serveFromEdgeCache);
    app.get("/api/v1/tokens", downstream);

    const res = await app.request("/api/v1/tokens", {}, makeEnv());
    expect(res.status).toBe(200);
    expect(downstream).toHaveBeenCalledOnce();
  });

  it("serves the stale-fallback body and schedules a background refresh once the canonical entry expires", async () => {
    // Seed the cache via `putWithSwr` (canonical + stale-fallback
    // copy), then evict the canonical entry to mimic `s-maxage`
    // expiry. The middleware must hand back the stale body
    // immediately + queue a `waitUntil` self-fetch carrying the
    // revalidation marker.
    const store = new Map<string, Response>();
    const fakeCache = {
      match: async (req: Request) => {
        const stored = store.get(req.url);
        return stored ? stored.clone() : undefined;
      },
      put: async (req: Request, res: Response) => {
        store.set(req.url, res.clone());
      },
      delete: async (req: Request) => store.delete(req.url),
    };
    (globalThis as { caches?: { default: unknown } }).caches = {
      default: fakeCache,
    };

    const primary = new Request("http://localhost/api/v1/tokens?sort=trending", {
      method: "GET",
    });
    const seeded = new Response(JSON.stringify({ body: "stale" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": edgeCacheableJsonHeader(5),
      },
    });
    await putWithSwr(fakeCache as unknown as Cache, primary, seeded);
    // Force a canonical-entry miss. The stale-fallback sibling key
    // (`?__swr_stale=1`) survives, which is what enables the SWR serve.
    await fakeCache.delete(primary);

    const capturedFetches: Request[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const req = input instanceof Request ? input : new Request(String(input));
      capturedFetches.push(req);
      return new Response(null, { status: 200 });
    });
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    try {
      const downstream = vi.fn((c) => c.json({ body: "fresh-but-should-not-run" }));
      const app = new Hono<{ Bindings: AppBindings }>();
      app.use("/api/v1/*", serveFromEdgeCache);
      app.get("/api/v1/tokens", downstream);

      const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
      const res = await app.fetch(
        new Request("http://localhost/api/v1/tokens?sort=trending"),
        makeEnv(),
        executionCtx as unknown as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { body: string };
      expect(body.body).toBe("stale");
      expect(downstream).not.toHaveBeenCalled();
      // The middleware must have scheduled exactly one background
      // refresh — `waitUntil` is the only hook the platform gives us
      // to keep the fetch alive past the response return.
      expect(executionCtx.waitUntil).toHaveBeenCalledTimes(1);

      // Drain the queued promise so `fetch` actually runs before we
      // assert on the captured call.
      const waited = (executionCtx.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0][0];
      await waited;
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(capturedFetches).toHaveLength(1);
      expect(capturedFetches[0].headers.get(SWR_REVALIDATE_HEADER)).toBe("1");
      expect(capturedFetches[0].url).toContain("sort=trending");
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it("bypasses the cache when the SWR revalidation marker is set", async () => {
    // The background self-fetch from a stale serve carries
    // `X-SWR-Revalidate: 1`. The middleware must skip its cache
    // lookup so the refresh request reaches the route handler and
    // writes a fresh canonical + stale pair.
    const cacheStore = new Map<string, Response>();
    cacheStore.set(
      "http://localhost/api/v1/tokens",
      new Response(JSON.stringify({ cached: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    (globalThis as { caches?: { default: unknown } }).caches = {
      default: {
        match: async (req: Request) => {
          const hit = cacheStore.get(req.url);
          return hit ? hit.clone() : undefined;
        },
        put: vi.fn(),
      },
    };

    const downstream = vi.fn((c) => c.json({ refreshed: true }));
    const app = new Hono<{ Bindings: AppBindings }>();
    app.use("/api/v1/*", serveFromEdgeCache);
    app.get("/api/v1/tokens", downstream);

    const res = await app.request(
      "/api/v1/tokens",
      { headers: { [SWR_REVALIDATE_HEADER]: "1" } },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { refreshed: boolean };
    expect(body.refreshed).toBe(true);
    expect(downstream).toHaveBeenCalledOnce();
  });

  it("bypasses auth-style downstream middleware on a cache hit", async () => {
    // The whole point of this middleware: a cache hit must not consume
    // an `apiKeyAuth` rate-limit slot. Verify by chaining a downstream
    // middleware that always rejects, then confirming the cache hit
    // wins.
    const cacheStore = new Map<string, Response>();
    cacheStore.set(
      "http://localhost/api/v1/tokens",
      new Response(JSON.stringify({ cached: true }), { status: 200 }),
    );
    (globalThis as { caches?: { default: unknown } }).caches = {
      default: {
        match: async (req: Request) => {
          const hit = cacheStore.get(req.url);
          return hit ? hit.clone() : undefined;
        },
        put: vi.fn(),
      },
    };

    const fakeAuth = vi.fn((c) =>
      c.json({ status: "error", error: "Rate limit exceeded", data: null }, 429),
    );
    const app = new Hono<{ Bindings: AppBindings }>();
    app.use("/api/v1/*", serveFromEdgeCache);
    app.use("/api/v1/*", fakeAuth);
    app.get("/api/v1/tokens", (c) => c.json({ cached: false }));

    const res = await app.request("/api/v1/tokens", {}, makeEnv());
    expect(res.status).toBe(200);
    expect(fakeAuth).not.toHaveBeenCalled();
  });
});
