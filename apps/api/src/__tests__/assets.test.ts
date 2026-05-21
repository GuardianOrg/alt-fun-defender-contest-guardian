import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";
import type { LiveLeveragedToken } from "@launchpad/shared";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const HYPE_2L = "0xa000000000000000000000000000000000000001";
const HYPE_5L = "0xa000000000000000000000000000000000000002";
const DOGE_3L = "0xa000000000000000000000000000000000000003";
const CBRS_2L = "0xa000000000000000000000000000000000000004";

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
  {
    address: CBRS_2L,
    symbol: "CBRS2L",
    name: "CBRS 2x Long",
    targetAsset: "xyz:CBRS",
    targetLeverage: 2,
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

function installRouter() {
  mockFetch.mockImplementation(
    async (input: string | Request, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const url = typeof input === "string" ? input : input.url;

      if (
        url.startsWith("https://api.hyperliquid.xyz/info") &&
        method === "POST"
      ) {
        const body = init?.body
          ? (JSON.parse(String(init.body)) as { dex?: string })
          : {};
        if (body.dex === "xyz") {
          return jsonResponse({ "xyz:CBRS": "9.87" });
        }
        return jsonResponse({ HYPE: "12.34", DOGE: "0.42" });
      }
      throw new Error(`Unhandled fetch in test: ${method} ${url}`);
    },
  );
}

const mockReadSupportedLtDirectory =
  vi.fn<(databaseUrl: string) => Promise<LiveLeveragedToken[] | null>>();
vi.mock("../lib/lt-directory-reads.js", () => ({
  readLtDirectory: vi.fn(),
  readSupportedLtDirectory: mockReadSupportedLtDirectory,
  readLiveLtRates: vi.fn(),
  readLtByAddress: vi.fn(),
  readDirectoryLastUpdatedAt: vi.fn(),
}));

const { default: assetsRoute, _resetAssetsRouteCache } =
  await import("../routes/assets.js");

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
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

describe("GET /assets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetAssetsRouteCache();
    installRouter();
    mockReadSupportedLtDirectory.mockResolvedValue(DIRECTORY);
  });

  it("returns every LT from the supported directory reader", async () => {
    const app = createApp();
    const res = await app.request("/assets", {}, makeEnv());
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: {
        underlying: { symbol: string; price: string | null }[];
        leveragedTokens: { address: string; symbol: string }[];
      };
    };

    expect(body.data.leveragedTokens.map((lt) => lt.symbol)).toEqual([
      "HYPE2L",
      "HYPE5L",
      "DOGE3L",
      "CBRS2L",
    ]);
  });

  it("publishes only detected supported underlyings with Hyperliquid mids", async () => {
    const app = createApp();
    const res = await app.request("/assets", {}, makeEnv());

    const body = (await res.json()) as {
      data: { underlying: { symbol: string; price: string | null }[] };
    };

    const hype = body.data.underlying.find((u) => u.symbol === "HYPE");
    const doge = body.data.underlying.find((u) => u.symbol === "DOGE");
    const cbrs = body.data.underlying.find((u) => u.symbol === "xyz:CBRS");
    expect(hype?.price).toBe("12.34");
    expect(doge?.price).toBe("0.42");
    expect(cbrs?.price).toBe("9.87");
    expect(body.data.underlying.some((u) => u.symbol === "BTC")).toBe(false);
  });

  it("serves the detected asset set from the local route cache", async () => {
    const app = createApp();
    await app.request("/assets", {}, makeEnv());
    await app.request("/assets", {}, makeEnv());

    expect(mockReadSupportedLtDirectory).toHaveBeenCalledTimes(1);
  });

  it("returns empty asset lists when the LT directory mirror is degraded", async () => {
    mockReadSupportedLtDirectory.mockReset();
    mockReadSupportedLtDirectory.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request("/assets", {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        underlying: { symbol: string }[];
        leveragedTokens: unknown[];
      };
    };
    expect(body.data.underlying).toEqual([]);
    expect(body.data.leveragedTokens).toEqual([]);
  });
});
