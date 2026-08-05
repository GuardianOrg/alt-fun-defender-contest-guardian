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

  it("covers an unhandled error response too", async () => {
    // A 500 with no directive is exactly the shape a platform default
    // would happily store.
    const res = await createApp().request("/boom", {}, makeEnv());

    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
