import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppBindings } from "../lib/types.js";
import type {
  MarketDataBatchResult,
  MarketDataItem,
  PonderTokenOnchain,
} from "../lib/market-data.js";

// ---------- DB mock (drizzle chain) ----------
//
// Every chain method returns the same thenable so we don't have to care
// whether the caller awaits at `.where()`, `.limit()`, or `.offset()`. The
// resolved value is controlled via `currentDbRows` so each test can swap
// it out.

const currentDbRows: { rows: DbRow[] } = { rows: [] };

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

interface DbChainable {
  then: (resolve: (rows: DbRow[]) => unknown) => unknown;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  offset: ReturnType<typeof vi.fn>;
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

// ---------- market-data mock ----------
//
// We mock at this boundary so tests don't have to wire up every single
// Ponder/BounceTech dependency. The lower-level behaviour of those
// functions is covered in `market-data.test.ts`.

const mockFetchGraduatedTokensOnchain = vi.fn();
const mockFetchGraduatingTokensOnchain = vi.fn();
const mockComputeMarketDataForAddresses = vi.fn();
const mockBuildBatchFromTokens = vi.fn();

vi.mock("../lib/market-data.js", () => ({
  fetchGraduatedTokensOnchain: mockFetchGraduatedTokensOnchain,
  fetchGraduatingTokensOnchain: mockFetchGraduatingTokensOnchain,
  computeMarketDataForAddresses: mockComputeMarketDataForAddresses,
  buildBatchFromTokens: mockBuildBatchFromTokens,
}));

// Stub the threshold lookup so tests don't fan out to a non-existent
// indexer (which would hang the per-test 5s deadline). Routes are agnostic
// to the value — we just need the call to resolve quickly with a number.
vi.mock("../lib/protocol-config.js", () => ({
  getGraduationThresholdUsd: vi.fn(async () => 12_000),
  _resetGraduationThresholdCache: vi.fn(),
}));

// Stub the live-LT availability lookup so these tests don't fan out to
// BounceTech (real network in vitest). The route fail-opens on an
// `unfresh` snapshot, so we surface an empty, non-fresh one — exactly
// what the route handlers expect on a cold start with no warm cache.
// LT-availability-specific behaviour is exercised in `lt-availability.test.ts`
// and `assets.test.ts`.
vi.mock("../lib/lt-availability.js", () => ({
  getLiveLtAvailability: vi.fn(async () => ({
    liveAddresses: new Set<string>(),
    liveSymbols: new Set<string>(),
    liveUnderlyings: new Set<string>(),
    fresh: false,
  })),
  _resetLtAvailabilityCache: vi.fn(),
}));

vi.stubGlobal("caches", undefined);

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

// ---------- test data helpers ----------

// Checksummed (what the DB stores — see `create.ts`, `tokens.address`
// primary key is written via `getAddress`). Lowercasing these for the
// Ponder side mirrors how the indexer actually returns them.
const ADDR_A = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const ADDR_B = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
const ADDR_C = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
const LT_ADDR = "0xb88339CB7199b77E23DB6E890353E22632Ba630f";
const CREATOR = "0x1111111111111111111111111111111111111111";

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
  entries: Array<{ address: string; onchain: PonderTokenOnchain; market: MarketDataItem }>,
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

// ---------- tests ----------

describe("GET /tokens?status=graduated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves Ponder's graduatedAt-desc ordering", async () => {
    // Ponder returns A, B, C in graduatedAt-desc order.
    const onchainA = makeOnchain(ADDR_A, {
      graduated: true,
      graduatedAt: "1700003000",
    });
    const onchainB = makeOnchain(ADDR_B, {
      graduated: true,
      graduatedAt: "1700002000",
    });
    const onchainC = makeOnchain(ADDR_C, {
      graduated: true,
      graduatedAt: "1700001000",
    });
    mockFetchGraduatedTokensOnchain.mockResolvedValueOnce([
      onchainA,
      onchainB,
      onchainC,
    ]);

    // DB returns the same rows but in a DIFFERENT order (simulating
    // Postgres ignoring our intended order). The route must re-order to
    // match the Ponder ordering.
    currentDbRows.rows = [
      makeDbRow(ADDR_C, { ticker: "CCC" }),
      makeDbRow(ADDR_A, { ticker: "AAA" }),
      makeDbRow(ADDR_B, { ticker: "BBB" }),
    ];

    mockBuildBatchFromTokens.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_A, onchain: onchainA, market: makeMarket() },
        { address: ADDR_B, onchain: onchainB, market: makeMarket() },
        { address: ADDR_C, onchain: onchainC, market: makeMarket() },
      ]),
    );

    const res = await createApp().request(
      "/tokens?status=graduated",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ address: string; ticker: string }>;
    };
    expect(body.data.map((t) => t.ticker)).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("returns 503 when the indexer is unreachable", async () => {
    mockFetchGraduatedTokensOnchain.mockResolvedValueOnce(null);

    const res = await createApp().request(
      "/tokens?status=graduated",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Indexer unavailable");
  });

  it("drops tokens hidden in Postgres even if Ponder flagged them graduated", async () => {
    const onchainA = makeOnchain(ADDR_A, {
      graduated: true,
      graduatedAt: "1700003000",
    });
    const onchainB = makeOnchain(ADDR_B, {
      graduated: true,
      graduatedAt: "1700002000",
    });
    mockFetchGraduatedTokensOnchain.mockResolvedValueOnce([onchainA, onchainB]);

    // Only ADDR_B comes back from Postgres — ADDR_A was filtered out by
    // `isHidden = false` at query time.
    currentDbRows.rows = [makeDbRow(ADDR_B, { ticker: "BBB" })];

    mockBuildBatchFromTokens.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_B, onchain: onchainB, market: makeMarket() },
      ]),
    );

    const res = await createApp().request(
      "/tokens?status=graduated",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ ticker: string }>;
    };
    expect(body.data.map((t) => t.ticker)).toEqual(["BBB"]);
  });

  it("uses the Ponder-first branch (not computeMarketDataForAddresses) to avoid re-fetching", async () => {
    const onchainA = makeOnchain(ADDR_A, {
      graduated: true,
      graduatedAt: "1700001000",
    });
    mockFetchGraduatedTokensOnchain.mockResolvedValueOnce([onchainA]);
    currentDbRows.rows = [makeDbRow(ADDR_A)];
    mockBuildBatchFromTokens.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_A, onchain: onchainA, market: makeMarket() },
      ]),
    );

    await createApp().request("/tokens?status=graduated", {}, makeEnv());

    expect(mockBuildBatchFromTokens).toHaveBeenCalledTimes(1);
    expect(mockComputeMarketDataForAddresses).not.toHaveBeenCalled();
  });
});

describe("GET /tokens?status=graduating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves Ponder's curveSupply-asc (closest-to-graduation first) ordering", async () => {
    // Ponder gives us tokens ordered by curveSupply asc (fullest first).
    const onchainA = makeOnchain(ADDR_A, {
      curveSupply: "260000000000000000000000000",
    });
    const onchainB = makeOnchain(ADDR_B, {
      curveSupply: "280000000000000000000000000",
    });
    const onchainC = makeOnchain(ADDR_C, {
      curveSupply: "320000000000000000000000000",
    });
    mockFetchGraduatingTokensOnchain.mockResolvedValueOnce([
      onchainA,
      onchainB,
      onchainC,
    ]);

    currentDbRows.rows = [
      makeDbRow(ADDR_B, { ticker: "BBB" }),
      makeDbRow(ADDR_C, { ticker: "CCC" }),
      makeDbRow(ADDR_A, { ticker: "AAA" }),
    ];

    mockBuildBatchFromTokens.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_A, onchain: onchainA, market: makeMarket() },
        { address: ADDR_B, onchain: onchainB, market: makeMarket() },
        { address: ADDR_C, onchain: onchainC, market: makeMarket() },
      ]),
    );

    const res = await createApp().request(
      "/tokens?status=graduating",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ ticker: string }>;
    };
    expect(body.data.map((t) => t.ticker)).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("returns 503 when the indexer is unreachable", async () => {
    mockFetchGraduatingTokensOnchain.mockResolvedValueOnce(null);

    const res = await createApp().request(
      "/tokens?status=graduating",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(503);
  });
});


describe("GET /tokens — totalVolumeUsd enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Three cases that match the docstring semantics on `totalVolumeUsd`:
  //   1. indexer has a non-zero counter → USDC (6dp) → USD float
  //   2. indexer row exists but the token has never traded → 0
  //   3. indexer is unreachable (no onchain row at all) → null
  it("converts the indexer's volumeUsd counter (6dp USDC) into a USD float", async () => {
    // 7_500_123 (6dp) = $7.500123.
    const onchain = makeOnchain(ADDR_A, { volumeUsd: "7500123" });
    currentDbRows.rows = [makeDbRow(ADDR_A, { ticker: "AAA" })];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([{ address: ADDR_A, onchain, market: makeMarket() }]),
    );

    const res = await createApp().request("/tokens", {}, makeEnv());
    const body = (await res.json()) as {
      data: Array<{ totalVolumeUsd: number | null }>;
    };
    expect(body.data[0].totalVolumeUsd).toBeCloseTo(7.500123, 5);
  });

  it("returns 0 when the token has been indexed but never traded", async () => {
    // Distinguishes "quiet but present" from "indexer unreachable". The
    // `makeOnchain` helper already defaults `volumeUsd` to "0".
    const onchain = makeOnchain(ADDR_A);
    currentDbRows.rows = [makeDbRow(ADDR_A, { ticker: "AAA" })];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([{ address: ADDR_A, onchain, market: makeMarket() }]),
    );

    const res = await createApp().request("/tokens", {}, makeEnv());
    const body = (await res.json()) as {
      data: Array<{ totalVolumeUsd: number | null }>;
    };
    expect(body.data[0].totalVolumeUsd).toBe(0);
  });

  it("returns null when the indexer has no row for the token", async () => {
    // `computeMarketDataForAddresses` returning ok with no entries is how the
    // route surfaces "DB has this token, but Ponder hasn't caught up / is
    // down". Enrichment should mark on-chain fields (including
    // `totalVolumeUsd`) as null rather than silently showing 0.
    currentDbRows.rows = [makeDbRow(ADDR_A, { ticker: "AAA" })];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(marketBatchOk([]));

    const res = await createApp().request("/tokens", {}, makeEnv());
    const body = (await res.json()) as {
      data: Array<{ totalVolumeUsd: number | null }>;
    };
    expect(body.data[0].totalVolumeUsd).toBeNull();
  });
});
