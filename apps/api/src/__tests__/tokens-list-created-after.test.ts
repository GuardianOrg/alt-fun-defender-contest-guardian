/**
 * Coverage for the `?createdAfter=<ISO>` filter on `GET /tokens`. The
 * filter pushes a strict `created_at > $1` clause into the SQL on the
 * DB-first path and short-circuits the row loop on the Ponder-first
 * (status=graduated|graduating) path so semantics are identical across
 * branches.
 *
 * Cursor-style backfill consumers (e.g. the Telegram launch bot
 * recovering from a multi-hour outage that spanned > MAX_PAGE_SIZE
 * launches) can pass the most-recently-processed `createdAt` here to
 * receive everything newer without re-receiving the boundary row.
 */

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppBindings } from "../lib/types.js";
import type {
  MarketDataBatchResult,
  MarketDataItem,
  PonderTokenOnchain,
} from "../lib/market-data.js";

// ── Drizzle chain mock — capture every gt() call so we can assert the
// `created_at > $1` predicate landed in the WHERE clause. The actual
// SQL fragment is opaque, so we record the raw `value` (the Date) and
// match on it from the assertion side. ──
const gtCalls: { value: unknown }[] = [];

vi.mock("drizzle-orm", async () => {
  const actual =
    await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    gt: vi.fn((column: unknown, value: unknown) => {
      gtCalls.push({ value });
      return actual.gt(
        column as Parameters<typeof actual.gt>[0],
        value as Parameters<typeof actual.gt>[1],
      );
    }),
  };
});

// Fail-open live-LT availability so the test isn't entangled with the
// issue #621 SQL filter. The "fresh: false" snapshot triggers the same
// fail-open path the production route takes when BounceTech is down.
vi.mock("../lib/lt-availability.js", () => ({
  getLiveLtAvailability: vi.fn(async () => ({
    liveAddresses: new Set<string>(),
    liveSymbols: new Set<string>(),
    liveUnderlyings: new Set<string>(),
    directoryAddresses: new Set<string>(),
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

vi.mock("../lib/protocol-config.js", () => ({
  getGraduationThresholdUsd: vi.fn(async () => 12_000),
  _resetGraduationThresholdCache: vi.fn(),
}));

const mockFetchGraduatedTokensOnchain = vi.fn();
const mockFetchGraduatingTokensOnchain = vi.fn();
const mockFetchTrendingCandidatesByVolume = vi.fn();
const mockComputeMarketDataForAddresses = vi.fn();
const mockBuildBatchFromTokens = vi.fn();

vi.mock("../lib/market-data.js", () => ({
  fetchGraduatedTokensOnchain: mockFetchGraduatedTokensOnchain,
  fetchGraduatingTokensOnchain: mockFetchGraduatingTokensOnchain,
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

const LT_ADDR = "0xb88339CB7199b77E23DB6E890353E22632Ba630f";
const CREATOR = "0x1111111111111111111111111111111111111111";
const ADDR_A = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const ADDR_B = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
const ADDR_C = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";

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
  vi.stubGlobal("caches", undefined);
  gtCalls.length = 0;
  currentDbRows.rows = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /tokens — ?createdAfter validation", () => {
  it("returns 400 when the value is not an ISO timestamp shape", async () => {
    const res = await createApp().request(
      "/tokens?createdAfter=tomorrow",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("createdAfter");
  });

  it("returns 400 when the value parses as Invalid Date", async () => {
    // The shape regex passes (`YYYY-MM-DD` prefix) but the Date
    // constructor still rejects it because month 99 is impossible. The
    // `Number.isNaN(getTime())` guard must catch this.
    const res = await createApp().request(
      "/tokens?createdAfter=2024-99-99T00:00:00Z",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on an empty `?createdAfter=` value", async () => {
    const res = await createApp().request(
      "/tokens?createdAfter=",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("accepts a well-formed ISO-8601 timestamp", async () => {
    mockComputeMarketDataForAddresses.mockResolvedValueOnce({
      ok: true,
      data: { tokens: [], market: {} },
    });

    const res = await createApp().request(
      "/tokens?createdAfter=2024-01-15T10:30:00.000Z",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
  });

  it("treats the param as optional — no filter is applied when absent", async () => {
    mockComputeMarketDataForAddresses.mockResolvedValueOnce({
      ok: true,
      data: { tokens: [], market: {} },
    });

    const res = await createApp().request("/tokens", {}, makeEnv());
    expect(res.status).toBe(200);
    expect(gtCalls).toHaveLength(0);
  });
});

describe("GET /tokens — ?createdAfter on the DB-first path", () => {
  it("pushes a `created_at > $1` clause carrying the parsed Date into SQL", async () => {
    mockComputeMarketDataForAddresses.mockResolvedValueOnce({
      ok: true,
      data: { tokens: [], market: {} },
    });

    const cursor = "2024-03-01T12:00:00.000Z";
    await createApp().request(
      `/tokens?createdAfter=${encodeURIComponent(cursor)}`,
      {},
      makeEnv(),
    );

    const call = gtCalls[0];
    expect(call).toBeDefined();
    expect(call?.value).toBeInstanceOf(Date);
    expect((call?.value as Date).toISOString()).toBe(cursor);
  });

  it("composes with the trending sort (still cursor-bounded)", async () => {
    // Trending uses the same `conditions` array — the cursor must be
    // pushed to Postgres so the 500-token pool is also bounded by it.
    mockComputeMarketDataForAddresses.mockResolvedValueOnce({
      ok: true,
      data: { tokens: [], market: {} },
    });

    await createApp().request(
      "/tokens?sort=trending&createdAfter=2024-03-01T12:00:00.000Z",
      {},
      makeEnv(),
    );

    expect(gtCalls).toHaveLength(1);
  });
});

describe("GET /tokens — ?createdAfter on the Ponder-first path", () => {
  it("drops graduated rows whose `createdAt` is at or before the cursor", async () => {
    // Ponder reports both rows as graduated. The DB has both. Only the
    // row with `createdAt` strictly after the cursor should land in the
    // response — boundary inclusivity matters: a consumer asking for
    // `createdAfter=<last seen>` must not re-receive the boundary token.
    const cursor = new Date("2024-06-01T00:00:00.000Z");
    const onchainOld = makeOnchain(ADDR_A, {
      graduated: true,
      graduatedAt: "1700003000",
    });
    const onchainNew = makeOnchain(ADDR_B, {
      graduated: true,
      graduatedAt: "1700002000",
    });
    mockFetchGraduatedTokensOnchain.mockResolvedValueOnce([
      onchainOld,
      onchainNew,
    ]);
    currentDbRows.rows = [
      makeDbRow(ADDR_A, {
        ticker: "OLD",
        createdAt: new Date("2024-05-01T00:00:00Z"),
      }),
      makeDbRow(ADDR_B, {
        ticker: "NEW",
        createdAt: new Date("2024-07-01T00:00:00Z"),
      }),
    ];
    mockBuildBatchFromTokens.mockResolvedValueOnce(
      marketBatchOk([
        { address: ADDR_B, onchain: onchainNew, market: makeMarket() },
      ]),
    );

    const res = await createApp().request(
      `/tokens?status=graduated&createdAfter=${encodeURIComponent(cursor.toISOString())}`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ ticker: string }> };
    expect(body.data.map((t) => t.ticker)).toEqual(["NEW"]);
  });

  it("treats boundary equality as exclusive (strict >)", async () => {
    // A consumer that uses the response's own `createdAt` as the next
    // cursor must not see the same row twice. The cursor and the row's
    // `createdAt` are intentionally identical.
    const cursorIso = "2024-06-01T00:00:00.000Z";
    const onchain = makeOnchain(ADDR_A, {
      graduated: true,
      graduatedAt: "1700003000",
    });
    mockFetchGraduatedTokensOnchain.mockResolvedValueOnce([onchain]);
    currentDbRows.rows = [
      makeDbRow(ADDR_A, { createdAt: new Date(cursorIso) }),
    ];
    mockBuildBatchFromTokens.mockResolvedValueOnce(marketBatchOk([]));

    const res = await createApp().request(
      `/tokens?status=graduated&createdAfter=${encodeURIComponent(cursorIso)}`,
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<unknown> };
    expect(body.data).toEqual([]);
  });

  it("does not call gt() on the Ponder-first path — filtering is in-memory there", async () => {
    // The DB query for hydrating graduated/graduating pages doesn't
    // accept `createdAt > $1` (it's an `IN (...)` lookup driven by
    // Ponder's address list). Cursor enforcement happens in the
    // re-ordering loop instead. Document the boundary so a future
    // refactor doesn't accidentally push a `gt` clause into the wrong
    // branch (where it would silently truncate the page beyond the
    // intent of `createdAfter`).
    const onchain = makeOnchain(ADDR_C, {
      graduated: true,
      graduatedAt: "1700003000",
    });
    mockFetchGraduatedTokensOnchain.mockResolvedValueOnce([onchain]);
    currentDbRows.rows = [
      makeDbRow(ADDR_C, { createdAt: new Date("2024-07-01T00:00:00Z") }),
    ];
    mockBuildBatchFromTokens.mockResolvedValueOnce(
      marketBatchOk([{ address: ADDR_C, onchain, market: makeMarket() }]),
    );

    const res = await createApp().request(
      "/tokens?status=graduated&createdAfter=2024-06-01T00:00:00.000Z",
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(gtCalls).toHaveLength(0);
  });
});
