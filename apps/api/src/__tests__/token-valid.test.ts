import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppBindings } from "../lib/types.js";

/**
 * `GET /api/v1/tokens/:address/valid` backs the home-page recent-trades
 * WebSocket filter. The web caches a definitive `false` for the whole
 * page lifetime (`apps/web/src/services/tokenValidity.ts`), so how long
 * the edge is allowed to hold a negative directly bounds how long a
 * freshly-launched token's trades stay missing from the live feed.
 */

// Drizzle chain mock — the route calls `.select().from().where().limit()`.
// `fail` makes the terminal await reject, which is how `tryApiDbRead`
// sees a Neon outage.
const dbState: { rows: unknown[]; fail: boolean } = { rows: [], fail: false };

function makeThenable() {
  const self = {
    then: (
      resolve: (rows: unknown[]) => unknown,
      reject?: (error: unknown) => unknown,
    ) =>
      dbState.fail
        ? reject?.(new Error("Failed query: connection terminated (1006)"))
        : resolve(dbState.rows),
    where: vi.fn(),
    limit: vi.fn(),
  };
  self.where.mockReturnValue(self);
  self.limit.mockReturnValue(self);
  return self;
}

vi.mock("../db/client.js", () => ({
  createDb: () => ({
    select: vi.fn(() => ({ from: vi.fn(() => makeThenable()) })),
  }),
}));

const { default: tokenValidRoute } = await import("../routes/tokens/valid.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/tokens", tokenValidRoute);
  return app;
}

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

const TOKEN = "0x4DFB6bebbdF9d5ea76123729E0b3a823f9c3ecC0";

async function request() {
  return createApp().request(`/tokens/${TOKEN}/valid`, {}, makeEnv());
}

describe("GET /tokens/:address/valid — edge cache windows", () => {
  beforeEach(() => {
    dbState.rows = [];
    dbState.fail = false;
    vi.clearAllMocks();
  });

  it("400 for an invalid address", async () => {
    const res = await createApp().request("/tokens/nope/valid", {}, makeEnv());
    expect(res.status).toBe(400);
  });

  it("caches a registered, unhidden token for the full window", async () => {
    dbState.rows = [{ isHidden: false }];

    const res = await request();
    const body = (await res.json()) as { data: { valid: boolean } };

    expect(body.data.valid).toBe(true);
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "public, max-age=30, stale-while-revalidate=60",
    );
  });

  it("caches an unregistered token only briefly", async () => {
    // No row yet: the registration backfill lands ~60s after launch, so
    // this `false` is a "not yet" and must expire fast — the web pins a
    // definitive false for the rest of the page session.
    dbState.rows = [];

    const res = await request();
    const body = (await res.json()) as { data: { valid: boolean } };

    expect(body.data.valid).toBe(false);
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "public, max-age=5, stale-while-revalidate=10",
    );
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=5");
  });

  it("stores nothing when the API DB read fails", async () => {
    // A 503 must never be admitted to any cache — pinning a transient
    // outage for the TTL window is the failure mode `lib/api-db-reads.ts`
    // warns about, and it would read as "this token doesn't exist" to the
    // trade feed. CodeRabbit review on this PR.
    dbState.fail = true;
    // `tryApiDbRead` logs the failure by design; keep it out of the run.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const res = await request();
      const body = (await res.json()) as { status: string; data: unknown };

      expect(res.status).toBe(503);
      expect(body.status).toBe("error");
      expect(res.headers.get("Cache-Control")).toBeNull();
      expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBeNull();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("caches a moderation-hidden token on the same short window", async () => {
    // Hidden is a durable state, but it shares the negative answer, and
    // an unhide should surface quickly too.
    dbState.rows = [{ isHidden: true }];

    const res = await request();
    const body = (await res.json()) as { data: { valid: boolean } };

    expect(body.data.valid).toBe(false);
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "public, max-age=5, stale-while-revalidate=10",
    );
  });
});
