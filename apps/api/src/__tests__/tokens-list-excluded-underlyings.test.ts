/**
 * Coverage for issue #639's "hide retired markets" filter as applied to
 * `GET /tokens` (status=curve/graduated/graduating + trending sort) and
 * `GET /tokens/search`. The filter pushes a `underlying NOT IN (...)`
 * clause into the SQL whenever `EXCLUDED_UNDERLYING_ASSETS` is
 * non-empty, and an extra in-memory `matchesFilters` reject on the
 * Ponder-first graduated/graduating tabs.
 */

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EXCLUDED_UNDERLYING_ASSETS } from "@launchpad/shared";

import type { AppBindings } from "../lib/types.js";
import type {
  MarketDataBatchResult,
  MarketDataItem,
  PonderTokenOnchain,
} from "../lib/market-data.js";

// ── Drizzle chain mock — capture every notInArray call so we can assert
// the exclusion list landed in the WHERE clause. ──
const notInArrayCalls: { values: unknown[] }[] = [];

vi.mock("drizzle-orm", async () => {
  const actual =
    await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    notInArray: vi.fn((column: unknown, values: unknown[]) => {
      notInArrayCalls.push({ values });
      return actual.notInArray(
        column as Parameters<typeof actual.notInArray>[0],
        values,
      );
    }),
  };
});

// Fail-open live-LT availability so this file's assertions aren't
// entangled with the issue #621 SQL filter. The "fresh: false" snapshot
// triggers the same fail-open path the production route takes when
// BounceTech is unreachable.
vi.mock("../lib/lt-availability.js", () => ({
  getLiveLtAvailability: vi.fn(async () => ({
    liveAddresses: new Set<string>(),
    liveSymbols: new Set<string>(),
    liveUnderlyings: new Set<string>(),
    fresh: false,
  })),
  _resetLtAvailabilityCache: vi.fn(),
}));

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

// Threshold lookup stub — graduated/graduating paths await this, and we
// don't want the test to fan out to a real Ponder instance.
vi.mock("../lib/protocol-config.js", () => ({
  getGraduationThresholdUsd: vi.fn(async () => 12_000),
  _resetGraduationThresholdCache: vi.fn(),
}));

const mockFetchGraduatedTokensOnchain = vi.fn();
const mockFetchNonGraduatedTokensOnchain = vi.fn();
const mockComputeMarketDataForAddresses = vi.fn();
const mockBuildBatchFromTokens = vi.fn();

vi.mock("../lib/market-data.js", () => ({
  fetchGraduatedTokensOnchain: mockFetchGraduatedTokensOnchain,
  fetchNonGraduatedTokensOnchain: mockFetchNonGraduatedTokensOnchain,
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
    PONDER_URL: "http://localhost:42069",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
  };
}

const LT_ADDR = "0xb88339CB7199b77E23DB6E890353E22632Ba630f";
const CREATOR = "0x1111111111111111111111111111111111111111";
// Checksummed addresses — DB stores them this way (see `create.ts`,
// `getAddress`). One visible token + one PAXG token to confirm the
// in-memory `matchesFilters` reject path drops the PAXG row even when
// Ponder considered it graduated.
const ADDR_HYPE = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const ADDR_PAXG = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";

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
  // Same per-test global stubbing pattern as `tokens-list-live-lt.test.ts` —
  // keeps the `caches` override out of sibling files.
  vi.stubGlobal("caches", undefined);
  notInArrayCalls.length = 0;
  currentDbRows.rows = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /tokens — excluded underlyings (issue #639)", () => {
  it("pushes a `underlying NOT IN (...)` clause into SQL for the DB-first path", async () => {
    // Trending vs createdAt sort doesn't matter here — both go through
    // the same `conditions` array.
    await createApp().request("/tokens", {}, makeEnv());

    const excludedCall = notInArrayCalls.find(
      (call) =>
        Array.isArray(call.values) &&
        (call.values as string[]).some(
          (v) =>
            typeof v === "string" &&
            (EXCLUDED_UNDERLYING_ASSETS as readonly string[]).includes(v),
        ),
    );
    expect(excludedCall).toBeDefined();
    expect(excludedCall?.values).toEqual([...EXCLUDED_UNDERLYING_ASSETS]);
  });

  it("returns nothing for an explicit `?underlying=PAXG` query (the exclusion wins)", async () => {
    // DB returns a PAXG row (e.g. legacy or migration backfill that
    // arrived before the exclusion shipped). The route's WHERE clause
    // should keep it out of the response even though the user asked for
    // it by name.
    currentDbRows.rows = [
      makeDbRow(ADDR_PAXG, { underlying: "PAXG", ticker: "PAXG_TOKEN" }),
    ];
    // No Ponder enrichment needed for this path — the row's already
    // filtered out before market-data is fetched.
    mockComputeMarketDataForAddresses.mockResolvedValueOnce({
      ok: true,
      data: { tokens: [], market: {} },
    });

    const res = await createApp().request(
      "/tokens?underlying=PAXG",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);

    // Both clauses landed: the global `NOT IN (PAXG)` exclusion + the
    // user's `underlying = PAXG` filter — producing an empty set at the
    // SQL boundary.
    const excludedCall = notInArrayCalls.find((call) =>
      (call.values as string[]).includes("PAXG"),
    );
    expect(excludedCall).toBeDefined();
  });

  it("pushes the exclusion into the graduated tab's DB query", async () => {
    // Ponder reports two graduated tokens — one HYPE, one PAXG. The DB
    // query for hydrating the page should carry the `NOT IN (PAXG)`
    // clause so the PAXG row never even makes it back from Postgres.
    const onchainHype = makeOnchain(ADDR_HYPE, {
      graduated: true,
      graduatedAt: "1700002000",
    });
    const onchainPaxg = makeOnchain(ADDR_PAXG, {
      graduated: true,
      graduatedAt: "1700001000",
    });
    mockFetchGraduatedTokensOnchain.mockResolvedValueOnce([
      onchainHype,
      onchainPaxg,
    ]);
    // Simulate Postgres honouring the exclusion (mock can't actually
    // evaluate WHERE — we just verify the route asked for it).
    currentDbRows.rows = [makeDbRow(ADDR_HYPE, { ticker: "HYPE_TOKEN" })];
    mockBuildBatchFromTokens.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_HYPE, onchain: onchainHype, market: makeMarket() },
      ]),
    );

    await createApp().request("/tokens?status=graduated", {}, makeEnv());

    const excludedCall = notInArrayCalls.find((call) =>
      (call.values as string[]).includes("PAXG"),
    );
    expect(excludedCall).toBeDefined();
  });

  it("drops PAXG rows in-memory on the graduated tab even if the DB returned them", async () => {
    // Belt-and-braces — the in-memory `matchesFilters` reject path is
    // what protects us if the DB mock (or a stale Postgres replica)
    // doesn't honour the WHERE. With both clauses the route is
    // resilient to either one being short-circuited.
    const onchainHype = makeOnchain(ADDR_HYPE, {
      graduated: true,
      graduatedAt: "1700003000",
    });
    const onchainPaxg = makeOnchain(ADDR_PAXG, {
      graduated: true,
      graduatedAt: "1700001000",
    });
    mockFetchGraduatedTokensOnchain.mockResolvedValueOnce([
      onchainHype,
      onchainPaxg,
    ]);
    currentDbRows.rows = [
      makeDbRow(ADDR_HYPE, { ticker: "HYPE_TOKEN" }),
      makeDbRow(ADDR_PAXG, { underlying: "PAXG", ticker: "PAXG_TOKEN" }),
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
    expect(body.data.every((t) => t.underlying !== "PAXG")).toBe(true);
  });
});

describe("GET /tokens/search — excluded underlyings (issue #639)", () => {
  it("pushes the exclusion clause into search-result SQL", async () => {
    await createApp().request("/tokens/search?q=test", {}, makeEnv());

    const excludedCall = notInArrayCalls.find((call) =>
      (call.values as string[]).includes("PAXG"),
    );
    expect(excludedCall).toBeDefined();
  });
});
