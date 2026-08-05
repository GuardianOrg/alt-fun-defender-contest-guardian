import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

import {
  SWR_REVALIDATE_HEADER,
  _resetRevalidationTracking,
  isRevalidationRequest,
  matchSwr,
  putWithSwr,
  revalidateInBackground,
} from "../utils/swr-cache.js";
import {
  applyEdgeCacheHeaders,
  edgeCacheableJsonHeader,
} from "../utils/cache-control.js";

import type { AppBindings } from "../lib/types.js";

/**
 * Minimal `Cache`-shaped fake backed by a URL-keyed map. Mirrors the
 * subset of the Cloudflare Cache API that {@link matchSwr} and
 * {@link putWithSwr} touch (`match` + `put`). Returns clones so the
 * caller can't mutate stored bodies between calls — same property the
 * platform's real cache provides.
 */
function makeFakeCache(): Cache {
  const store = new Map<string, Response>();
  return {
    match: vi.fn(async (req: Request | string) => {
      const url = typeof req === "string" ? req : req.url;
      const stored = store.get(url);
      return stored ? stored.clone() : undefined;
    }),
    put: vi.fn(async (req: Request | string, res: Response) => {
      const url = typeof req === "string" ? req : req.url;
      store.set(url, res.clone());
    }),
    // Real eviction so tests can simulate `s-maxage` expiry of the
    // canonical entry without touching the stale-fallback sibling.
    delete: vi.fn(async (req: Request | string) => {
      const url = typeof req === "string" ? req : req.url;
      return store.delete(url);
    }),
    matchAll: vi.fn(async () => []),
    add: vi.fn(),
    addAll: vi.fn(),
  } as unknown as Cache;
}

function makeEnv(): AppBindings {
  return {
    ADMIN_API_KEY: "",
    DATABASE_URL: "",
    BOUNCETECH_DATABASE_URL: "",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

function makeJsonResponse(body: unknown, ttlSec = 5): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": edgeCacheableJsonHeader(ttlSec),
    },
  });
}

describe("putWithSwr", () => {
  it("writes a stale-fallback copy alongside the canonical entry", async () => {
    const cache = makeFakeCache();
    const primary = new Request("http://localhost/api/v1/tokens?sort=trending");
    const response = makeJsonResponse({ ok: true }, 5);

    await putWithSwr(cache, primary, response);

    expect((cache.put as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    // Verify the response can still be consumed by the caller — `putWithSwr`
    // must clone before reading the body, otherwise the route handler
    // couldn't return the same response object it just cached.
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("marks the stale-fallback copy no-store for the zone", async () => {
    // The stale body is only ever served past its freshness window;
    // re-admitting it to the zone for another full TTL would stretch
    // staleness beyond what the route declared. Explicit `no-store`
    // rather than an absent header, so the stretched `s-maxage` can't be
    // picked up as the zone policy.
    const cache = makeFakeCache();
    const primary = new Request("http://localhost/api/v1/tokens?stalecdn=1");
    const response = makeJsonResponse({ ok: true }, 5);
    applyEdgeCacheHeaders(response, 5);

    await putWithSwr(cache, primary, response);

    const staleWrite = (cache.put as ReturnType<typeof vi.fn>).mock.calls[1];
    const staleResponse = staleWrite[1] as Response;
    expect(staleResponse.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "no-store",
    );
    expect(staleResponse.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=15",
    );
  });

  it("falls back to a single put when the Cache-Control header has no SWR directive", async () => {
    const cache = makeFakeCache();
    const primary = new Request("http://localhost/api/v1/tokens?nostale=1");
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=0, s-maxage=5",
      },
    });

    await putWithSwr(cache, primary, response);

    expect((cache.put as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("falls back to a single put when Cache-Control is absent entirely", async () => {
    const cache = makeFakeCache();
    const primary = new Request("http://localhost/api/v1/tokens?nocc=1");
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await putWithSwr(cache, primary, response);

    expect((cache.put as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});

describe("matchSwr", () => {
  it("returns `fresh` when the canonical entry exists", async () => {
    const cache = makeFakeCache();
    const primary = new Request("http://localhost/api/v1/tokens?fresh=1");
    await putWithSwr(cache, primary, makeJsonResponse({ ok: true }, 5));

    const result = await matchSwr(cache, primary);
    expect(result.kind).toBe("fresh");
    if (result.kind !== "fresh") throw new Error("unreachable");
    const body = (await result.response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns `stale` when only the stale-fallback copy survives", async () => {
    const cache = makeFakeCache();
    const primary = new Request("http://localhost/api/v1/tokens?stale=1");
    await putWithSwr(cache, primary, makeJsonResponse({ ok: "stale" }, 5));

    // Simulate canonical-entry expiry by deleting it from the underlying
    // store. `caches.default` will return `undefined` from `match` once
    // `s-maxage` is exceeded — same observable effect.
    await cache.delete(primary);

    const result = await matchSwr(cache, primary);
    expect(result.kind).toBe("stale");
    if (result.kind !== "stale") throw new Error("unreachable");
    const body = (await result.response.json()) as { ok: string };
    expect(body.ok).toBe("stale");
  });

  it("returns `miss` when neither entry is present", async () => {
    const cache = makeFakeCache();
    const primary = new Request("http://localhost/api/v1/tokens?miss=1");
    const result = await matchSwr(cache, primary);
    expect(result.kind).toBe("miss");
  });
});

describe("isRevalidationRequest", () => {
  it("recognises the SWR refresh marker on a Hono context", async () => {
    let seen: boolean | undefined;
    const app = new Hono<{ Bindings: AppBindings }>();
    app.get("/probe", (c) => {
      seen = isRevalidationRequest(c);
      return c.json({ ok: true });
    });

    await app.request(
      "/probe",
      { headers: { [SWR_REVALIDATE_HEADER]: "1" } },
      makeEnv(),
    );
    expect(seen).toBe(true);
  });

  it("returns false on a normal user request", async () => {
    let seen: boolean | undefined;
    const app = new Hono<{ Bindings: AppBindings }>();
    app.get("/probe", (c) => {
      seen = isRevalidationRequest(c);
      return c.json({ ok: true });
    });

    await app.request("/probe", {}, makeEnv());
    expect(seen).toBe(false);
  });
});

describe("revalidateInBackground", () => {
  it("re-fetches the same URL with the revalidation marker header", async () => {
    const originalFetch = globalThis.fetch;
    const captured: Array<{ url: string; marker: string | null }> = [];
    (globalThis as { fetch: typeof fetch }).fetch = (async (
      input: RequestInfo | URL,
    ) => {
      const req = input instanceof Request ? input : new Request(String(input));
      captured.push({
        url: req.url,
        marker: req.headers.get(SWR_REVALIDATE_HEADER),
      });
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    try {
      const app = new Hono<{ Bindings: AppBindings }>();
      app.get("/api/v1/tokens", async (c) => {
        await revalidateInBackground(c);
        return c.json({ ok: true });
      });

      await app.request("/api/v1/tokens?sort=trending", {}, makeEnv());
      expect(captured).toHaveLength(1);
      expect(captured[0].marker).toBe("1");
      expect(captured[0].url).toContain("sort=trending");
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it("aborts the refresh-fetch when it exceeds the timeout", async () => {
    // `revalidateInBackground` must arm an `AbortController` — an
    // unbounded refresh would eat worker subrequest time across the
    // invocation. We simulate a hanging upstream by returning a
    // Promise that only resolves when the controller's signal aborts.
    const originalFetch = globalThis.fetch;
    let observedAbort: Event | undefined;
    let observedSignal: AbortSignal | undefined;
    (globalThis as { fetch: typeof fetch }).fetch = (async (
      input: RequestInfo | URL,
    ) => {
      const req = input instanceof Request ? input : new Request(String(input));
      observedSignal = req.signal;
      return new Promise<Response>((_, reject) => {
        req.signal.addEventListener("abort", (event) => {
          observedAbort = event;
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }) as typeof fetch;

    vi.useFakeTimers();
    try {
      const app = new Hono<{ Bindings: AppBindings }>();
      app.get("/api/v1/tokens", async (c) => {
        const refresh = revalidateInBackground(c);
        // Advance past the timeout so the controller fires before we
        // await — verifies the abort path is reached and absorbed.
        await vi.advanceTimersByTimeAsync(10_000);
        await refresh;
        return c.json({ ok: true });
      });

      const res = await app.request("/api/v1/tokens", {}, makeEnv());
      expect(res.status).toBe(200);
      expect(observedSignal).toBeDefined();
      expect(observedAbort).toBeDefined();
    } finally {
      vi.useRealTimers();
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it("absorbs refresh-fetch failures rather than throwing", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = (async () => {
      throw new Error("simulated outage");
    }) as typeof fetch;

    try {
      const app = new Hono<{ Bindings: AppBindings }>();
      app.get("/api/v1/tokens", async (c) => {
        await revalidateInBackground(c);
        return c.json({ ok: true });
      });

      const res = await app.request("/api/v1/tokens", {}, makeEnv());
      expect(res.status).toBe(200);
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it("runs one refresh per URL at a time", async () => {
    // Every stale serve schedules its own refresh, so a burst at one TTL
    // boundary would otherwise fan out into N cold paths for the same URL.
    _resetRevalidationTracking();
    const originalFetch = globalThis.fetch;
    let inFlight = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    (globalThis as { fetch: typeof fetch }).fetch = (async () => {
      inFlight += 1;
      await gate;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    try {
      const app = new Hono<{ Bindings: AppBindings }>();
      app.get("/api/v1/tokens", async (c) => {
        await revalidateInBackground(c);
        return c.json({ ok: true });
      });

      const burst = Promise.all([
        app.request("/api/v1/tokens?sort=trending", {}, makeEnv()),
        app.request("/api/v1/tokens?sort=trending", {}, makeEnv()),
        app.request("/api/v1/tokens?sort=trending", {}, makeEnv()),
      ]);
      release!();
      await burst;

      expect(inFlight).toBe(1);
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
      _resetRevalidationTracking();
    }
  });

  it("refreshes a different URL independently", async () => {
    _resetRevalidationTracking();
    const originalFetch = globalThis.fetch;
    const seen: string[] = [];
    (globalThis as { fetch: typeof fetch }).fetch = (async (
      input: RequestInfo | URL,
    ) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push(req.url);
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    try {
      const app = new Hono<{ Bindings: AppBindings }>();
      app.get("/api/v1/tokens", async (c) => {
        await revalidateInBackground(c);
        return c.json({ ok: true });
      });

      await app.request("/api/v1/tokens?sort=trending", {}, makeEnv());
      await app.request("/api/v1/tokens?sort=new", {}, makeEnv());

      expect(seen).toHaveLength(2);
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
      _resetRevalidationTracking();
    }
  });
});

describe("reserved stale-marker parameter", () => {
  it("does not let a caller-supplied marker read the stale sibling as fresh", async () => {
    // `?__swr_stale=1` is the internal key for the deliberately-stretched
    // fallback copy. A request carrying it must not key onto that entry
    // and be served a three-second-old body with no revalidation.
    const cache = makeFakeCache();
    const primary = new Request("http://localhost/api/v1/tokens?sort=trending");
    await putWithSwr(cache, primary, makeJsonResponse({ page: 1 }));

    const spoofed = new Request(
      "http://localhost/api/v1/tokens?sort=trending&__swr_stale=1",
    );
    const result = await matchSwr(cache, spoofed);

    expect(result.kind).toBe("fresh");
    if (result.kind !== "miss") {
      expect(result.response.headers.get("Cache-Control")).toBe(
        edgeCacheableJsonHeader(5),
      );
    }
  });

  it("single-flights refreshes that differ only by the marker", async () => {
    // The cache canonicalises the marker away, so these all refresh one
    // shared entry — the single-flight key has to canonicalise too, or
    // varying the marker walks straight past the guard.
    _resetRevalidationTracking();
    const originalFetch = globalThis.fetch;
    const seen: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    (globalThis as { fetch: typeof fetch }).fetch = (async (
      input: RequestInfo | URL,
    ) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push(req.url);
      await gate;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    try {
      const app = new Hono<{ Bindings: AppBindings }>();
      app.get("/api/v1/tokens", async (c) => {
        await revalidateInBackground(c);
        return c.json({ ok: true });
      });

      const burst = Promise.all([
        app.request("/api/v1/tokens?sort=trending", {}, makeEnv()),
        app.request("/api/v1/tokens?sort=trending&__swr_stale=1", {}, makeEnv()),
        app.request("/api/v1/tokens?sort=trending&__swr_stale=2", {}, makeEnv()),
      ]);
      release!();
      await burst;

      expect(seen).toHaveLength(1);
      expect(seen[0]).not.toContain("__swr_stale");
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
      _resetRevalidationTracking();
    }
  });

  it("folds a caller-supplied marker away on write", async () => {
    const cache = makeFakeCache();
    const spoofed = new Request(
      "http://localhost/api/v1/tokens?sort=trending&__swr_stale=1",
    );
    await putWithSwr(cache, spoofed, makeJsonResponse({ page: 1 }));

    // The canonical body lands under the marker-free URL, so a normal
    // request still finds it and the fallback is not clobbered.
    const normal = new Request("http://localhost/api/v1/tokens?sort=trending");
    const result = await matchSwr(cache, normal);
    expect(result.kind).toBe("fresh");
  });
});
