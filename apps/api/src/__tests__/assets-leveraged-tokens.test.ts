import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

// Mock the directory reader directly — the route's only DB interaction
// is through `readLtDirectory`, so stubbing it gives us precise control
// over `null` (degraded) vs populated responses without standing up a
// fake Drizzle chain.
const mockReadLtDirectory = vi.fn();
vi.mock("../lib/lt-directory-reads.js", () => ({
  readLtDirectory: mockReadLtDirectory,
  readSupportedLtDirectory: vi.fn(),
  readLiveLtRates: vi.fn(),
  readLtByAddress: vi.fn(),
  readDirectoryLastUpdatedAt: vi.fn(),
}));

// The existing `GET /` route handler also fans out to the live-LT
// availability lib (which hits `fetch`); stub `fetch` so that path doesn't
// touch the network. The new endpoint doesn't fan out to anything beyond
// the DB read, but the import of `getLiveLtAvailability` is at module
// scope so we still mock it for cleanliness.
vi.stubGlobal(
  "fetch",
  vi.fn(async () => {
    throw new Error("Network fetch should not run for /leveraged-tokens");
  }),
);

const { default: assetsRoute } = await import("../routes/assets.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/assets", assetsRoute);
  return app;
}

function makeEnv(): AppBindings {
  return {
    HYPERDRIVE: { connectionString: "postgres://hyperdrive-test" } as unknown as Hyperdrive,
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "postgres://bouncetech",
    ADMIN_API_KEY: "admin-key",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

const HYPE_2L = "0xA000000000000000000000000000000000000001";
const DOGE_3L = "0xA000000000000000000000000000000000000003";

const baseLt = {
  symbol: "HYPE2L",
  name: "HYPE 2x Long",
  targetAsset: "HYPE",
  targetLeverage: 2,
  isLong: true,
  decimals: 18,
  mintPaused: false,
  exchangeRate: "1000000000000000000",
  totalSupply: "0",
  totalAssets: "0",
  baseAssetBalance: "0",
};

describe("GET /assets/leveraged-tokens — additive on-chain-mirror endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns every row in the mirror, no filterSupportedLTs applied", async () => {
    // Include one row whose `targetLeverage` would normally be filtered
    // out by `filterSupportedLTs` (7x) — the new endpoint must return it
    // anyway, so existing-holder surfaces can still resolve mint-pause
    // state for retired/unsupported LTs.
    mockReadLtDirectory.mockResolvedValue([
      { ...baseLt, address: HYPE_2L },
      { ...baseLt, address: DOGE_3L, targetLeverage: 7, targetAsset: "FOO" },
    ]);

    const res = await createApp().request(
      "/assets/leveraged-tokens",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      data: { data: Array<{ address: string; targetLeverage: number }> };
      dataSource?: string;
    };
    expect(body.status).toBe("success");
    expect(body.dataSource).toBeUndefined();
    expect(body.data.data).toHaveLength(2);
    expect(body.data.data.map((d) => d.address)).toEqual([HYPE_2L, DOGE_3L]);
  });

  it("marks dataSource degraded and returns an empty list when the DB read fails", async () => {
    mockReadLtDirectory.mockResolvedValue(null);

    const res = await createApp().request(
      "/assets/leveraged-tokens",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      dataSource?: string;
      data: { data: unknown[] };
    };
    expect(body.dataSource).toBe("degraded");
    expect(body.data.data).toEqual([]);
  });

  it("sets an edge-cache header on the success path", async () => {
    mockReadLtDirectory.mockResolvedValue([{ ...baseLt, address: HYPE_2L }]);

    const res = await createApp().request(
      "/assets/leveraged-tokens",
      {},
      makeEnv(),
    );
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=15, stale-while-revalidate=60",
    );
  });

  it("does not set an edge-cache header on the degraded path", async () => {
    mockReadLtDirectory.mockResolvedValue(null);

    const res = await createApp().request(
      "/assets/leveraged-tokens",
      {},
      makeEnv(),
    );
    // No `Cache-Control` set means the edge falls back to default
    // behaviour — we don't want to cache a degraded payload.
    expect(res.headers.get("Cache-Control")).toBeNull();
  });
});
