import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import { defaultNoStore } from "../middleware/default-no-store.js";
import {
  ZONE_CACHE_DISABLED_ROUTES,
  isZoneCacheDisabled,
  zoneCacheKillswitch,
} from "../middleware/zone-cache-killswitch.js";
import {
  CDN_CACHE_CONTROL_HEADER,
  setEdgeCacheHeaders,
} from "../utils/cache-control.js";

import type { AppBindings } from "../lib/types.js";

function makeEnv(): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

/**
 * Make a response's headers immutable, the way the runtime does for
 * anything that came off `fetch()`. Mirrors the helper in
 * `default-no-store.test.ts`; the rewrap fallback exists for this case.
 */
function immutable(res: Response): Response {
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
}

/** Production mount order: `defaultNoStore` outermost, killswitch inside. */
function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.use("*", defaultNoStore);
  app.use("*", zoneCacheKillswitch);
  // Every handler below opts in to caching, so any `no-store` in the
  // assertions can only have come from the killswitch.
  const cacheable = (c: Parameters<typeof setEdgeCacheHeaders>[0]) => {
    setEdgeCacheHeaders(c, 30);
  };
  app.get("/api/v1/stats", (c) => (cacheable(c), c.json({ ok: true })));
  app.get("/api/v1/analytics/overview", (c) => (cacheable(c), c.json({})));
  app.get("/api/v1/holders/:address", (c) => (cacheable(c), c.json({})));
  app.get(
    "/api/v1/creators/:address/earnings",
    (c) => (cacheable(c), c.json({})),
  );
  app.get("/api/v1/security/:address", (c) => (cacheable(c), c.json({})));
  app.get("/api/v1/portfolio/:wallet", (c) => (cacheable(c), c.json({})));
  app.get("/api/v1/tokens/:address/valid", (c) => (cacheable(c), c.json({})));
  app.get("/api/v1/tokens/:address/meta", (c) => (cacheable(c), c.json({})));
  app.get("/images/:prefix/:key", (c) => (cacheable(c), c.body("blob")));
  // Deliberately still cached — the load-bearing routes.
  app.get("/api/v1/tokens", (c) => (cacheable(c), c.json({})));
  app.get("/api/v1/trades", (c) => (cacheable(c), c.json({})));
  // Prefix look-alike: must not be swept up by the `/api/v1/stats` entry.
  app.get("/api/v1/statsomething", (c) => (cacheable(c), c.json({})));
  app.get("/ws", () => {
    const res = new Response(null, { status: 200 });
    Object.defineProperty(res, "webSocket", { value: {}, configurable: true });
    return res;
  });
  // Under a suspended prefix, but not shadowed by any `:param` route
  // registered above — `/api/v1/analytics` only declares `/overview`.
  app.get("/api/v1/analytics/passthrough", () =>
    immutable(new Response("upstream refused", { status: 429 })),
  );
  return app;
}

async function get(path: string): Promise<Response> {
  return createApp().request(`http://api.test${path}`, {}, makeEnv());
}

describe("zoneCacheKillswitch", () => {
  const suspended = [
    "/api/v1/stats",
    "/api/v1/analytics/overview",
    "/api/v1/holders/So11111111111111111111111111111111111111112",
    "/api/v1/creators/So11111111111111111111111111111111111111112/earnings",
    "/api/v1/security/So11111111111111111111111111111111111111112",
    "/api/v1/portfolio/So11111111111111111111111111111111111111112",
    "/api/v1/tokens/So11111111111111111111111111111111111111112/valid",
    "/api/v1/tokens/So11111111111111111111111111111111111111112/meta",
    "/images/abc/def.png",
  ];

  it.each(suspended)("strips both cache directives on %s", async (path) => {
    const res = await get(path);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get(CDN_CACHE_CONTROL_HEADER)).toBe("no-store");
  });

  // The whole point of choosing this over `cache.enabled: false`: the
  // routes carrying the load keep their TTL. If this passes while the
  // block above also passes, the switch is genuinely per-endpoint.
  it.each(["/api/v1/tokens", "/api/v1/trades"])(
    "leaves %s cached",
    async (path) => {
      const res = await get(path);
      expect(res.headers.get("Cache-Control")).toContain("s-maxage=30");
      expect(res.headers.get(CDN_CACHE_CONTROL_HEADER)).toContain("max-age=30");
    },
  );

  it("matches on a path segment, not a bare string prefix", async () => {
    expect(isZoneCacheDisabled("/api/v1/statsomething")).toBe(false);
    const res = await get("/api/v1/statsomething");
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=30");
  });

  it("leaves a token-detail path alone — only /valid and /meta are listed", () => {
    expect(
      isZoneCacheDisabled(
        "/api/v1/tokens/So11111111111111111111111111111111111111112",
      ),
    ).toBe(false);
  });

  it("rewraps a response whose headers are immutable", async () => {
    const res = await get("/api/v1/analytics/passthrough");
    expect(res.status).toBe(429);
    expect(await res.text()).toBe("upstream refused");
    expect(res.headers.get(CDN_CACHE_CONTROL_HEADER)).toBe("no-store");
  });

  it("does not touch a WebSocket upgrade", async () => {
    const res = await get("/ws");
    expect(res.headers.get("Cache-Control")).toBeNull();
  });

  // Guards the revert path: when the list is emptied the module must be
  // inert rather than falling through to some default.
  it("only claims the endpoints it lists", () => {
    expect(ZONE_CACHE_DISABLED_ROUTES.length).toBeGreaterThan(0);
    expect(isZoneCacheDisabled("/api/v1/admin/api-keys")).toBe(false);
    expect(isZoneCacheDisabled("/health")).toBe(false);
  });
});
