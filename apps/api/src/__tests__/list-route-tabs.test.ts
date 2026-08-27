import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PLATFORM_TOKEN_ADDRESS } from "@launchpad/shared";

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
const mockFetchNonGraduatedTokensOnchain = vi.fn();
const mockFetchTrendingCandidatesByVolume = vi.fn();
const mockComputeMarketDataForAddresses = vi.fn();
const mockBuildBatchFromTokens = vi.fn();

vi.mock("../lib/market-data.js", () => ({
  fetchGraduatedTokensOnchain: mockFetchGraduatedTokensOnchain,
  fetchNonGraduatedTokensOnchain: mockFetchNonGraduatedTokensOnchain,
  fetchTrendingCandidatesByVolume: mockFetchTrendingCandidatesByVolume,
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
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
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

  // The home page badges community takeovers straight off the list response,
  // so the field has to survive the list path — not just the detail route.
  it("serialises communityTakeoverAt as ISO on the list response", async () => {
    const onchainA = makeOnchain(ADDR_A, {
      graduated: true,
      graduatedAt: "1700003000",
      communityTakeoverAt: "1700003600",
    });
    const onchainB = makeOnchain(ADDR_B, {
      graduated: true,
      graduatedAt: "1700002000",
    });
    mockFetchGraduatedTokensOnchain.mockResolvedValueOnce([onchainA, onchainB]);

    currentDbRows.rows = [
      makeDbRow(ADDR_A, { ticker: "AAA" }),
      makeDbRow(ADDR_B, { ticker: "BBB" }),
    ];

    mockBuildBatchFromTokens.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_A, onchain: onchainA, market: makeMarket() },
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
      data: Array<{ ticker: string; communityTakeoverAt: string | null }>;
    };
    expect(
      body.data.map((t) => [t.ticker, t.communityTakeoverAt]),
    ).toEqual([
      ["AAA", "2023-11-14T23:13:20.000Z"],
      ["BBB", null],
    ]);
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

  // Helper: convert a desired `supplyFilled` percent into the virtual
  // reserve0 string the indexer would persist. Inverse of
  // `computeCurveFilled` — given `supplyFilled = (CURVE_ALLOCATION −
  // realRemaining) / CURVE_ALLOCATION × 100`, we recover
  // `curveSupply = realRemaining + LP_RESERVE_RAW`.
  //
  // `CURVE_ALLOCATION = 750M × 1e18`, `LP_RESERVE_RAW = 250M × 1e18`.
  function curveSupplyForSupplyFilled(pct: number): string {
    const CURVE_ALLOCATION = 750_000_000n * 10n ** 18n;
    const LP_RESERVE_RAW = 250_000_000n * 10n ** 18n;
    const soldBps = BigInt(Math.round(pct * 100));
    const sold = (CURVE_ALLOCATION * soldBps) / 10_000n;
    const realRemaining = CURVE_ALLOCATION - sold;
    return (realRemaining + LP_RESERVE_RAW).toString();
  }

  // Market stub with `ltExchangeRate: null` so
  // `computeCurveFilledBreakdown` falls back to the supply-only
  // `curveFilled` path. That gives us a closed-form mapping from the
  // mocked `curveSupply` to the enriched `curveFilled`, which is what
  // the tab filters + sorts on — so assertions on threshold + ordering
  // stay legible without faking USD math.
  const noLtRate: Partial<MarketDataItem> = { ltExchangeRate: null };

  it("includes only tokens with curveFilled >= 75% and sorts them desc", async () => {
    // Four candidates spanning the gate: above (95, 90, 75) and below
    // (70, 50). The 70% / 50% rows must be filtered out; the rest must
    // come back in 95 → 90 → 75 order regardless of how Ponder / the DB
    // mock ordered them.
    const onchainA = makeOnchain(ADDR_A, {
      curveSupply: curveSupplyForSupplyFilled(95),
    });
    const onchainB = makeOnchain(ADDR_B, {
      curveSupply: curveSupplyForSupplyFilled(90),
    });
    const onchainC = makeOnchain(ADDR_C, {
      curveSupply: curveSupplyForSupplyFilled(75),
    });
    const ADDR_D = "0x4444444444444444444444444444444444444444";
    const ADDR_E = "0x5555555555555555555555555555555555555555";
    const onchainD = makeOnchain(ADDR_D, {
      curveSupply: curveSupplyForSupplyFilled(70),
    });
    const onchainE = makeOnchain(ADDR_E, {
      curveSupply: curveSupplyForSupplyFilled(50),
    });
    mockFetchNonGraduatedTokensOnchain.mockResolvedValueOnce([
      onchainA,
      onchainB,
      onchainC,
      onchainD,
      onchainE,
    ]);

    // Order intentionally scrambled to confirm the route sorts on
    // curveFilled, not on the order the DB happened to return rows in.
    currentDbRows.rows = [
      makeDbRow(ADDR_C, { ticker: "CCC" }),
      makeDbRow(ADDR_A, { ticker: "AAA" }),
      makeDbRow(ADDR_E, { ticker: "EEE" }),
      makeDbRow(ADDR_B, { ticker: "BBB" }),
      makeDbRow(ADDR_D, { ticker: "DDD" }),
    ];

    mockBuildBatchFromTokens.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_A, onchain: onchainA, market: makeMarket(noLtRate) },
        { address: ADDR_B, onchain: onchainB, market: makeMarket(noLtRate) },
        { address: ADDR_C, onchain: onchainC, market: makeMarket(noLtRate) },
        { address: ADDR_D, onchain: onchainD, market: makeMarket(noLtRate) },
        { address: ADDR_E, onchain: onchainE, market: makeMarket(noLtRate) },
      ]),
    );

    const res = await createApp().request(
      "/tokens?status=graduating",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ ticker: string; curveFilled: number }>;
    };
    expect(body.data.map((t) => t.ticker)).toEqual(["AAA", "BBB", "CCC"]);
    expect(body.data.map((t) => Math.round(t.curveFilled))).toEqual([
      95, 90, 75,
    ]);
  });

  it("breaks ties on curveFilled by mcap desc", async () => {
    // Two tokens at exactly the same curveFilled (90%) but different
    // mcaps. Higher mcap must come first — mirrors the trending sort's
    // tie-break so quiet tokens don't leapfrog priced ones on identical
    // progress.
    const onchainHigh = makeOnchain(ADDR_A, {
      curveSupply: curveSupplyForSupplyFilled(90),
    });
    const onchainLow = makeOnchain(ADDR_B, {
      curveSupply: curveSupplyForSupplyFilled(90),
    });
    mockFetchNonGraduatedTokensOnchain.mockResolvedValueOnce([
      onchainHigh,
      onchainLow,
    ]);
    currentDbRows.rows = [
      makeDbRow(ADDR_B, { ticker: "LOW_MCAP" }),
      makeDbRow(ADDR_A, { ticker: "HIGH_MCAP" }),
    ];
    mockBuildBatchFromTokens.mockResolvedValueOnce(
      marketBatchOk([
        {
          address: ADDR_A,
          onchain: onchainHigh,
          market: makeMarket({ ...noLtRate, mcapUsd: 10_000_000 }),
        },
        {
          address: ADDR_B,
          onchain: onchainLow,
          market: makeMarket({ ...noLtRate, mcapUsd: 1_000 }),
        },
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
    expect(body.data.map((t) => t.ticker)).toEqual(["HIGH_MCAP", "LOW_MCAP"]);
  });

  it("drops graduated tokens defensively even if they slipped past the Ponder filter", async () => {
    // The Ponder query is `graduated: false` so this is a belt-and-
    // braces case (e.g. a token that finalised between the fetch and
    // the enrich, or a stale Ponder reply). Either way the GRADUATING
    // tab must NEVER surface a graduated token — that's the GRADUATED
    // tab's job.
    const onchainGraduated = makeOnchain(ADDR_A, {
      curveSupply: curveSupplyForSupplyFilled(99),
      graduated: true,
      graduatedAt: "1700000000",
    });
    const onchainCurve = makeOnchain(ADDR_B, {
      curveSupply: curveSupplyForSupplyFilled(90),
    });
    mockFetchNonGraduatedTokensOnchain.mockResolvedValueOnce([
      onchainGraduated,
      onchainCurve,
    ]);
    currentDbRows.rows = [
      makeDbRow(ADDR_A, { ticker: "GRADUATED" }),
      makeDbRow(ADDR_B, { ticker: "CURVE" }),
    ];
    mockBuildBatchFromTokens.mockResolvedValueOnce(
      marketBatchOk([
        {
          address: ADDR_A,
          onchain: onchainGraduated,
          market: makeMarket(noLtRate),
        },
        {
          address: ADDR_B,
          onchain: onchainCurve,
          market: makeMarket(noLtRate),
        },
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
    expect(body.data.map((t) => t.ticker)).toEqual(["CURVE"]);
  });

  it("falls back to supplyFilled when BounceTech is degraded so the tab still renders", async () => {
    // `buildBatchFromTokens` returns `ok: false` when the BounceTech
    // dependency is unreachable. The route must still render the tab
    // — `curveFilled` falls back to supplyFilled, which is enough to
    // evaluate the 85% gate for the overwhelming majority of tokens.
    // Worse failure mode would be blanking the tab during a
    // BounceTech blip.
    const onchainA = makeOnchain(ADDR_A, {
      curveSupply: curveSupplyForSupplyFilled(92),
    });
    const onchainB = makeOnchain(ADDR_B, {
      curveSupply: curveSupplyForSupplyFilled(70),
    });
    mockFetchNonGraduatedTokensOnchain.mockResolvedValueOnce([
      onchainA,
      onchainB,
    ]);
    currentDbRows.rows = [
      makeDbRow(ADDR_A, { ticker: "AAA" }),
      makeDbRow(ADDR_B, { ticker: "BBB" }),
    ];
    mockBuildBatchFromTokens.mockResolvedValueOnce({
      ok: false,
      error: "BounceTech API unavailable",
      code: 503,
    } satisfies MarketDataBatchResult);

    const res = await createApp().request(
      "/tokens?status=graduating",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dataSource: string;
      data: Array<{ ticker: string }>;
    };
    expect(body.dataSource).toBe("degraded");
    expect(body.data.map((t) => t.ticker)).toEqual(["AAA"]);
  });

  it("returns 503 when the indexer is unreachable", async () => {
    mockFetchNonGraduatedTokensOnchain.mockResolvedValueOnce(null);

    const res = await createApp().request(
      "/tokens?status=graduating",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(503);
  });

  it("returns an empty list when Ponder reports zero non-graduated tokens", async () => {
    mockFetchNonGraduatedTokensOnchain.mockResolvedValueOnce([]);

    const res = await createApp().request(
      "/tokens?status=graduating",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
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

/**
 * Coverage for the volume-based trending candidate path. The trending
 * tab is a multi-window walk over the per-token hourly bucket table:
 * each token is placed in the most-recent 24h window it traded in and
 * ranked by in-window volume, window 0 (last 24h) first, then 24–48h,
 * etc. — no precomputed score, no boost, no recency decay beyond the
 * window bucketing. The candidate query IS the ranking. These tests
 * cover the happy path (ranking preserved across hydration), the
 * cross-window ordering, the indexer-down fallback (createdAt-DESC +
 * dataSource=degraded), the empty-result short-circuit, and the
 * hour-start arg the read buckets back from.
 */
describe("GET /tokens?sort=trending — volume-based candidate path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sorts hydrated rows by the 24h volume the candidate query returned (not by DB order)", async () => {
    // Candidate query returns (B=5000 USD, A=1000 USD, C=100 USD) —
    // the API must surface tokens in that order regardless of how
    // Postgres returned the hydrated rows.
    mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce([
      { tokenAddress: ADDR_B.toLowerCase(), volume24hUsd: 5_000 },
      { tokenAddress: ADDR_A.toLowerCase(), volume24hUsd: 1_000 },
      { tokenAddress: ADDR_C.toLowerCase(), volume24hUsd: 100 },
    ]);
    const onchainA = makeOnchain(ADDR_A);
    const onchainB = makeOnchain(ADDR_B);
    const onchainC = makeOnchain(ADDR_C);
    currentDbRows.rows = [
      makeDbRow(ADDR_C, { ticker: "CCC" }),
      makeDbRow(ADDR_A, { ticker: "AAA" }),
      makeDbRow(ADDR_B, { ticker: "BBB" }),
    ];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_A, onchain: onchainA, market: makeMarket() },
        { address: ADDR_B, onchain: onchainB, market: makeMarket() },
        { address: ADDR_C, onchain: onchainC, market: makeMarket() },
      ]),
    );

    const res = await createApp().request(
      "/tokens?sort=trending",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ ticker: string }>;
    };
    expect(body.data.map((t) => t.ticker)).toEqual(["BBB", "AAA", "CCC"]);
  });

  it("passes the current hour-start so the read can bucket into 24h windows", async () => {
    mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce([]);
    await createApp().request("/tokens?sort=trending", {}, makeEnv());

    expect(mockFetchTrendingCandidatesByVolume).toHaveBeenCalledTimes(1);
    const call = mockFetchTrendingCandidatesByVolume.mock.calls[0];
    const passedHourStart = call?.[2] as number;
    // The read now buckets back from the current hour-start
    // (`floor(now / 3600) * 3600`) rather than receiving a precomputed
    // 24h cutoff — so it lands on an hour boundary in [now − 3600, now].
    const nowSec = Math.floor(Date.now() / 1000);
    expect(passedHourStart % 3600).toBe(0);
    expect(passedHourStart).toBeGreaterThanOrEqual(nowSec - 3600);
    expect(passedHourStart).toBeLessThanOrEqual(nowSec);
  });

  it("orders the last-24h cohort ahead of older windows regardless of in-window volume", async () => {
    // Multi-window walk: A traded only in window 1 (24–48h ago) with a
    // big in-window volume; B traded in window 0 (last 24h) with a tiny
    // volume. B must still rank first — newer window wins over raw
    // in-window volume. The candidate stub is deliberately returned in
    // the "wrong" order (A first) to prove the route re-ranks on
    // windowIndex rather than trusting array position.
    mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce([
      { tokenAddress: ADDR_A.toLowerCase(), volume24hUsd: 5_000, windowIndex: 1 },
      { tokenAddress: ADDR_B.toLowerCase(), volume24hUsd: 100, windowIndex: 0 },
    ]);
    const onchainA = makeOnchain(ADDR_A);
    const onchainB = makeOnchain(ADDR_B);
    currentDbRows.rows = [
      makeDbRow(ADDR_A, { ticker: "OLD_WINDOW" }),
      makeDbRow(ADDR_B, { ticker: "LAST_24H" }),
    ];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_A, onchain: onchainA, market: makeMarket() },
        { address: ADDR_B, onchain: onchainB, market: makeMarket() },
      ]),
    );

    const res = await createApp().request(
      "/tokens?sort=trending",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ ticker: string }> };
    expect(body.data.map((t) => t.ticker)).toEqual(["LAST_24H", "OLD_WINDOW"]);
  });

  it("breaks volume ties on mcap desc so quiet tokens can't leapfrog priced ones", async () => {
    mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce([
      { tokenAddress: ADDR_A.toLowerCase(), volume24hUsd: 1_000 },
      { tokenAddress: ADDR_B.toLowerCase(), volume24hUsd: 1_000 },
    ]);
    const onchainA = makeOnchain(ADDR_A);
    const onchainB = makeOnchain(ADDR_B);
    currentDbRows.rows = [
      makeDbRow(ADDR_A, { ticker: "LOW_MCAP" }),
      makeDbRow(ADDR_B, { ticker: "HIGH_MCAP" }),
    ];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([
        {
          address: ADDR_A,
          onchain: onchainA,
          market: makeMarket({ mcapUsd: 1_000 }),
        },
        {
          address: ADDR_B,
          onchain: onchainB,
          market: makeMarket({ mcapUsd: 10_000_000 }),
        },
      ]),
    );

    const res = await createApp().request(
      "/tokens?sort=trending",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ ticker: string }>;
    };
    expect(body.data.map((t) => t.ticker)).toEqual(["HIGH_MCAP", "LOW_MCAP"]);
  });

  it("falls back to a createdAt-DESC pool + marks degraded when the indexer is down", async () => {
    // Indexer returns null → trending tab stays visible (we don't 503
    // the home page) but we record the degradation in `dataSource` and
    // shorten the cache TTL.
    mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce(null);
    currentDbRows.rows = [makeDbRow(ADDR_A, { ticker: "AAA" })];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_A, onchain: makeOnchain(ADDR_A), market: makeMarket() },
      ]),
    );

    const res = await createApp().request(
      "/tokens?sort=trending",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dataSource: string;
      data: Array<{ ticker: string }>;
    };
    expect(body.dataSource).toBe("degraded");
    expect(body.data.map((t) => t.ticker)).toEqual(["AAA"]);
  });

  it("returns an empty list when the indexer reports zero recent trades", async () => {
    mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce([]);
    currentDbRows.rows = [];

    const res = await createApp().request(
      "/tokens?sort=trending",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
    // Should never call market-data when there's nothing to hydrate.
    expect(mockComputeMarketDataForAddresses).not.toHaveBeenCalled();
  });

  it("pins the platform token first on sort=trending even when it ranks lower by volume", async () => {
    mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce([
      { tokenAddress: ADDR_B.toLowerCase(), volume24hUsd: 5_000 },
      { tokenAddress: ADDR_A.toLowerCase(), volume24hUsd: 1_000 },
      {
        tokenAddress: PLATFORM_TOKEN_ADDRESS.toLowerCase(),
        volume24hUsd: 10,
      },
    ]);
    currentDbRows.rows = [
      makeDbRow(ADDR_B, { ticker: "BBB" }),
      makeDbRow(ADDR_A, { ticker: "AAA" }),
      makeDbRow(PLATFORM_TOKEN_ADDRESS, { ticker: "ALT" }),
    ];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([
        {
          address: PLATFORM_TOKEN_ADDRESS,
          onchain: makeOnchain(PLATFORM_TOKEN_ADDRESS),
          market: makeMarket(),
        },
        { address: ADDR_B, onchain: makeOnchain(ADDR_B), market: makeMarket() },
        { address: ADDR_A, onchain: makeOnchain(ADDR_A), market: makeMarket() },
      ]),
    );

    const res = await createApp().request(
      "/tokens?sort=trending",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ ticker: string }> };
    expect(body.data.map((t) => t.ticker)).toEqual(["ALT", "BBB", "AAA"]);
  });

  it("does not pin the platform token on sort=volume24h", async () => {
    mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce([
      { tokenAddress: ADDR_B.toLowerCase(), volume24hUsd: 5_000 },
      { tokenAddress: ADDR_A.toLowerCase(), volume24hUsd: 1_000 },
      {
        tokenAddress: PLATFORM_TOKEN_ADDRESS.toLowerCase(),
        volume24hUsd: 10,
      },
    ]);
    currentDbRows.rows = [
      makeDbRow(ADDR_B, { ticker: "BBB" }),
      makeDbRow(ADDR_A, { ticker: "AAA" }),
      makeDbRow(PLATFORM_TOKEN_ADDRESS, { ticker: "ALT" }),
    ];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_B, onchain: makeOnchain(ADDR_B), market: makeMarket() },
        { address: ADDR_A, onchain: makeOnchain(ADDR_A), market: makeMarket() },
        {
          address: PLATFORM_TOKEN_ADDRESS,
          onchain: makeOnchain(PLATFORM_TOKEN_ADDRESS),
          market: makeMarket(),
        },
      ]),
    );

    const res = await createApp().request(
      "/tokens?sort=volume24h",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ ticker: string }> };
    expect(body.data.map((t) => t.ticker)).toEqual(["BBB", "AAA", "ALT"]);
  });

  it("pins the platform token even when it is absent from the volume candidate pool", async () => {
    mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce([
      { tokenAddress: ADDR_B.toLowerCase(), volume24hUsd: 5_000 },
      { tokenAddress: ADDR_A.toLowerCase(), volume24hUsd: 1_000 },
    ]);
    currentDbRows.rows = [
      makeDbRow(ADDR_B, { ticker: "BBB" }),
      makeDbRow(ADDR_A, { ticker: "AAA" }),
      makeDbRow(PLATFORM_TOKEN_ADDRESS, { ticker: "ALT" }),
    ];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([
        {
          address: PLATFORM_TOKEN_ADDRESS,
          onchain: makeOnchain(PLATFORM_TOKEN_ADDRESS),
          market: makeMarket(),
        },
        { address: ADDR_B, onchain: makeOnchain(ADDR_B), market: makeMarket() },
        { address: ADDR_A, onchain: makeOnchain(ADDR_A), market: makeMarket() },
      ]),
    );

    const res = await createApp().request(
      "/tokens?sort=trending",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ ticker: string }> };
    expect(body.data.map((t) => t.ticker)).toEqual(["ALT", "BBB", "AAA"]);
  });

  it("surfaces the platform token when the volume pool is empty", async () => {
    mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce([]);
    currentDbRows.rows = [
      makeDbRow(PLATFORM_TOKEN_ADDRESS, { ticker: "ALT" }),
    ];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([
        {
          address: PLATFORM_TOKEN_ADDRESS,
          onchain: makeOnchain(PLATFORM_TOKEN_ADDRESS),
          market: makeMarket(),
        },
      ]),
    );

    const res = await createApp().request(
      "/tokens?sort=trending",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ ticker: string }> };
    expect(body.data.map((t) => t.ticker)).toEqual(["ALT"]);
  });

  it("skips the platform pin when filters exclude it", async () => {
    mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce([
      { tokenAddress: ADDR_B.toLowerCase(), volume24hUsd: 5_000 },
      {
        tokenAddress: PLATFORM_TOKEN_ADDRESS.toLowerCase(),
        volume24hUsd: 10,
      },
    ]);
    // Mock stands in for SQL: the `underlying=BTC` clause would drop ALT
    // (HYPE) from the hydrate set, so it must not be pinned or listed.
    currentDbRows.rows = [
      makeDbRow(ADDR_B, { ticker: "BBB", underlying: "BTC" }),
    ];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_B, onchain: makeOnchain(ADDR_B), market: makeMarket() },
      ]),
    );

    const res = await createApp().request(
      "/tokens?sort=trending&underlying=BTC",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ ticker: string }> };
    expect(body.data.map((t) => t.ticker)).toEqual(["BBB"]);
  });

  it("does not repeat the platform token on later trending pages", async () => {
    mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce([
      { tokenAddress: ADDR_B.toLowerCase(), volume24hUsd: 5_000 },
      { tokenAddress: ADDR_A.toLowerCase(), volume24hUsd: 1_000 },
      {
        tokenAddress: PLATFORM_TOKEN_ADDRESS.toLowerCase(),
        volume24hUsd: 10,
      },
    ]);
    currentDbRows.rows = [
      makeDbRow(ADDR_B, { ticker: "BBB" }),
      makeDbRow(ADDR_A, { ticker: "AAA" }),
      makeDbRow(PLATFORM_TOKEN_ADDRESS, { ticker: "ALT" }),
    ];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_A, onchain: makeOnchain(ADDR_A), market: makeMarket() },
      ]),
    );

    const res = await createApp().request(
      "/tokens?sort=trending&limit=1&offset=2",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ ticker: string }> };
    expect(body.data.map((t) => t.ticker)).toEqual(["AAA"]);
  });

  it("only enriches the paginated slice, not the full candidate pool", async () => {
    // Perf invariant: cold-cache trending was 20s because we used to
    // hydrate + enrich all `TRENDING_POOL_SIZE` candidates and only
    // sliced after market-data. The fix slices the candidate pool to
    // `[offset, offset+limit]` *before* `computeMarketDataForAddresses`,
    // so the BounceTech LATERAL scans only see page-size work.
    //
    // Five candidates ordered by volume desc; default page size on this
    // request is `limit=2, offset=1` → only ADDR_B (middle of the page)
    // and ADDR_C should be passed to enrichment.
    const ADDR_D = "0x4444444444444444444444444444444444444444";
    const ADDR_E = "0x5555555555555555555555555555555555555555";
    mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce([
      { tokenAddress: ADDR_A.toLowerCase(), volume24hUsd: 5_000 },
      { tokenAddress: ADDR_B.toLowerCase(), volume24hUsd: 4_000 },
      { tokenAddress: ADDR_C.toLowerCase(), volume24hUsd: 3_000 },
      { tokenAddress: ADDR_D.toLowerCase(), volume24hUsd: 2_000 },
      { tokenAddress: ADDR_E.toLowerCase(), volume24hUsd: 1_000 },
    ]);
    currentDbRows.rows = [
      makeDbRow(ADDR_A, { ticker: "AAA" }),
      makeDbRow(ADDR_B, { ticker: "BBB" }),
      makeDbRow(ADDR_C, { ticker: "CCC" }),
      makeDbRow(ADDR_D, { ticker: "DDD" }),
      makeDbRow(ADDR_E, { ticker: "EEE" }),
    ];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([
        {
          address: ADDR_B,
          onchain: makeOnchain(ADDR_B),
          market: makeMarket(),
        },
        {
          address: ADDR_C,
          onchain: makeOnchain(ADDR_C),
          market: makeMarket(),
        },
      ]),
    );

    const res = await createApp().request(
      "/tokens?sort=trending&limit=2&offset=1",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);

    // The route MUST hand only the page-size slice to enrichment.
    expect(mockComputeMarketDataForAddresses).toHaveBeenCalledTimes(1);
    const enrichArgs = mockComputeMarketDataForAddresses.mock.calls[0];
    const enrichAddresses = (enrichArgs?.[2] as string[]).map((a) =>
      a.toLowerCase(),
    );
    expect(enrichAddresses).toEqual([
      ADDR_B.toLowerCase(),
      ADDR_C.toLowerCase(),
    ]);

    const body = (await res.json()) as {
      data: Array<{ ticker: string }>;
    };
    expect(body.data.map((t) => t.ticker)).toEqual(["BBB", "CCC"]);
  });

  it("paginates the degraded fallback so it can't leak an oversized page", async () => {
    // CodeRabbit on PR #995: the in-memory volumeFor re-sort runs even
    // on the degraded path (where `volumeFor` falls back to the row's
    // own `volume24hUsd`). Without SQL-level pagination the fallback
    // would return up to TRENDING_POOL_SIZE rows. Assert the
    // pre-enrichment slice still applies when the indexer is down.
    mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce(null);
    // DB mock ignores LIMIT/OFFSET — assert via the addresses passed to
    // enrichment instead. The route must hand the page-size slice to
    // `computeMarketDataForAddresses`, not the whole pool.
    currentDbRows.rows = [
      makeDbRow(ADDR_B, { ticker: "BBB" }),
      makeDbRow(ADDR_C, { ticker: "CCC" }),
    ];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([
        {
          address: ADDR_B,
          onchain: makeOnchain(ADDR_B),
          market: makeMarket(),
        },
        {
          address: ADDR_C,
          onchain: makeOnchain(ADDR_C),
          market: makeMarket(),
        },
      ]),
    );

    const res = await createApp().request(
      "/tokens?sort=trending&limit=2&offset=1",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);

    expect(mockComputeMarketDataForAddresses).toHaveBeenCalledTimes(1);
    const enrichArgs = mockComputeMarketDataForAddresses.mock.calls[0];
    const enrichAddresses = (enrichArgs?.[2] as string[]).map((a) =>
      a.toLowerCase(),
    );
    expect(enrichAddresses).toEqual([
      ADDR_B.toLowerCase(),
      ADDR_C.toLowerCase(),
    ]);

    const body = (await res.json()) as {
      dataSource: string;
      data: Array<{ ticker: string }>;
    };
    expect(body.dataSource).toBe("degraded");
    expect(body.data.map((t) => t.ticker)).toEqual(["BBB", "CCC"]);
  });

  it("preserves dataSource=degraded on an empty fallback page when the indexer is down", async () => {
    // Indexer returns null → fallback to createdAt-DESC slice → DB
    // happens to return zero rows (everything hidden/excluded). The
    // short-circuit empty-response branch must still tag the response
    // as degraded so the edge cache doesn't pin the wrong status for a
    // full `LIST_CACHE_TTL_SECONDS` window.
    mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce(null);
    currentDbRows.rows = [];

    const res = await createApp().request(
      "/tokens?sort=trending",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dataSource: string; data: unknown[] };
    expect(body.data).toEqual([]);
    expect(body.dataSource).toBe("degraded");
  });
});

/**
 * Coverage for the alternate scored sorts (mcap / change24h) on the
 * TRENDING tab. Both re-rank the same candidate pool the trending sort
 * uses (top‑N by 24h gross USDC volume from the indexer) — the
 * dropdown picks a different ordering key but never widens the cohort.
 * Tests in this block assert (a) the candidate pool is still
 * volume-driven (anti-spam property preserved) and (b) the final
 * response is ordered by the requested key with the documented
 * tie-break + null-handling rules.
 */
describe("GET /tokens?sort=mcap|change24h — alternate scored sorts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Candidate-pool stub shared by every test below: the indexer's
  // 24h-volume ranking returns A, B, C in that order. Each test mutates
  // the market data + DB rows to set up the scenario it wants to assert.
  function stubCandidatePool() {
    mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce([
      { tokenAddress: ADDR_A.toLowerCase(), volume24hUsd: 5_000 },
      { tokenAddress: ADDR_B.toLowerCase(), volume24hUsd: 1_000 },
      { tokenAddress: ADDR_C.toLowerCase(), volume24hUsd: 100 },
    ]);
  }

  it("sort=mcap reorders the trending pool by mcap desc (with 24h volume tie-break)", async () => {
    stubCandidatePool();
    const onchainA = makeOnchain(ADDR_A);
    const onchainB = makeOnchain(ADDR_B);
    const onchainC = makeOnchain(ADDR_C);
    currentDbRows.rows = [
      makeDbRow(ADDR_A, { ticker: "AAA" }),
      makeDbRow(ADDR_B, { ticker: "BBB" }),
      makeDbRow(ADDR_C, { ticker: "CCC" }),
    ];
    // B has the largest mcap → must come first; C is mid; A is smallest.
    // The volume-driven candidate order (A → B → C) must be overridden.
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([
        {
          address: ADDR_A,
          onchain: onchainA,
          market: makeMarket({ mcapUsd: 1_000 }),
        },
        {
          address: ADDR_B,
          onchain: onchainB,
          market: makeMarket({ mcapUsd: 10_000_000 }),
        },
        {
          address: ADDR_C,
          onchain: onchainC,
          market: makeMarket({ mcapUsd: 50_000 }),
        },
      ]),
    );

    const res = await createApp().request("/tokens?sort=mcap", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ ticker: string }> };
    expect(body.data.map((t) => t.ticker)).toEqual(["BBB", "CCC", "AAA"]);
  });

  it("sort=mcap breaks ties on 24h volume desc so equal-mcap rows surface the more-active one first", async () => {
    stubCandidatePool();
    const onchainA = makeOnchain(ADDR_A);
    const onchainB = makeOnchain(ADDR_B);
    currentDbRows.rows = [
      makeDbRow(ADDR_A, { ticker: "HIGH_VOL" }),
      makeDbRow(ADDR_B, { ticker: "LOW_VOL" }),
    ];
    // Both tokens have identical mcap. A has 24h volume 5000, B has 1000
    // (from the candidate pool stub) → A must come first.
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([
        {
          address: ADDR_A,
          onchain: onchainA,
          market: makeMarket({ mcapUsd: 1_000_000 }),
        },
        {
          address: ADDR_B,
          onchain: onchainB,
          market: makeMarket({ mcapUsd: 1_000_000 }),
        },
      ]),
    );

    const res = await createApp().request("/tokens?sort=mcap", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ ticker: string }> };
    expect(body.data.map((t) => t.ticker)).toEqual(["HIGH_VOL", "LOW_VOL"]);
  });

  it("sort=change24h reorders by 24h pct change desc, with nulls sinking to the bottom", async () => {
    stubCandidatePool();
    const onchainA = makeOnchain(ADDR_A);
    const onchainB = makeOnchain(ADDR_B);
    const onchainC = makeOnchain(ADDR_C);
    currentDbRows.rows = [
      makeDbRow(ADDR_A, { ticker: "DEGRADED" }),
      makeDbRow(ADDR_B, { ticker: "PUMP" }),
      makeDbRow(ADDR_C, { ticker: "DUMP" }),
    ];
    // B is a +50% gainer, C is a -30% loser, A's change24h is unknown
    // (degraded indexer / BounceTech). Order must be PUMP → DUMP →
    // DEGRADED — `null` falls to the bottom even though `null > -30%`
    // numerically would otherwise put it ahead of the dumping row.
    // That's the documented "?? 0 would surface unknowns in the
    // middle of the list" guard.
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([
        {
          address: ADDR_A,
          onchain: onchainA,
          market: makeMarket({ change24h: null }),
        },
        {
          address: ADDR_B,
          onchain: onchainB,
          market: makeMarket({ change24h: 50 }),
        },
        {
          address: ADDR_C,
          onchain: onchainC,
          market: makeMarket({ change24h: -30 }),
        },
      ]),
    );

    const res = await createApp().request(
      "/tokens?sort=change24h",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ ticker: string }> };
    expect(body.data.map((t) => t.ticker)).toEqual([
      "PUMP",
      "DUMP",
      "DEGRADED",
    ]);
  });

  it("sort=change24h is stable when every row has null change24h (no NaN crash on the comparator)", async () => {
    // Two rows with `change24h: null` would produce `NaN` from a naive
    // `-Infinity − -Infinity` sentinel; the comparator instead routes
    // both-null cases through the mcap tie-break. Higher mcap wins —
    // and crucially the sort doesn't throw / return non-deterministic
    // order.
    stubCandidatePool();
    const onchainA = makeOnchain(ADDR_A);
    const onchainB = makeOnchain(ADDR_B);
    currentDbRows.rows = [
      makeDbRow(ADDR_A, { ticker: "SMALL_DEGRADED" }),
      makeDbRow(ADDR_B, { ticker: "BIG_DEGRADED" }),
    ];
    mockComputeMarketDataForAddresses.mockResolvedValueOnce(
      marketBatchOk([
        {
          address: ADDR_A,
          onchain: onchainA,
          market: makeMarket({ change24h: null, mcapUsd: 1_000 }),
        },
        {
          address: ADDR_B,
          onchain: onchainB,
          market: makeMarket({ change24h: null, mcapUsd: 10_000_000 }),
        },
      ]),
    );

    const res = await createApp().request(
      "/tokens?sort=change24h",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ ticker: string }> };
    expect(body.data.map((t) => t.ticker)).toEqual([
      "BIG_DEGRADED",
      "SMALL_DEGRADED",
    ]);
  });

  it("uses the trending candidate pool for every scored sort (anti-spam preserved)", async () => {
    // Critical anti-spam property: a token that hasn't traded in the
    // last 24h has NO row in `token_hourly_metrics` and therefore is
    // not in the candidate pool. Even if a high-mcap dead token exists
    // in Postgres, it should NEVER surface on `sort=mcap` (because the
    // pool doesn't contain it). We assert this indirectly by checking
    // that `fetchTrendingCandidatesByVolume` is the gating call for
    // every scored-sort variant.
    for (const s of ["mcap", "change24h", "volume24h"] as const) {
      mockFetchTrendingCandidatesByVolume.mockResolvedValueOnce([]);
      await createApp().request(`/tokens?sort=${s}`, {}, makeEnv());
    }
    expect(mockFetchTrendingCandidatesByVolume).toHaveBeenCalledTimes(3);
  });
});

/**
 * Coverage for the alternate scored sorts on `status=graduated`. The
 * tab's default ordering is `graduatedAt desc` from the indexer
 * (unchanged), but the frontend lets the user pick mcap / change24h
 * to re-rank the graduated cohort. The route must enrich
 * the full filtered pool before sorting (so the visible page reflects
 * the true global ordering across the pool, not just the cheap default
 * paginate-first path).
 */
describe("GET /tokens?status=graduated with scored sort overrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("default (no sort param) preserves Ponder's graduatedAt-desc ordering and only fetches market data for the paged slice", async () => {
    // Regression guard for the cheap path: when no scored sort is in
    // play, we should keep paginating first (against `orderedDbRows`)
    // and only fetch BounceTech market data for the slice we actually
    // return. Three onchain rows but only one DB row → page size of 1
    // with no offset/limit query means we still only enrich the
    // visible page.
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
    currentDbRows.rows = [
      makeDbRow(ADDR_A, { ticker: "AAA" }),
      makeDbRow(ADDR_B, { ticker: "BBB" }),
      makeDbRow(ADDR_C, { ticker: "CCC" }),
    ];
    mockBuildBatchFromTokens.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_A, onchain: onchainA, market: makeMarket() },
        { address: ADDR_B, onchain: onchainB, market: makeMarket() },
        { address: ADDR_C, onchain: onchainC, market: makeMarket() },
      ]),
    );

    const res = await createApp().request(
      "/tokens?status=graduated&limit=2",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ ticker: string }> };
    expect(body.data.map((t) => t.ticker)).toEqual(["AAA", "BBB"]);
    // Only the 2 paged rows should have been sent to BounceTech (the
    // cheap path's whole reason for existing).
    expect(mockBuildBatchFromTokens).toHaveBeenCalledTimes(1);
    const passedOnchain = mockBuildBatchFromTokens.mock
      .calls[0][2] as PonderTokenOnchain[];
    expect(passedOnchain).toHaveLength(2);
  });

  it("sort=mcap re-ranks the graduated cohort by mcap desc (enriches the full pool before paginating)", async () => {
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
    // Indexer returns A, B, C in `graduatedAt desc` order. The scored
    // sort must override that with mcap desc → B (biggest) → A → C.
    mockFetchGraduatedTokensOnchain.mockResolvedValueOnce([
      onchainA,
      onchainB,
      onchainC,
    ]);
    currentDbRows.rows = [
      makeDbRow(ADDR_A, { ticker: "MID_MCAP" }),
      makeDbRow(ADDR_B, { ticker: "BIG_MCAP" }),
      makeDbRow(ADDR_C, { ticker: "SMALL_MCAP" }),
    ];
    mockBuildBatchFromTokens.mockResolvedValueOnce(
      marketBatchOk([
        {
          address: ADDR_A,
          onchain: onchainA,
          market: makeMarket({ mcapUsd: 1_000_000 }),
        },
        {
          address: ADDR_B,
          onchain: onchainB,
          market: makeMarket({ mcapUsd: 100_000_000 }),
        },
        {
          address: ADDR_C,
          onchain: onchainC,
          market: makeMarket({ mcapUsd: 1_000 }),
        },
      ]),
    );

    const res = await createApp().request(
      "/tokens?status=graduated&sort=mcap",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ ticker: string }> };
    expect(body.data.map((t) => t.ticker)).toEqual([
      "BIG_MCAP",
      "MID_MCAP",
      "SMALL_MCAP",
    ]);
    // The scored-sort path enriches the WHOLE filtered pool (3 rows),
    // not just the paginated slice. That's the trade we pay for honest
    // ordering across the page boundary.
    const passedOnchain = mockBuildBatchFromTokens.mock
      .calls[0][2] as PonderTokenOnchain[];
    expect(passedOnchain).toHaveLength(3);
  });

  it("sort=change24h on graduated routes null change values to the bottom", async () => {
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
    currentDbRows.rows = [
      makeDbRow(ADDR_A, { ticker: "DEGRADED" }),
      makeDbRow(ADDR_B, { ticker: "PUMP" }),
      makeDbRow(ADDR_C, { ticker: "DUMP" }),
    ];
    mockBuildBatchFromTokens.mockResolvedValueOnce(
      marketBatchOk([
        {
          address: ADDR_A,
          onchain: onchainA,
          market: makeMarket({ change24h: null }),
        },
        {
          address: ADDR_B,
          onchain: onchainB,
          market: makeMarket({ change24h: 25 }),
        },
        {
          address: ADDR_C,
          onchain: onchainC,
          market: makeMarket({ change24h: -10 }),
        },
      ]),
    );

    const res = await createApp().request(
      "/tokens?status=graduated&sort=change24h",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ ticker: string }> };
    expect(body.data.map((t) => t.ticker)).toEqual([
      "PUMP",
      "DUMP",
      "DEGRADED",
    ]);
  });
});
