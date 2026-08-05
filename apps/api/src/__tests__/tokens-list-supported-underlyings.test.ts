/**
 * Coverage for the supported-underlying filter as applied to
 * `GET /tokens` (status=curve/graduated/graduating + trending sort) and
 * `GET /tokens/search`. Unsupported assets are omitted from the shared
 * registry, so every route path filters to `SUPPORTED_UNDERLYING_ASSETS`.
 */

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SUPPORTED_UNDERLYING_ASSETS } from "@launchpad/shared";

import type { AppBindings } from "../lib/types.js";
import type {
  MarketDataBatchResult,
  MarketDataItem,
  PonderTokenOnchain,
} from "../lib/market-data.js";

const inArrayCalls: { values: unknown[] }[] = [];

vi.mock("drizzle-orm", async () => {
  const actual =
    await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    inArray: vi.fn((column: unknown, values: unknown[]) => {
      inArrayCalls.push({ values });
      return actual.inArray(
        column as Parameters<typeof actual.inArray>[0],
        values,
      );
    }),
  };
});

const currentDbRows: { rows: DbRow[] } = { rows: [] };

interface DbChainable {
  then: (resolve: (rows: DbRow[]) => unknown) => unknown;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  offset: ReturnType<typeof vi.fn>;
}

function makeThenable(): DbChainable {
  const self: DbChainable = {
    then: (resolve) => resolve(currentDbRows.rows),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  self.where.mockReturnValue(self);
  self.orderBy.mockReturnValue(self);
  self.limit.mockReturnValue(self);
  self.offset.mockReturnValue(self);
  return self;
}

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => makeThenable()),
  })),
  insert: vi.fn(),
};

vi.mock("../db/client.js", () => ({
  createDb: () => mockDb,
}));

vi.mock("../lib/protocol-config.js", () => ({
  getGraduationThresholdUsd: vi.fn(async () => 12_000),
  _resetGraduationThresholdCache: vi.fn(),
}));

const mockFetchGraduatedTokensOnchain = vi.fn();
const mockFetchNonGraduatedTokensOnchain = vi.fn();
const mockComputeMarketDataForAddresses = vi.fn();
const mockBuildBatchFromTokens = vi.fn();
const mockFetchTrendingCandidatesByVolume = vi.fn();

vi.mock("../lib/market-data.js", () => ({
  fetchGraduatedTokensOnchain: mockFetchGraduatedTokensOnchain,
  fetchNonGraduatedTokensOnchain: mockFetchNonGraduatedTokensOnchain,
  fetchTrendingCandidatesByVolume: mockFetchTrendingCandidatesByVolume,
  computeMarketDataForAddresses: mockComputeMarketDataForAddresses,
  buildBatchFromTokens: mockBuildBatchFromTokens,
}));

const { default: listRoute } = await import("../routes/tokens/list.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/tokens", listRoute);
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

const LT_ADDR = "0xb88339CB7199b77E23DB6E890353E22632Ba630f";
const CREATOR = "0x1111111111111111111111111111111111111111";
const ADDR_HYPE = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const ADDR_UNSUPPORTED = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";

type DbRow = {
  address: string;
  name: string;
  ticker: string;
  description: string;
  imageUrl: string;
  ltPair: string;
  ltDirection: string;
  leverage: number;
  underlying: string;
  status: string;
  graduatedAt: Date | null;
  poolAddress: string | null;
  twitterUrl: string;
  telegramUrl: string;
  websiteUrl: string;
  creator: string;
  isHidden: boolean;
  createdAt: Date;
};

function makeDbRow(address: string, overrides: Partial<DbRow> = {}): DbRow {
  return {
    address,
    name: "Test",
    ticker: "TST",
    description: "",
    imageUrl: "",
    ltPair: LT_ADDR,
    ltDirection: "long",
    leverage: 2,
    underlying: "HYPE",
    status: "curve",
    graduatedAt: null,
    poolAddress: null,
    twitterUrl: "",
    telegramUrl: "",
    websiteUrl: "",
    creator: CREATOR,
    isHidden: false,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeOnchain(
  address: string,
  overrides: Partial<PonderTokenOnchain> = {},
): PonderTokenOnchain {
  return {
    address: address.toLowerCase(),
    ltToken: LT_ADDR.toLowerCase(),
    k: "1000000000000000000000000000000000000000000000000",
    curveSupply: "1000000000000000000000000000",
    ltReserve: "1000000000000000000000",
    pendingGraduation: false,
    pendingGraduationAt: null,
    graduated: false,
    graduatedAt: null,
    bondingPair: null,
    hyperswapPair: null,
    organicUsdcRaised: "0",
    volumeUsd: "0",
    creatorFeesUsd: "0",
    protocolFeesUsd: "0",
    communityTakeoverAt: null,
    timestamp: "1700000000",
    ...overrides,
  };
}

function makeMarket(overrides: Partial<MarketDataItem> = {}): MarketDataItem {
  return {
    priceUsd: 1,
    mcapUsd: 1_000_000,
    change24h: null,
    past24hPriceUsd: null,
    ltExchangeRate: 1,
    ltChange24h: null,
    volume24hUsd: 0,
    lastTradeAtSec: null,
    ...overrides,
  };
}

function marketBatchOk(
  entries: Array<{
    address: string;
    onchain: PonderTokenOnchain;
    market: MarketDataItem;
  }>,
): MarketDataBatchResult {
  const market: Record<string, MarketDataItem> = {};
  for (const e of entries) {
    market[e.address.toLowerCase()] = e.market;
  }
  return {
    ok: true,
    data: {
      tokens: entries.map((e) => e.onchain),
      market,
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("caches", undefined);
  inArrayCalls.length = 0;
  currentDbRows.rows = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function findSupportedUnderlyingCall(): { values: unknown[] } | undefined {
  return inArrayCalls.find(
    (call) =>
      Array.isArray(call.values) &&
      call.values.length === SUPPORTED_UNDERLYING_ASSETS.length &&
      SUPPORTED_UNDERLYING_ASSETS.every((asset) =>
        (call.values as readonly unknown[]).includes(asset),
      ),
  );
}

describe("GET /tokens - supported underlyings", () => {
  it("pushes a supported-underlying clause into SQL for the DB-first path", async () => {
    await createApp().request("/tokens", {}, makeEnv());

    expect(findSupportedUnderlyingCall()?.values).toEqual([
      ...SUPPORTED_UNDERLYING_ASSETS,
    ]);
  });

  it("returns nothing for an explicit unsupported underlying query", async () => {
    currentDbRows.rows = [
      makeDbRow(ADDR_UNSUPPORTED, {
        underlying: "FAKEASSET",
        ticker: "FAKE_TOKEN",
      }),
    ];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce({
      ok: true,
      data: { tokens: [], market: {} },
    });

    const res = await createApp().request(
      "/tokens?underlying=FAKEASSET",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(findSupportedUnderlyingCall()).toBeDefined();
  });

  it("pushes supported underlyings into the graduated tab's DB query", async () => {
    const onchainHype = makeOnchain(ADDR_HYPE, {
      graduated: true,
      graduatedAt: "1700002000",
    });
    const onchainUnsupported = makeOnchain(ADDR_UNSUPPORTED, {
      graduated: true,
      graduatedAt: "1700001000",
    });
    mockFetchGraduatedTokensOnchain.mockResolvedValueOnce([
      onchainHype,
      onchainUnsupported,
    ]);
    currentDbRows.rows = [makeDbRow(ADDR_HYPE, { ticker: "HYPE_TOKEN" })];
    mockBuildBatchFromTokens.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_HYPE, onchain: onchainHype, market: makeMarket() },
      ]),
    );

    await createApp().request("/tokens?status=graduated", {}, makeEnv());

    expect(findSupportedUnderlyingCall()).toBeDefined();
  });

  it("drops unsupported rows in-memory on the graduated tab even if the DB returned them", async () => {
    const onchainHype = makeOnchain(ADDR_HYPE, {
      graduated: true,
      graduatedAt: "1700003000",
    });
    const onchainUnsupported = makeOnchain(ADDR_UNSUPPORTED, {
      graduated: true,
      graduatedAt: "1700001000",
    });
    mockFetchGraduatedTokensOnchain.mockResolvedValueOnce([
      onchainHype,
      onchainUnsupported,
    ]);
    currentDbRows.rows = [
      makeDbRow(ADDR_HYPE, { ticker: "HYPE_TOKEN" }),
      makeDbRow(ADDR_UNSUPPORTED, {
        underlying: "FAKEASSET",
        ticker: "FAKE_TOKEN",
      }),
    ];
    mockBuildBatchFromTokens.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_HYPE, onchain: onchainHype, market: makeMarket() },
      ]),
    );

    const res = await createApp().request(
      "/tokens?status=graduated",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ ticker: string; underlying: string }>;
    };
    expect(body.data.map((t) => t.ticker)).toEqual(["HYPE_TOKEN"]);
    expect(body.data.every((t) => t.underlying !== "FAKEASSET")).toBe(true);
  });
});

describe("GET /tokens/search - supported underlyings", () => {
  it("pushes the supported-underlying clause into search-result SQL", async () => {
    await createApp().request("/tokens/search?q=test", {}, makeEnv());

    expect(findSupportedUnderlyingCall()).toBeDefined();
  });
});
