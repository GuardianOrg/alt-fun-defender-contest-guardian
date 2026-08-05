import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

const mockFetchTokenMeta = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchTokenMeta: mockFetchTokenMeta,
}));

vi.mock("../db/client.js", () => ({
  createDb: () => ({}),
}));

const { default: tokenMetaRoute } = await import("../routes/tokens/meta.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/tokens", tokenMetaRoute);
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

describe("GET /tokens/:address/meta", () => {
  beforeEach(() => vi.clearAllMocks());

  it("400 for invalid address", async () => {
    const res = await createApp().request("/tokens/nope/meta", {}, makeEnv());
    expect(res.status).toBe(400);
  });

  it("503 when the helper returns 'unavailable'", async () => {
    mockFetchTokenMeta.mockResolvedValue("unavailable");
    const res = await createApp().request(`/tokens/${TOKEN}/meta`, {}, makeEnv());
    expect(res.status).toBe(503);
    // A cached 503 would pin a transient outage for the TTL window.
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBeNull();
  });

  it("returns 200 with data:null when the token row doesn't exist", async () => {
    mockFetchTokenMeta.mockResolvedValue(null);
    const res = await createApp().request(`/tokens/${TOKEN}/meta`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    expect(body.data).toBeNull();
  });

  it("caches a not-indexed-yet miss briefly, not for the label window", async () => {
    // A `null` is "not indexed yet". Inheriting the 5-minute label window
    // would leave a freshly-launched token unnamed in the UI long after
    // the indexer knew its name.
    mockFetchTokenMeta.mockResolvedValue(null);
    const res = await createApp().request(`/tokens/${TOKEN}/meta`, {}, makeEnv());

    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "public, max-age=10, stale-while-revalidate=20",
    );
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=10, stale-while-revalidate=20",
    );
  });

  it("caches a resolved label for the full window", async () => {
    mockFetchTokenMeta.mockResolvedValue({
      address: TOKEN.toLowerCase(),
      name: "PurrFi",
      symbol: "PURR",
    });
    const res = await createApp().request(`/tokens/${TOKEN}/meta`, {}, makeEnv());

    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "public, max-age=300, stale-while-revalidate=3600",
    );
  });

  it("returns the row when present", async () => {
    mockFetchTokenMeta.mockResolvedValue({
      address: TOKEN.toLowerCase(),
      name: "PurrFi",
      symbol: "PURR",
    });
    const res = await createApp().request(`/tokens/${TOKEN}/meta`, {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { address: string; name: string; symbol: string };
    };
    expect(body.data).toEqual({
      address: TOKEN.toLowerCase(),
      name: "PurrFi",
      symbol: "PURR",
    });
  });
});
