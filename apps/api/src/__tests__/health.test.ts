import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockCheckIndexerHealth = vi.fn();
// Tracker for the legacy GraphQL probe. Stubbed to a noop that records
// invocations so the regression-pin test below can assert the probe is
// never reached on the new code path. If a future refactor accidentally
// reintroduces the GraphQL hop into `/health`, this mock will record a
// call and the assertion will fail loudly instead of letting the
// regression slip through unnoticed.
const mockCheckPonderHealth = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  checkIndexerHealth: (...args: unknown[]) => mockCheckIndexerHealth(...args),
}));

vi.mock("../lib/ponder-client.js", () => ({
  checkPonderHealth: (...args: unknown[]) => mockCheckPonderHealth(...args),
}));

// Drizzle's `createDb` calls into the Neon HTTP driver synchronously — stub
// it so the route can construct a "Database" handle for the
// `checkIndexerHealth` mock without touching the network. Mirrors the
// pattern used in `stats.test.ts`.
vi.mock("../db/client.js", () => ({
  createDb: () => ({}),
}));

const { default: healthRoute } = await import("../routes/health.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/health", healthRoute);
  return app;
}

function makeEnv(): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "http://localhost:42069",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
  };
}

describe("GET /health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns healthy when the direct-Postgres indexer probe succeeds", async () => {
    mockCheckIndexerHealth.mockResolvedValue(true);

    const app = createApp();
    const res = await app.request("/health", {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: {
        status: string;
        services: { api: boolean; ponder: boolean };
      };
    };
    expect(body.status).toBe("success");
    expect(body.data).toEqual({
      status: "healthy",
      services: { api: true, ponder: true },
    });
  });

  it("returns degraded when the indexer probe reports failure", async () => {
    mockCheckIndexerHealth.mockResolvedValue(false);

    const app = createApp();
    const res = await app.request("/health", {}, makeEnv());

    // We deliberately respond 200 even when degraded so external monitors
    // get to inspect the structured body and decide for themselves whether
    // a slow indexer should page someone — `/health` itself must always
    // be reachable, which is the whole point of the upstream probe.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        status: string;
        services: { api: boolean; ponder: boolean };
      };
    };
    expect(body.data).toEqual({
      status: "degraded",
      services: { api: true, ponder: false },
    });
  });

  it("probes the direct-SQL read path, not the legacy Ponder GraphQL hop", async () => {
    // The whole point of issue #931 is that `/health` no longer touches
    // the Ponder GraphQL endpoint — it now reflects the read path the API
    // actually serves traffic from. Pin that contract in a regression test
    // so a future refactor can't silently bring the GraphQL probe back.
    // We assert both directions: the new probe ran exactly once *and* the
    // legacy probe was never touched. Asserting only the positive side
    // would still pass if both probes ran in parallel during a botched
    // migration.
    mockCheckIndexerHealth.mockResolvedValue(true);

    const app = createApp();
    await app.request("/health", {}, makeEnv());

    expect(mockCheckIndexerHealth).toHaveBeenCalledTimes(1);
    expect(mockCheckPonderHealth).not.toHaveBeenCalled();
  });
});
