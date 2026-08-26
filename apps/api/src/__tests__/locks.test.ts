import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockFetchActiveTokenLocks = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchActiveTokenLocks: (...args: unknown[]) =>
    mockFetchActiveTokenLocks(...args),
}));

vi.mock("../db/client.js", () => ({
  createDb: () => ({}),
}));

const { default: locksRoute } = await import("../routes/locks.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/locks", locksRoute);
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

const ONE = 10n ** 18n;
const TOKEN = "0x7f7430a1ad9a9b0e86849c332bf27facfd700000";
const FAR_FUTURE = Math.floor(Date.now() / 1000) + 7_952_400;

interface LocksBody {
  status: string;
  data: {
    locks: {
      tokenAddress: string;
      lockedAmount: string;
      lockedPercent: number;
      unlocksAt: string;
    }[];
  } | null;
  error: string | null;
}

describe("GET /locks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchActiveTokenLocks.mockResolvedValue([]);
  });

  it("returns an empty list when nothing is locked", async () => {
    const res = await createApp().request("/locks", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as LocksBody;
    expect(body.status).toBe("success");
    expect(body.data!.locks).toEqual([]);
  });

  it("summarises the locks the indexer returns", async () => {
    mockFetchActiveTokenLocks.mockResolvedValue([
      {
        tokenAddress: TOKEN,
        depositAmount: (750_000_000n * ONE).toString(),
        cliffTime: String(FAR_FUTURE),
      },
    ]);

    const res = await createApp().request("/locks", {}, makeEnv());
    const body = (await res.json()) as LocksBody;

    expect(body.data!.locks).toHaveLength(1);
    expect(body.data!.locks[0]).toMatchObject({
      tokenAddress: TOKEN,
      lockedAmount: (750_000_000n * ONE).toString(),
      lockedPercent: 75,
    });
  });

  it("returns 503 when the indexer read fails", async () => {
    // Not an empty list: "we couldn't check" must not render as "nothing is
    // locked", and a 503 also keeps the outage out of the edge cache.
    mockFetchActiveTokenLocks.mockResolvedValue(null);
    const res = await createApp().request("/locks", {}, makeEnv());
    expect(res.status).toBe(503);
    const body = (await res.json()) as LocksBody;
    expect(body.error).toContain("Indexer unavailable");
  });

  it("bounds the rows it pulls per request", async () => {
    await createApp().request("/locks", {}, makeEnv());
    const [, nowSec, limit] = mockFetchActiveTokenLocks.mock.calls[0] as [
      unknown,
      number,
      number,
    ];
    expect(limit).toBe(2_000);
    expect(nowSec).toBeGreaterThan(1_700_000_000);
  });

  it("declares an edge-cache window on the success path", async () => {
    const res = await createApp().request("/locks", {}, makeEnv());
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toContain(
      "max-age=60",
    );
  });

  it("declares no cache policy on the outage response", async () => {
    // The 503 must not inherit the success path's window. Declaring nothing
    // is what hands the response to `defaultNoStore` in the real app.
    mockFetchActiveTokenLocks.mockResolvedValue(null);
    const res = await createApp().request("/locks", {}, makeEnv());
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBeNull();
  });
});
