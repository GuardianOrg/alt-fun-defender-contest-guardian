import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { defaultNoStore } from "../middleware/default-no-store.js";
import { setEdgeCacheHeaders } from "../utils/cache-control.js";

import type { AppBindings } from "../lib/types.js";

/**
 * `cache.enabled` in `wrangler.json` is Worker-wide and can't be scoped
 * to the routes that opted in. A response carrying no cache directive is
 * therefore at the mercy of whatever default the platform applies — and
 * for an authenticated admin endpoint that would be a disclosure bug,
 * since a zone entry keyed on the URL could be re-served to a caller who
 * never presented the admin key.
 *
 * So the rule is default-deny: opt in through `utils/cache-control.ts`,
 * or be `no-store`.
 */

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

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.use("*", defaultNoStore);
  // Stands in for an authenticated admin handler: sets no cache headers.
  app.get("/admin/api-keys", (c) => c.json({ keys: ["secret-prefix"] }));
  // Stands in for a route that deliberately opted in.
  app.get("/cacheable", (c) => {
    setEdgeCacheHeaders(c, 30);
    return c.json({ ok: true });
  });
  // Stands in for the wallet-aware token-detail branch.
  app.get("/private", (c) => {
    c.header("Cache-Control", "private, no-store, max-age=0, s-maxage=0");
    return c.json({ ok: true });
  });
  app.get("/boom", () => {
    throw new Error("kaboom");
  });
  // Stands in for the `/ws` upgrade, which returns the Durable Object's
  // response verbatim. A real 101 can't be constructed outside workerd
  // (the Response constructor rejects statuses below 200), so this fakes
  // the property the middleware actually keys on.
  app.get("/ws", () => {
    const res = new Response(null, { status: 200 });
    Object.defineProperty(res, "webSocket", { value: {}, configurable: true });
    return res;
  });
  // Stands in for a Durable Object error passed through verbatim: a
  // response off `fetch()` has immutable headers, so `set` throws.
  app.get("/passthrough", () => {
    const res = new Response("upstream refused", { status: 429 });
    Object.defineProperty(res, "headers", {
      value: new Proxy(res.headers, {
        get(target, prop, receiver) {
          if (prop === "set") {
            return () => {
              throw new TypeError("immutable headers");
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
      configurable: true,
    });
    return res;
  });
  // Stands in for a zone-only policy: no `Cache-Control`, but a
  // deliberate Cloudflare directive that must not be overwritten.
  app.get("/zone-only", (c) => {
    c.header("Cloudflare-CDN-Cache-Control", "public, max-age=60");
    return c.json({ ok: true });
  });
  return app;
}

describe("defaultNoStore", () => {
  it("stamps no-store on a handler that declared no policy", async () => {
    const res = await createApp().request("/admin/api-keys", {}, makeEnv());

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // The zone reads this one in preference, so it has to say no-store too.
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store");
  });

  it("leaves an opted-in response exactly as the route set it", async () => {
    const res = await createApp().request("/cacheable", {}, makeEnv());

    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
    );
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "public, max-age=30, stale-while-revalidate=60",
    );
  });

  it("does not overwrite an explicit private no-store directive", async () => {
    const res = await createApp().request("/private", {}, makeEnv());

    expect(res.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0, s-maxage=0",
    );
  });

  it("leaves a WebSocket upgrade alone", async () => {
    // An upgrade response has immutable headers — writing to them throws
    // and would break every `/ws` connection.
    const res = await createApp().request("/ws", {}, makeEnv());

    expect(res.headers.get("Cache-Control")).toBeNull();
  });

  it("does not mask a passthrough response with immutable headers", async () => {
    // Writing to a fetched response's headers throws. Before the rewrap
    // fallback this turned a Durable Object 429 into a 500.
    const res = await createApp().request("/passthrough", {}, makeEnv());

    expect(res.status).toBe(429);
    expect(await res.text()).toBe("upstream refused");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("leaves an existing zone-only policy in place", async () => {
    const res = await createApp().request("/zone-only", {}, makeEnv());

    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "public, max-age=60",
    );
    expect(res.headers.get("Cache-Control")).toBeNull();
  });

  it("covers an unhandled error response too", async () => {
    // A 500 with no directive is exactly the shape a platform default
    // would happily store.
    const res = await createApp().request("/boom", {}, makeEnv());

    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
