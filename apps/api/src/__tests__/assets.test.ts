import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";
import type { LiveLeveragedToken } from "@launchpad/shared";

// ────────────────────────────────────────────────────────────────────
// The /assets route fans out to three places:
//   - Hyperliquid `allMids` (POST) — mocked via the global `fetch`.
//   - The `lt_directory` Postgres mirror — mocked via the
//     `lt-directory-reads` module so we don't stand up a Drizzle chain.
//   - The BounceTech UI logo CDN (HEAD), via the `lt-availability` lib —
//     mocked via the same global `fetch`. The `lt-availability`
//     directory source is the DB mirror, NOT the BounceTech HTTP API.
// We tag each fetch by URL/method so the test can assert the per-LT
// filtering without juggling call order.
// ────────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Live LTs (HEAD returns 200), drives the per-test filter set.
let liveSymbols = new Set<string>();

const HYPE_2L = "0xa000000000000000000000000000000000000001";
const HYPE_5L = "0xa000000000000000000000000000000000000002";
const DOGE_3L = "0xa000000000000000000000000000000000000003";

const DIRECTORY: LiveLeveragedToken[] = [
  {
    address: HYPE_2L,
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
  },
  {
    address: HYPE_5L,
    symbol: "HYPE5L",
    name: "HYPE 5x Long",
    targetAsset: "HYPE",
    targetLeverage: 5,
    isLong: true,
    decimals: 18,
    mintPaused: false,
    exchangeRate: "1000000000000000000",
    totalSupply: "0",
    totalAssets: "0",
    baseAssetBalance: "0",
  },
  {
    address: DOGE_3L,
    symbol: "DOGE3L",
    name: "DOGE 3x Long",
    targetAsset: "DOGE",
    targetLeverage: 3,
    isLong: true,
    decimals: 18,
    mintPaused: false,
    exchangeRate: "1000000000000000000",
    totalSupply: "0",
    totalAssets: "0",
    baseAssetBalance: "0",
  },
];

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function headOk(): Response {
  return { ok: true, status: 200 } as unknown as Response;
}

function head404(): Response {
  return { ok: false, status: 404 } as unknown as Response;
}

function installRouter() {
  mockFetch.mockImplementation(async (input: string | Request, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url = typeof input === "string" ? input : input.url;

    if (url.startsWith("https://api.hyperliquid.xyz/info") && method === "POST") {
      return jsonResponse({ HYPE: "12.34", DOGE: "0.42" });
    }
    const headMatch = url.match(/^https:\/\/bounce\.tech\/leveraged-tokens\/(.+)\.png$/);
    if (headMatch && method === "HEAD") {
      return liveSymbols.has(headMatch[1]) ? headOk() : head404();
    }
    throw new Error(`Unhandled fetch in test: ${method} ${url}`);
  });
}

// Mock the LT directory reader directly — the route + the
// `lt-availability` lib are the only paths that touch the DB on this
// surface, so stubbing the reads gives us precise control over
// "directory has rows" vs "DB read failed" without standing up a fake
// Drizzle chain.
const mockReadSupportedLtDirectory = vi.fn<
  (databaseUrl: string) => Promise<LiveLeveragedToken[] | null>
>();
vi.mock("../lib/lt-directory-reads.js", () => ({
  readLtDirectory: vi.fn(),
  readSupportedLtDirectory: mockReadSupportedLtDirectory,
  readLiveLtRates: vi.fn(),
  readLtByAddress: vi.fn(),
  readDirectoryLastUpdatedAt: vi.fn(),
}));

const { _resetLtAvailabilityCache } = await import("../lib/lt-availability.js");
const { default: assetsRoute, _resetAssetsRouteCache } = await import(
  "../routes/assets.js"
);

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/assets", assetsRoute);
  return app;
}

function makeEnv(): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "postgres://bouncetech",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "http://localhost:42069",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

describe("GET /assets — filtering by BounceTech UI live status (issue #621)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLtAvailabilityCache();
    // The route caches Hyperliquid mids per isolate for 10s. Reset so
    // each test starts from a clean slate and consumes its own mocked
    // `fetch` response queue.
    _resetAssetsRouteCache();
    liveSymbols = new Set<string>();
    installRouter();
    // Default: the `lt_directory` mirror has every supported LT.
    // Per-test overrides via `mockResolvedValueOnce` cover the degraded
    // / empty-mirror branches.
    mockReadSupportedLtDirectory.mockResolvedValue(DIRECTORY);
  });

  it("only includes underlying assets that have at least one live LT", async () => {
    liveSymbols = new Set(["HYPE2L", "HYPE5L"]);

    const app = createApp();
    const res = await app.request("/assets", {}, makeEnv());
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: {
        underlying: { symbol: string; price: string | null }[];
        leveragedTokens: { address: string; symbol: string }[];
        liveUnderlyings: string[];
      };
    };

    const underlyingSymbols = body.data.underlying.map((u) => u.symbol);
    expect(underlyingSymbols).toContain("HYPE");
    expect(underlyingSymbols).not.toContain("DOGE");
    expect(body.data.liveUnderlyings).toContain("HYPE");
    expect(body.data.liveUnderlyings).not.toContain("DOGE");
  });

  it("filters leveragedTokens to only those BounceTech has published", async () => {
    liveSymbols = new Set(["HYPE5L"]); // only one of HYPE2L/HYPE5L/DOGE3L

    const app = createApp();
    const res = await app.request("/assets", {}, makeEnv());

    const body = (await res.json()) as {
      data: {
        leveragedTokens: { address: string; symbol: string }[];
      };
    };

    const symbols = body.data.leveragedTokens.map((lt) => lt.symbol);
    expect(symbols).toEqual(["HYPE5L"]);
  });

  it("treats no-image (404) LTs as hidden and excludes them from the response", async () => {
    liveSymbols = new Set(["HYPE2L"]); // HYPE5L + DOGE3L 404 on HEAD

    const app = createApp();
    const res = await app.request("/assets", {}, makeEnv());

    const body = (await res.json()) as {
      data: {
        leveragedTokens: { symbol: string }[];
        liveUnderlyings: string[];
      };
    };

    expect(body.data.leveragedTokens.map((lt) => lt.symbol)).toEqual(["HYPE2L"]);
    expect(body.data.liveUnderlyings).toEqual(["HYPE"]);
  });

  it("falls back to the full supported list when the LT directory mirror is degraded", async () => {
    // `null` from the mirror reader means the DB read failed (the helper
    // already swallowed the exception). The HEAD checks never get a
    // chance to run because `performRefresh` short-circuits on an empty
    // directory.
    mockReadSupportedLtDirectory.mockReset();
    mockReadSupportedLtDirectory.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request("/assets", {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        underlying: { symbol: string }[];
        leveragedTokens: unknown[];
        liveUnderlyings: string[];
      };
    };
    // Degraded mode — no live-LT signal, no per-LT directory either, but
    // the underlying-asset list and `liveUnderlyings` fall back to the
    // full supported set so the UI doesn't blank out.
    expect(body.data.underlying.length).toBeGreaterThan(0);
    expect(body.data.liveUnderlyings.length).toBeGreaterThan(0);
    expect(body.data.leveragedTokens).toEqual([]);
  });
});
