import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

import { adminAuth } from "../middleware/admin-auth.js";
import ltDirectoryPoller from "../routes/admin/lt-directory-poller.js";
import type { AppBindings } from "../lib/types.js";

const SAMPLE_HEARTBEAT = {
  lastTickAt: 1_778_900_000_000,
  lastSuccessAt: null,
  lastError: null,
  tickCount: 0,
  successCount: 0,
  lastDirectorySize: 0,
  lastPollSequence: 0,
  alarmScheduledFor: 1_778_900_030_000,
};

function makeNamespace(stubFetch: ReturnType<typeof vi.fn>) {
  const ns = {
    idFromName: vi.fn(() => "deterministic-do-id"),
    get: vi.fn(() => ({ fetch: stubFetch })),
  } as unknown as DurableObjectNamespace;
  return ns;
}

function makeEnv(ns: DurableObjectNamespace, adminKey = "test-admin-key"): AppBindings {
  return {
    ADMIN_API_KEY: adminKey,
    HYPERDRIVE: { connectionString: "postgres://hyperdrive-test" } as unknown as Hyperdrive,
    DATABASE_URL: "",
    BOUNCETECH_DATABASE_URL: "",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: ns,
  };
}

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.use("*", adminAuth);
  app.route("/admin/lt-directory-poller", ltDirectoryPoller);
  return app;
}

describe("GET /admin/lt-directory-poller", () => {
  it("returns 401 when X-Admin-Key header is missing", async () => {
    const ns = makeNamespace(vi.fn());
    const res = await createApp().request(
      "/admin/lt-directory-poller",
      {},
      makeEnv(ns),
    );
    expect(res.status).toBe(401);
    expect(ns.idFromName).not.toHaveBeenCalled();
  });

  it("proxies the DO /ensure heartbeat through formatSuccess on the happy path", async () => {
    const stubFetch = vi.fn(
      async () =>
        new Response(JSON.stringify(SAMPLE_HEARTBEAT), { status: 200 }),
    );
    const ns = makeNamespace(stubFetch);

    const res = await createApp().request(
      "/admin/lt-directory-poller",
      { headers: { "X-Admin-Key": "test-admin-key" } },
      makeEnv(ns),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: typeof SAMPLE_HEARTBEAT;
    };
    expect(body.status).toBe("success");
    expect(body.data).toEqual(SAMPLE_HEARTBEAT);
    // Pin the post-#966 singleton key: reverting to "lt-directory-poller"
    // would silently re-bind the route to the orphaned stuck instance.
    expect(ns.idFromName).toHaveBeenCalledWith("lt-directory-poller-v2");
    expect(stubFetch).toHaveBeenCalledWith("https://internal/ensure");
  });

  it("returns 503 when the DO /ensure resolves non-2xx (no formatSuccess wrap)", async () => {
    const stubFetch = vi.fn(
      async () => new Response("upstream blew up", { status: 500 }),
    );
    const ns = makeNamespace(stubFetch);

    const res = await createApp().request(
      "/admin/lt-directory-poller",
      { headers: { "X-Admin-Key": "test-admin-key" } },
      makeEnv(ns),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe("error");
    expect(body.error).toContain("LtDirectoryPoller /ensure returned HTTP 500");
  });

  it("returns 503 with a formatError envelope when the DO stub throws", async () => {
    const stubFetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const ns = makeNamespace(stubFetch);

    const res = await createApp().request(
      "/admin/lt-directory-poller",
      { headers: { "X-Admin-Key": "test-admin-key" } },
      makeEnv(ns),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe("error");
    expect(body.error).toContain("LtDirectoryPoller unreachable");
    expect(body.error).toContain("network down");
  });
});
