import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import { adminAuth } from "../middleware/admin-auth.js";
import type { AppBindings } from "../lib/types.js";

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.use("*", adminAuth);
  app.get("/admin/test", (c) => c.json({ ok: true }));
  return app;
}

function makeEnv(adminKey = "test-admin-key"): AppBindings {
  return {
    ADMIN_API_KEY: adminKey,
    HYPERDRIVE: { connectionString: "postgres://hyperdrive-test" } as unknown as Hyperdrive,
    DATABASE_URL: "",
    BOUNCETECH_DATABASE_URL: "",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

describe("adminAuth middleware", () => {
  it("returns 401 when X-Admin-Key header is missing", async () => {
    const app = createApp();
    const res = await app.request("/admin/test", {}, makeEnv());

    expect(res.status).toBe(401);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.status).toBe("error");
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when X-Admin-Key header is incorrect", async () => {
    const app = createApp();
    const res = await app.request(
      "/admin/test",
      { headers: { "X-Admin-Key": "wrong-key" } },
      makeEnv(),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Unauthorized");
  });

  it("passes through when X-Admin-Key header matches", async () => {
    const app = createApp();
    const res = await app.request(
      "/admin/test",
      { headers: { "X-Admin-Key": "test-admin-key" } },
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 401 when X-Admin-Key header is empty string", async () => {
    const app = createApp();
    const res = await app.request(
      "/admin/test",
      { headers: { "X-Admin-Key": "" } },
      makeEnv(),
    );

    expect(res.status).toBe(401);
  });
});
