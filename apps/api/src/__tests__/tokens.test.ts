import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types.js";

// --- DB mock ---
const mockDbReturning = vi.fn();
const mockDbOnConflictDoNothing = vi.fn().mockReturnValue({ returning: mockDbReturning });
const mockInsertValues = vi.fn().mockReturnValue({ onConflictDoNothing: mockDbOnConflictDoNothing });
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
const mockSelectWhere = vi.fn();
const mockSelectOrderBy = vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([]) }) });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere, orderBy: mockSelectOrderBy });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });
const mockDb = {
  select: mockSelect,
  insert: mockInsert,
};

vi.mock("../db/client.js", () => ({
  createDb: () => mockDb,
}));

// --- Indexer-reads mock (replaces the legacy Ponder GraphQL mocks) ---
//
// The detail tests below were originally written against `createPonderQuery`
// / `createPonderPaginatedQuery`, which the route used to call once for the
// `token(address)` lookup and again for the aliased `tokenSnapshots(...)`
// historical-curve fetch. After the GraphQL → direct-SQL migration those
// two paths land on `fetchTokenOnchain` / `fetchHistoricalCurveSnapshots` /
// `fetchRouterTradeActivity` instead.
//
// `mockPonderQuery` is kept as the underlying queue-of-values so the existing
// `mockResolvedValueOnce(...)` setups in each test continue to work without
// being rewritten. The adapters below translate the legacy GraphQL shapes
// (`{ token: ... }` and `{ t0: { items: [] } }`) into the indexer-reads
// return contract; the third upstream the route fires now
// (`fetchRouterTradeActivity`) returns an empty activity map by default
// since none of these tests exercise the 24h-volume path.
const mockPonderQuery = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchTokenOnchain: async () => {
    const result = await mockPonderQuery();
    if (result === null) return "unavailable";
    return result?.token ?? null;
  },
  fetchHistoricalCurveSnapshots: async (_db: unknown, addrs: string[]) => {
    const result = await mockPonderQuery();
    if (result === null) return null;
    const map = new Map<string, unknown>();
    for (const a of addrs) map.set(a.toLowerCase(), null);
    return map;
  },
  fetchRouterTradeActivity: async () => new Map(),
  fetchTokensOnchainByAddresses: async () => [],
  fetchGraduatedTokensOnchain: async () => [],
  fetchNonGraduatedTokensOnchain: async () => [],
  fetchTrendingCandidatesByVolume: async () => [],
  // Pure helper — keep the real implementation so `market-data.ts`'s
  // cutoff math behaves exactly as in prod under this test.
  quantizeTrailing24hCutoffSec: (nowSec: number) =>
    Math.floor((nowSec - 86_400) / 30) * 30,
}));

// --- BounceTech DB mock ---
const mockNeonQuery = vi.fn();
vi.mock("@neondatabase/serverless", () => ({
  neon: () => mockNeonQuery,
}));

// --- Global fetch mock (BounceTech LT directory + live LT API) ---
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
vi.stubGlobal("caches", undefined);

// --- Broadcast mock ---
vi.mock("../lib/broadcast.js", () => ({
  broadcastToChannel: vi.fn().mockResolvedValue(undefined),
}));

// --- Viem mock ---
//
// `registerTokenFromChain` calls `client.readContract({ ..., functionName: "getTokenInfo" })`
// and then validates the result. Mocking at the viem boundary keeps the
// helper's image / LT / DB interactions exercised by these tests without
// hitting the network.
const mockReadContract = vi.fn();
vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: () => ({ readContract: mockReadContract }),
  };
});

// Pin the graduation threshold to a fixed test value so the curve-fill
// percentage assertions below stay valid as the production default
// (`DEFAULT_GRADUATION_THRESHOLD_USD` in `@launchpad/shared`) is retuned.
// The fixture math throughout this file is sized for $12K — we don't want
// these unit tests to keep migrating each time the dial moves on-chain.
// `protocol-config.getGraduationThresholdUsd` is route-level concern, so
// mocking it at the module boundary is the cleanest way to isolate the
// curve math from external config drift.
vi.mock("../lib/protocol-config.js", () => ({
  getGraduationThresholdUsd: vi.fn(async () => 12_000),
  _resetGraduationThresholdCache: vi.fn(),
}));

// Stub the live-LT availability lookup. These tests focus on token
// registration / detail behaviour; the LT-availability filter
// (issue #621) is exercised independently in `lt-availability.test.ts`
// and `assets.test.ts`. Returning an empty, non-fresh snapshot causes
// the listing path to fail-open (no filter applied), matching the
// pre-#621 behaviour these tests assume.
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

// Stub the LT-directory mirror reader. The route handlers now read
// through `lt-directory-reads`:
//   - `registerTokenFromChain` → `readLtByAddress`
//   - `market-data` (the detail-page enrichment fan-out) →
//     `readLiveLtRates` via `fetchLiveLtRates`
// Each test seeds the relevant mock — `mockBounceTechLtList(...)` for
// the registration path, `mockBounceLtResponse({ ... })` for the
// detail-page LT rate. The legacy `fetch` mock survives only for the
// bouncetech historical-rates path that still goes through HTTP.
const mockReadLtByAddress = vi.fn();
const mockReadLiveLtRates = vi.fn();
vi.mock("../lib/lt-directory-reads.js", () => ({
  readLtByAddress: mockReadLtByAddress,
  readLtDirectory: vi.fn(),
  readSupportedLtDirectory: vi.fn(),
  readLiveLtRates: mockReadLiveLtRates,
  readDirectoryLastUpdatedAt: vi.fn(),
}));

// Import route after mocks
const { default: tokensRoute } = await import("../routes/tokens/index.js");
const { _resetLiveLtRatesCache } = await import("../lib/market-data.js");

function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/tokens", tokensRoute);
  return app;
}

const VALID_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const VALID_CREATOR = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
const LT_ADDR = "0xb88339CB7199b77E23DB6E890353E22632Ba630f";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

interface BucketHeadResult {
  size: number;
}

interface MockBucket {
  head: ReturnType<typeof vi.fn>;
}

function makeBucket(headResult: BucketHeadResult | null = { size: 1024 }): MockBucket {
  return {
    head: vi.fn().mockResolvedValue(headResult),
  };
}

function makeEnv(bucket: MockBucket = makeBucket()): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "postgres://bouncetech",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "http://localhost:42069",
    IMAGES_BUCKET: bucket as unknown as R2Bucket,
    WEBSOCKET_DO: {
      idFromName: () => "id",
      get: () => ({ fetch: vi.fn().mockResolvedValue(new Response("ok")) }),
    } as unknown as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

interface OnChainInfoOverrides {
  creator?: string;
  ltAddress?: string;
  name?: string;
  ticker?: string;
  description?: string;
  image?: string;
  urls?: [string, string, string];
}

function makeOnChainInfo(overrides: OnChainInfoOverrides = {}) {
  return {
    creator: overrides.creator ?? VALID_CREATOR,
    pair: "0xpair000000000000000000000000000000000000",
    ltAddress: overrides.ltAddress ?? LT_ADDR,
    name: overrides.name ?? "Test Token",
    ticker: overrides.ticker ?? "TST",
    description: overrides.description ?? "",
    image: overrides.image ?? "",
    urls: overrides.urls ?? (["", "", ""] as [string, string, string]),
    lifecycle: 0,
  };
}

// Seed the `readLtByAddress` mock with the row that `resolveLtMeta`
// expects to find for `LT_ADDR`. The legacy name (`mockBounceTechLtList`)
// is preserved so the per-test setup at each call site keeps reading
// naturally — what changed is the data source (DB mirror, not HTTP).
function mockBounceTechLtList(entries: Array<{
  address: string;
  isLong?: boolean;
  targetLeverage?: number;
  targetAsset?: string;
}> = []) {
  const data = entries.length
    ? entries
    : [
        {
          address: LT_ADDR,
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
        },
      ];
  const merged = data.map((d) => ({
    address: d.address,
    symbol: "HYPE2L",
    name: "HYPE 2x Long",
    targetAsset: d.targetAsset ?? "HYPE",
    targetLeverage: d.targetLeverage ?? 2,
    isLong: d.isLong ?? true,
    decimals: 18,
    mintPaused: false,
    exchangeRate: "1000000000000000000",
    totalSupply: "0",
    totalAssets: "0",
  }));
  mockReadLtByAddress.mockImplementationOnce(
    async (_databaseUrl: string, ltAddress: string) => {
      const target = ltAddress.toLowerCase();
      return merged.find((d) => d.address.toLowerCase() === target) ?? null;
    },
  );
}

describe("POST /tokens — address-only registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Live LT-rate cache (`fetchLiveLtRates`, 5s TTL) still exists per
    // isolate — reset between cases so the first test to populate it
    // doesn't make later tests order-dependent.
    _resetLiveLtRatesCache();
    // Default: row doesn't exist yet, registration succeeds.
    mockSelectWhere.mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
  });

  it("returns 400 when JSON body is invalid", async () => {
    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not json",
      },
      makeEnv(),
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 when address is missing", async () => {
    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      makeEnv(),
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 when address is invalid", async () => {
    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: "not-an-address" }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Invalid address");
  });

  it("returns 404 when token has not been launched on-chain", async () => {
    // `getTokenInfo` returns a zero-filled struct for an unregistered token.
    mockReadContract.mockResolvedValueOnce(makeOnChainInfo({
      creator: ZERO_ADDRESS,
    }));

    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: VALID_ADDRESS }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(404);
  });

  it("returns 422 when image URL is from a foreign domain", async () => {
    mockReadContract.mockResolvedValueOnce(
      makeOnChainInfo({ image: "https://evil.example.com/csam.jpg" }),
    );

    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: VALID_ADDRESS }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Alt Fun image bucket");
  });

  it("returns 422 when image URL points to a missing R2 object", async () => {
    mockReadContract.mockResolvedValueOnce(
      makeOnChainInfo({ image: "https://api.alt.fun/images/tokens/abc-def.png" }),
    );

    const bucket = makeBucket(null); // R2 HEAD returns null = key absent.
    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: VALID_ADDRESS }),
      },
      makeEnv(bucket),
    );

    expect(res.status).toBe(422);
    expect(bucket.head).toHaveBeenCalledWith("tokens/abc-def.png");
  });

  it("strips the host from the image URL regardless of what was stamped on-chain", async () => {
    // An attacker could stamp https://evil.example.com/images/tokens/<valid-key>
    // on-chain. The R2 HEAD check would pass (the key exists), but we must
    // not let the attacker's host reach the DB. We strip the origin entirely
    // and store the path-only URL so every API environment that serves the
    // same R2 bucket can render the image (issue #450).
    const VALID_KEY = "tokens/abc-123.png";
    mockReadContract.mockResolvedValueOnce(
      // Foreign host, but valid path and key:
      makeOnChainInfo({ image: `https://evil.example.com/images/${VALID_KEY}` }),
    );
    mockBounceTechLtList();
    const insertedRow = {
      address: VALID_ADDRESS,
      name: "Test Token",
      ticker: "TST",
      description: "",
      imageUrl: `/images/${VALID_KEY}`,
      ltPair: LT_ADDR,
      ltDirection: "long",
      leverage: 2,
      underlying: "HYPE",
      twitterUrl: "",
      telegramUrl: "",
      websiteUrl: "",
      creator: VALID_CREATOR,
    };
    mockDbReturning.mockResolvedValueOnce([insertedRow]);

    const app = createApp();
    const req = new Request("http://localhost/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: VALID_ADDRESS }),
    });
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;
    const res = await app.fetch(req, makeEnv(), executionCtx);

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { imageUrl: string } };
    // The stored imageUrl must be path-only, dropping the attacker's host.
    expect(body.data.imageUrl).toBe(`/images/${VALID_KEY}`);
    expect(body.data.imageUrl).not.toContain("evil.example.com");

    // Confirm the INSERT was called with the canonical (path-only) URL.
    const insertCall = mockInsertValues.mock.calls[0]?.[0] as { imageUrl?: string } | undefined;
    expect(insertCall?.imageUrl).toBe(`/images/${VALID_KEY}`);
  });

  it("accepts a path-relative image URL stamped on-chain (post-#450 uploads)", async () => {
    // The image upload endpoint now returns `/images/tokens/<key>` rather
    // than an absolute URL, so the legitimate creator stamps a relative
    // path into `LaunchParams.image`. Registration must accept it and
    // store the same path verbatim.
    const VALID_KEY = "tokens/relative-path.png";
    mockReadContract.mockResolvedValueOnce(
      makeOnChainInfo({ image: `/images/${VALID_KEY}` }),
    );
    mockBounceTechLtList();
    const bucket = makeBucket();
    mockDbReturning.mockResolvedValueOnce([{
      address: VALID_ADDRESS,
      name: "Test Token",
      ticker: "TST",
      description: "",
      imageUrl: `/images/${VALID_KEY}`,
      ltPair: LT_ADDR,
      ltDirection: "long",
      leverage: 2,
      underlying: "HYPE",
      twitterUrl: "",
      telegramUrl: "",
      websiteUrl: "",
      creator: VALID_CREATOR,
    }]);

    const app = createApp();
    const req = new Request("http://localhost/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: VALID_ADDRESS }),
    });
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;
    const res = await app.fetch(req, makeEnv(bucket), executionCtx);

    expect(res.status).toBe(201);
    // The R2-existence gate must run on the relative-path branch too —
    // otherwise an attacker could stamp `/images/tokens/<unknown-key>`
    // on-chain and slip past the moderation pipeline.
    expect(bucket.head).toHaveBeenCalledWith(VALID_KEY);
    const insertCall = mockInsertValues.mock.calls[0]?.[0] as { imageUrl?: string } | undefined;
    expect(insertCall?.imageUrl).toBe(`/images/${VALID_KEY}`);
  });

  it("returns 422 when LT address is unknown to BounceTech", async () => {
    mockReadContract.mockResolvedValueOnce(
      makeOnChainInfo({ ltAddress: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" }),
    );
    mockBounceTechLtList(); // default list only has LT_ADDR.

    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: VALID_ADDRESS }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(422);
  });

  it("returns 200 when the token is already registered (idempotent)", async () => {
    // Existing row: skip on-chain read entirely.
    const existingRow = {
      address: VALID_ADDRESS,
      name: "Existing",
      ticker: "EXST",
      ltPair: LT_ADDR,
      ltDirection: "long",
      leverage: 2,
      underlying: "HYPE",
      creator: VALID_CREATOR,
    };
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([existingRow]),
    });

    const app = createApp();
    const res = await app.request(
      "/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: VALID_ADDRESS }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(200);
    expect(mockReadContract).not.toHaveBeenCalled();
    const body = (await res.json()) as { data: { name: string } };
    expect(body.data.name).toBe("Existing");
  });

  it("returns 201 on a successful new registration", async () => {
    mockReadContract.mockResolvedValueOnce(
      makeOnChainInfo({
        name: "Fresh",
        ticker: "FRSH",
        description: "hello",
        urls: ["https://x.com/fresh", "", "https://fresh.example"],
      }),
    );
    mockBounceTechLtList();
    // Sanitised values (issue #400): twitter URL collapses to a bare
    // handle; website is canonicalised through `new URL().toString()`
    // which adds the trailing slash.
    mockDbReturning.mockResolvedValueOnce([{
      address: VALID_ADDRESS,
      name: "Fresh",
      ticker: "FRSH",
      description: "hello",
      imageUrl: "",
      ltPair: LT_ADDR,
      ltDirection: "long",
      leverage: 2,
      underlying: "HYPE",
      twitterUrl: "fresh",
      telegramUrl: "",
      websiteUrl: "https://fresh.example/",
      creator: VALID_CREATOR,
    }]);

    const app = createApp();
    const req = new Request("http://localhost/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: VALID_ADDRESS }),
    });
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;
    const res = await app.fetch(req, makeEnv(), executionCtx);

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { name: string; ticker: string; twitterUrl: string; websiteUrl: string } };
    expect(body.data.name).toBe("Fresh");
    expect(body.data.ticker).toBe("FRSH");
    // Confirm `params.urls[0,1,2]` mapping survives the round-trip and
    // that the stored values are sanitised (handle for X, canonical URL
    // for website).
    expect(body.data.twitterUrl).toBe("fresh");
    expect(body.data.websiteUrl).toBe("https://fresh.example/");
    const insertCallVals = mockInsertValues.mock.calls[0]?.[0] as { twitterUrl?: string; websiteUrl?: string } | undefined;
    expect(insertCallVals?.twitterUrl).toBe("fresh");
    expect(insertCallVals?.websiteUrl).toBe("https://fresh.example/");
    // `newToken` broadcast queued onto waitUntil so the response isn't
    // blocked on a slow Durable Object.
    expect(executionCtx.waitUntil).toHaveBeenCalled();
  });

  it("strips javascript: / phishing URLs from on-chain socials before storing (issue #400)", async () => {
    // The on-chain `urls` array is creator-controlled and length-capped
    // only — a malicious launch can stamp anything in there. The API is
    // the trust boundary for what reaches an `<a href>`, so unsafe values
    // must never make it into the DB.
    mockReadContract.mockResolvedValueOnce(
      makeOnChainInfo({
        urls: [
          // Twitter slot — non-http scheme: must be stripped.
          "javascript:alert(document.cookie)",
          // Telegram slot — phishing host that doesn't match the t.me /
          // telegram.me allowlist: must be stripped.
          "https://t.me.evil.tld/alice",
          // Website slot — non-http scheme: must be stripped. We *don't*
          // assert against a phishing host here because the website slot
          // legitimately accepts any http(s) URL — the creator's choice
          // of domain is up to them.
          "data:text/html,<script>alert(document.cookie)</script>",
        ],
      }),
    );
    mockBounceTechLtList();
    mockDbReturning.mockResolvedValueOnce([{
      address: VALID_ADDRESS,
      twitterUrl: "",
      telegramUrl: "",
      websiteUrl: "",
    }]);

    const app = createApp();
    const req = new Request("http://localhost/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: VALID_ADDRESS }),
    });
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;
    const res = await app.fetch(req, makeEnv(), executionCtx);

    expect(res.status).toBe(201);
    const insertCall = mockInsertValues.mock.calls[0]?.[0] as {
      twitterUrl?: string;
      telegramUrl?: string;
      websiteUrl?: string;
    } | undefined;
    expect(insertCall?.twitterUrl).toBe("");
    expect(insertCall?.telegramUrl).toBe("");
    expect(insertCall?.websiteUrl).toBe("");
  });

  it("classifies a Postgres failure on INSERT as db_error (generic public message, root PG detail in structured log, cause preserved)", async () => {
    // Regression for the BRENTOIL `underlying varchar(10)` overflow
    // (PR #433): the schema column was narrower than `xyz:BRENTOIL` (12
    // chars), so the INSERT raised `value too long for type character
    // varying(10)`. Drizzle wraps that in `DrizzleQueryError`, which is
    // not a `RegistrationError` — so the route returned a generic
    // "Internal Server Error" 500 and the cron logged it under
    // `code: "unknown"` instead of `db_error`. Four BRENTOIL tokens
    // silently 500'd for days before anyone correlated the symptoms.
    //
    // Public contract after the `withDbError` wrap (see api.mdc's
    // "Never expose internal error details to clients" rule):
    //   - The response body carries a stable, generic message — never
    //     the raw PG text. Client-side framing stays consistent and
    //     no DB internals leak to API consumers.
    //   - The operator-side detail (PG message + SQLSTATE) is emitted
    //     as a structured Worker log line, so Cloudflare logs /
    //     `wrangler tail` carry the diagnostic on every failure.
    //   - `RegistrationError.cause` references the raw error, so the
    //     cron backfill's `describeError` can still walk the chain
    //     and tag its `registration_backfill_skip` line with
    //     `code: "db_error"` instead of `code: "unknown"`.
    mockReadContract.mockResolvedValueOnce(makeOnChainInfo());
    mockBounceTechLtList();
    // Shape the rejection the way Drizzle actually does in production:
    // a `DrizzleQueryError` wrapper whose top-level message is
    // `"Failed query: <sql>"` and whose `cause` is the raw Postgres
    // error with the actually-useful message + SQLSTATE code.
    const pgRootError = Object.assign(
      new Error('value too long for type character varying(10)'),
      { code: "22001" },
    );
    const drizzleWrapper = new Error("Failed query: insert into \"tokens\"...", {
      cause: pgRootError,
    });
    mockDbReturning.mockRejectedValueOnce(drizzleWrapper);

    // Capture structured logs so we can assert the operator-side
    // signal carries the Postgres detail.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const app = createApp();
    const req = new Request("http://localhost/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: VALID_ADDRESS }),
    });
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;
    const res = await app.fetch(req, makeEnv(), executionCtx);

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    // 1. Public response is generic — no PG text, no SQL, no column
    //    shapes leak to clients.
    expect(body.error).toBe("Token registration failed");
    expect(body.error).not.toContain("value too long");
    expect(body.error).not.toContain("character varying");
    expect(body.error).not.toContain("Failed query");
    expect(body.error).not.toContain("Internal Server Error");

    // 2. Operator-side signal: structured log line carries the root
    //    Postgres message + SQLSTATE. Walks the `cause` chain rather
    //    than the Drizzle wrapper so the SQL fragment doesn't end up
    //    in logs either.
    const structuredLogs = logSpy.mock.calls
      .map((c) => c[0])
      .filter((s): s is string => typeof s === "string")
      .map((s) => {
        try {
          return JSON.parse(s) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((o): o is Record<string, unknown> => o !== null);
    const dbErrorLog = structuredLogs.find(
      (l) => l.event === "registration_db_error",
    );
    expect(dbErrorLog).toBeDefined();
    expect(dbErrorLog?.level).toBe("error");
    expect(dbErrorLog?.rootError).toBe(
      "value too long for type character varying(10)",
    );
    expect(dbErrorLog?.errorCode).toBe("22001");

    // 3. We don't broadcast a `newToken` event on failure — the row
    //    was never inserted, so any listener that hydrates from this
    //    would be operating on a fictional token.
    expect(executionCtx.waitUntil).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it("derives ltDirection / leverage / underlying from the BounceTech directory", async () => {
    mockReadContract.mockResolvedValueOnce(makeOnChainInfo());
    mockBounceTechLtList([{
      address: LT_ADDR,
      targetAsset: "ETH",
      targetLeverage: 5,
      isLong: false,
    }]);
    // The DB mock just echoes whatever .returning() resolves with, so the
    // body assertions alone wouldn't actually prove `resolveLtMeta` ran —
    // we additionally inspect the values handed to the INSERT call below.
    mockDbReturning.mockResolvedValueOnce([{
      address: VALID_ADDRESS,
      ltDirection: "short",
      leverage: 5,
      underlying: "ETH",
    }]);

    const app = createApp();
    const req = new Request("http://localhost/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: VALID_ADDRESS }),
    });
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;
    const res = await app.fetch(req, makeEnv(), executionCtx);

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { ltDirection: string; leverage: number; underlying: string } };
    expect(body.data.ltDirection).toBe("short");
    expect(body.data.leverage).toBe(5);
    expect(body.data.underlying).toBe("ETH");

    // Prove the helper actually derived these from the BounceTech directory
    // and inserted them — not just that the DB mock echoed our fixture.
    const insertCall = mockInsertValues.mock.calls[0]?.[0] as
      | { ltDirection?: string; leverage?: number; underlying?: string }
      | undefined;
    expect(insertCall?.ltDirection).toBe("short");
    expect(insertCall?.leverage).toBe(5);
    expect(insertCall?.underlying).toBe("ETH");
  });
});

function makeDbToken(overrides: Record<string, unknown> = {}) {
  return {
    address: VALID_ADDRESS,
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
    creator: VALID_CREATOR,
    isHidden: false,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function mockBounceLtResponse(rates: Record<string, string>) {
  const map = new Map<string, number>();
  for (const [address, exchangeRate] of Object.entries(rates)) {
    map.set(address.toLowerCase(), Number(BigInt(exchangeRate)) / 1e18);
  }
  mockReadLiveLtRates.mockResolvedValue(map);
}

describe("GET /tokens/:address — token lookup with Ponder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch so that any unconsumed `mockImplementationOnce` queued by
    // POST-block tests (e.g. `mockBounceTechLtList`) doesn't leak here.
    mockFetch.mockReset();
    // `fetchLiveLtRates` keeps a per-isolate Map<lt, rate> cache (5s TTL +
    // Promise lock) — without resetting it between tests, the first one
    // to call the live LT API pins the rate for every subsequent test in
    // this describe block, and `mockBounceLtResponse({ ... })` setups
    // become silent no-ops. Symptom: curveFilled / mcap assertions
    // collapse to half (or any other multiple of) their expected value.
    _resetLiveLtRatesCache();
  });

  it("returns 400 for invalid address", async () => {
    const app = createApp();
    const res = await app.request("/tokens/not-valid", {}, makeEnv());

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Invalid address");
  });

  it("returns 404 when token is not in database", async () => {
    mockSelectWhere.mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(404);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Token not found");
  });

  it("returns token with Ponder on-chain state + market data merged", async () => {
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    // First query: fetchTokenOnchain
    // `curveSupply` / `ltReserve` are the *virtual* AMM reserves (what
    // `Bonding.Trade` emits). `k` = TOTAL_SUPPLY × virtualLtAtLaunch; with
    // virtualLtAtLaunch = 2000 LT (= $4K at $2/LT launch rate) → k = 2e48.
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "2000000000000000000000000000000000000000000000000",
        curveSupply: "500000000000000000000000000",
        ltReserve: "2000000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        organicUsdcRaised: "0",
        volumeUsd: "12500000",
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "2000000000000000000" });
    // Second ponder query: historical snapshots
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      dataSource?: string;
      data: Record<string, unknown>;
    };
    expect(body.status).toBe("success");
    expect(body.dataSource).toBe("live");
    expect(body.data.curveSupply).toBe("500000000000000000000000000");
    expect(body.data.ltReserve).toBe("2000000000000000000000");
    expect(body.data.bondingPair).toBe("0xbondingpair");
    expect(typeof body.data.curveFilled).toBe("number");
    expect(body.data.curveFilledOrganic).not.toBeNull();
    expect(body.data.curveFilledLeverageBoost).not.toBeNull();
    expect(body.data.mcapUsd).not.toBeNull();
    expect(body.data.totalVolumeUsd).toBe(12.5);
  });

  it("returns totalVolumeUsd = 0 when the token has been indexed but never traded", async () => {
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "2000000000000000000000000000000000000000000000000",
        curveSupply: "1000000000000000000000000000",
        ltReserve: "2000000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        organicUsdcRaised: "0",
        volumeUsd: "0",
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "2000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    const body = (await res.json()) as { data: { totalVolumeUsd: number | null } };
    expect(body.data.totalVolumeUsd).toBe(0);
  });

  it("splits curveFilled into organic USD vs LT boost", async () => {
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    // Virtual-reserve math:
    //   k = 1e48 ⇒ virtualLtAtLaunch = k / TOTAL_SUPPLY = 1000 LT
    //   reserve1 = 1600 LT ⇒ realLt = 1600 − 1000 = 600 LT
    //   @ $4/LT ⇒ usdRaised = $2,400 ⇒ usdFilled = 20%
    //   reserve0 = 850M ⇒ realRemaining = 850M − 250M = 600M ⇒ supplyFilled = 20%
    //   total = max(20%, 20%) = 20%
    //   organic = $1,200 / $12K = 10%; boost = total − organic = 10%.
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "1000000000000000000000000000000000000000000000000",
        curveSupply: "850000000000000000000000000",
        ltReserve: "1600000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        organicUsdcRaised: "1200000000",
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "4000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: {
        curveFilled: number;
        curveFilledOrganic: number;
        curveFilledLeverageBoost: number;
      };
    };
    expect(body.data.curveFilled).toBeCloseTo(20, 1);
    expect(body.data.curveFilledOrganic).toBeCloseTo(10, 1);
    expect(body.data.curveFilledLeverageBoost).toBeCloseTo(10, 1);
  });

  it("clamps leverageBoost to 0 when the LT has dropped", async () => {
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    // Token launched at $4/LT (so virtualLtAtLaunch = 1000 LT, k = 1e48),
    // user put $3,000 organic in → bought ~750 LT worth into reserve1
    // (reserve1 = 1000 + 750 = 1750 LT). LT then dropped to $2/LT.
    // Now: realLt = 750 LT @ $2 = $1,500 → usdFilled = 12.5%.
    // supplyFilled: reserve0 = 950M → realRemaining = 700M → sold = 50M
    // → supplyFilled ≈ 6.67%. total = max(6.67%, 12.5%) = 12.5%.
    // organic = $3,000/$12K = 25%, clamped to total = 12.5%; boost = 0.
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "1000000000000000000000000000000000000000000000000",
        curveSupply: "950000000000000000000000000",
        ltReserve: "1750000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        organicUsdcRaised: "3000000000",
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "2000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    const body = (await res.json()) as {
      data: {
        curveFilled: number;
        curveFilledOrganic: number;
        curveFilledLeverageBoost: number;
      };
    };
    expect(body.data.curveFilled).toBeCloseTo(12.5, 1);
    expect(body.data.curveFilledOrganic).toBeCloseTo(12.5, 1);
    expect(body.data.curveFilledLeverageBoost).toBe(0);
  });

  it("uses USD raised as the headline, not the supply-side AMM lead", async () => {
    // Regression for the user-visible "23% buy pressure on a $20 raise toward
    // a $300 threshold" bug. Under the constant-product AMM, every dollar
    // moves the supply-% counter way faster than the USD-% counter, so the
    // previous `total = max(supplyFilled, usdFilled)` formula made a fresh
    // token with $20 of seed buys look ~3× further along than the dollars
    // actually represented. The headline must track USD raised — that's the
    // framing users think in ("we need $X, we've put in $Y, we're Y/X
    // there"). The supply trigger is a bear-market backstop, not a progress
    // signal.
    //
    // Fixture: $20 organic USDC in a token launched against a flat LT at
    // $1/LT, with a $12K threshold (test-suite default — see top-of-file
    // mock). `VIRTUAL_LIQUIDITY_USD` modelled at $100 to surface the
    // supply-vs-USD divergence:
    //   k = 1B × 100 LT virtualLtAtLaunch = 1e29 (× 1e18 fixed-point = 1e47).
    //   reserve1 = 120 LT (100 virtual + 20 real), reserve0 = k/r1 ≈ 833.33M
    //   → supplyFilled ≈ 22.2%, but realLt = 20 → usdFilled = 20/12000 ≈
    //   0.167%. New formula: total = usdFilled ≈ 0.17%, organic ≈ 0.17%,
    //   leverageBoost = 0.
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "100000000000000000000000000000000000000000000000",
        curveSupply: "833333333333333333333333333",
        ltReserve: "120000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        organicUsdcRaised: "20000000",
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "1000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    const body = (await res.json()) as {
      data: {
        curveFilled: number;
        curveFilledOrganic: number;
        curveFilledLeverageBoost: number;
      };
    };
    // Headline = USD raised / threshold, NOT supply-% (which would be ~22%).
    expect(body.data.curveFilled).toBeCloseTo(0.167, 2);
    expect(body.data.curveFilledOrganic).toBeCloseTo(0.167, 2);
    expect(body.data.curveFilledLeverageBoost).toBe(0);
  });

  it("surfaces curveRaisedUsd as `realLt × currentRate` for the curve-strip label", async () => {
    // The token-detail curve strip used to read "$0 ... $threshold" because
    // `curveRaisedUsd` was hardcoded to 0 in the frontend mapper. The API now
    // exposes the live USD value of the real LT reserve so the strip can
    // render "$X raised of $Y threshold" without redoing the virtual→real
    // subtraction client-side. This is just `usdFilled × threshold / 100`,
    // i.e. the numerator behind the headline percentage.
    //
    // Same fixture as the previous test: realLt = 20 LT @ $1/LT = $20.
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "100000000000000000000000000000000000000000000000",
        curveSupply: "833333333333333333333333333",
        ltReserve: "120000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        organicUsdcRaised: "20000000",
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "1000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    const body = (await res.json()) as {
      data: { curveRaisedUsd: number | null };
    };
    expect(body.data.curveRaisedUsd).toBeCloseTo(20, 2);
  });

  it("returns curveRaisedUsd: null when the breakdown is degraded", async () => {
    // No `k` (or rate, or ltReserve) → the enrich function can't recover the
    // real LT balance, so `curveRaisedUsd` must be null. The frontend renders
    // "—" via `formatUsdOrDash` rather than misleadingly displaying "$0".
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        // `k` intentionally absent
        curveSupply: "833333333333333333333333333",
        ltReserve: "120000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        organicUsdcRaised: "20000000",
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "1000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    const body = (await res.json()) as {
      data: { curveRaisedUsd: number | null };
    };
    expect(body.data.curveRaisedUsd).toBeNull();
  });

  it("returns null split (not 0) when organicUsdcRaised is missing from indexer", async () => {
    // Guards against indexer-version skew: a stale indexer response could be
    // missing `organicUsdcRaised` while every other field is present. Treating
    // that as `organic=0` would render the bar as 100% leverage boost, which
    // is a lie. We surface `null` so the frontend falls back to a solid fill.
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "1000000000000000000000000000000000000000000000000",
        curveSupply: "850000000000000000000000000",
        ltReserve: "1600000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        // organicUsdcRaised intentionally omitted
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "4000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        curveFilled: number;
        curveFilledOrganic: number | null;
        curveFilledLeverageBoost: number | null;
      };
    };
    // Total still computable from ltReserve × exchangeRate.
    expect(body.data.curveFilled).toBeCloseTo(20, 1);
    // ...but the split is "unknown", not "all leverage".
    expect(body.data.curveFilledOrganic).toBeNull();
    expect(body.data.curveFilledLeverageBoost).toBeNull();
  });

  it("reports 0% at launch (virtual reserve0 = TOTAL_SUPPLY)", async () => {
    // Regression test for the virtual-vs-real-reserves fix. At launch the
    // indexer persists reserve0 = TOTAL_SUPPLY (1B × 1e18), not 0. Naive
    // "remaining / CURVE_ALLOCATION" math would report −33% (or silently 0%
    // only via an early-return). We want a genuine 0% here.
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "1000000000000000000000000000000000000000000000000",
        // TOTAL_SUPPLY = 1B × 1e18, untouched curve
        curveSupply: "1000000000000000000000000000",
        // virtualLtAtLaunch = k / TOTAL_SUPPLY = 1000 × 1e18
        ltReserve: "1000000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        organicUsdcRaised: "0",
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "4000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    const body = (await res.json()) as {
      data: {
        curveFilled: number;
        curveFilledOrganic: number;
        curveFilledLeverageBoost: number;
      };
    };
    expect(body.data.curveFilled).toBe(0);
    expect(body.data.curveFilledOrganic).toBe(0);
    expect(body.data.curveFilledLeverageBoost).toBe(0);
  });

  it("reports 100% at full sellout (virtual reserve0 = LP_RESERVE)", async () => {
    // Regression test: at full sellout reserve0 floors at LP_RESERVE_RAW
    // (250M × 1e18), not 0. Pre-fix math reported ~66.67% here.
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce({
      token: {
        address: VALID_ADDRESS.toLowerCase(),
        ltToken: LT_ADDR.toLowerCase(),
        k: "1000000000000000000000000000000000000000000000000",
        // reserve0 = LP_RESERVE_RAW = 250M × 1e18
        curveSupply: "250000000000000000000000000",
        // AMM invariant at sellout: reserve1 = k / reserve0 = 4000 LT
        ltReserve: "4000000000000000000000",
        graduated: false,
        graduatedAt: null,
        bondingPair: "0xbondingpair",
        hyperswapPair: null,
        organicUsdcRaised: "0",
        timestamp: "1700000000",
      },
    });
    mockBounceLtResponse({ [LT_ADDR]: "4000000000000000000" });
    mockPonderQuery.mockResolvedValueOnce({ t0: { items: [] } });
    mockNeonQuery.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    const body = (await res.json()) as {
      data: {
        curveFilled: number;
        curveFilledOrganic: number;
        curveFilledLeverageBoost: number;
      };
    };
    expect(body.data.curveFilled).toBe(100);
  });

  it("returns token with degraded data source when market data is unavailable", async () => {
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      dataSource?: string;
      data: Record<string, unknown>;
    };
    expect(body.dataSource).toBe("degraded");
    expect(body.data.curveSupply).toBeNull();
    expect(body.data.ltReserve).toBeNull();
    expect(body.data.curveFilled).toBeNull();
    expect(body.data.totalVolumeUsd).toBeNull();
    expect(body.data.status).toBe("curve");
  });
});

describe("GET /tokens/:address — hidden-token holder bypass (issue #712)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    _resetLiveLtRatesCache();
  });

  function stubVisibleLensMiss(hiddenRow: Record<string, unknown> | null) {
    // First select (public lens) misses; second select (hidden lens)
    // optionally returns the hidden row. The single select chain mock
    // is shared, so we queue two `.where().limit()` results.
    mockSelectWhere.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockSelectWhere.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValue(hiddenRow ? [hiddenRow] : []),
    });
  }

  it("returns 404 when no wallet is supplied even if the row is hidden", async () => {
    // Sanity-check: hidden tokens must still 404 to the public lens. The
    // bypass is wallet-gated; absent the param, callers get the same
    // not-found response as a token that never existed.
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([]),
    });

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(404);
    expect(mockReadContract).not.toHaveBeenCalled();
  });

  it("returns the hidden row when the supplied wallet holds a non-zero balance", async () => {
    stubVisibleLensMiss(makeDbToken({ isHidden: true }));
    // `balanceOf` returns non-zero → wallet proves ownership → serve row.
    mockReadContract.mockResolvedValueOnce(1_000_000_000_000_000_000n);
    mockPonderQuery.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request(
      `/tokens/${VALID_ADDRESS}?wallet=${VALID_CREATOR}`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: { isHidden: boolean };
    };
    expect(body.status).toBe("success");
    expect(body.data.isHidden).toBe(true);
    expect(mockReadContract).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the supplied wallet does not hold the hidden token", async () => {
    stubVisibleLensMiss(makeDbToken({ isHidden: true }));
    // `balanceOf` returns 0 → ownership not proven → 404 (no leak).
    mockReadContract.mockResolvedValueOnce(0n);

    const app = createApp();
    const res = await app.request(
      `/tokens/${VALID_ADDRESS}?wallet=${VALID_CREATOR}`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(404);
    expect(mockReadContract).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the on-chain probe throws (fail-closed)", async () => {
    stubVisibleLensMiss(makeDbToken({ isHidden: true }));
    // RPC error → can't prove ownership → 404. We never serve the row on
    // a probe failure: it would leak the hidden token to any caller who
    // simply picked an RPC-unreachable moment.
    mockReadContract.mockRejectedValueOnce(new Error("rpc down"));

    const app = createApp();
    const res = await app.request(
      `/tokens/${VALID_ADDRESS}?wallet=${VALID_CREATOR}`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(404);
  });

  it("falls back to the public-lens 404 when the wallet param is malformed", async () => {
    // Invalid wallet → treat as if no wallet was supplied (public lens).
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([]),
    });

    const app = createApp();
    const res = await app.request(
      `/tokens/${VALID_ADDRESS}?wallet=not-an-address`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(404);
    // Malformed wallet param means the hidden-lens fallback never runs,
    // so the on-chain probe is never called.
    expect(mockReadContract).not.toHaveBeenCalled();
  });

  it("does not probe the chain for a visible token even when a wallet is supplied", async () => {
    // Visible token: public lens hits on the first query, the hidden
    // bypass never runs. Confirms the wallet param is a no-op for the
    // common case and the extra RPC call is gated behind a real miss.
    mockSelectWhere.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request(
      `/tokens/${VALID_ADDRESS}?wallet=${VALID_CREATOR}`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    expect(mockReadContract).not.toHaveBeenCalled();
  });

  it("marks wallet-aware responses non-cacheable so the edge can't leak them", async () => {
    // Without this directive, Cloudflare's edge cache (which honours
    // `s-maxage`) could keep a holder-only response and re-serve it to
    // a non-holder hitting `/tokens/0x…?wallet=0x…` with any wallet
    // string. The `cache.put` is already skipped, but cached-by-other
    // intermediaries is the real concern — `private, no-store`
    // forbids anyone in the chain from holding the body. Public
    // (no-wallet) responses continue to set a positive `s-maxage`
    // (asserted by the surrounding "happy path" test).
    stubVisibleLensMiss(makeDbToken({ isHidden: true }));
    mockReadContract.mockResolvedValueOnce(1n);
    mockPonderQuery.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request(
      `/tokens/${VALID_ADDRESS}?wallet=${VALID_CREATOR}`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const cacheControl = res.headers.get("Cache-Control") ?? "";
    expect(cacheControl).toMatch(/no-store/i);
    expect(cacheControl).toMatch(/private/i);
    expect(cacheControl).not.toMatch(/s-maxage=[1-9]/);
  });
});

describe("GET /tokens/:address — wallet-aware edge cache (issue #930)", () => {
  // Fresh in-memory `caches.default` per test. The module-level
  // `vi.stubGlobal("caches", undefined)` above keeps the rest of the
  // suite cache-free; this block re-installs a fake right before each
  // test and tears it down after, mirroring the pattern from
  // `edge-cache.test.ts`. The store is keyed on `req.url` (matching
  // Cloudflare's URL-keyed Cache API contract closely enough for the
  // route's `match` / `put` calls).
  let cacheMatch: ReturnType<typeof vi.fn>;
  let cachePut: ReturnType<typeof vi.fn>;
  let cacheStore: Map<string, Response>;

  function installFakeCache() {
    cacheStore = new Map<string, Response>();
    cacheMatch = vi.fn(async (req: Request) => {
      const stored = cacheStore.get(req.url);
      return stored ? stored.clone() : undefined;
    });
    cachePut = vi.fn(async (req: Request, res: Response) => {
      cacheStore.set(req.url, res.clone());
    });
    (globalThis as { caches?: { default: unknown } }).caches = {
      default: { match: cacheMatch, put: cachePut },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    installFakeCache();
  });

  afterEach(() => {
    // Restore the suite-wide `caches = undefined` stub so subsequent
    // describes (which don't expect a cache) aren't poisoned.
    (globalThis as { caches?: unknown }).caches = undefined;
  });

  // Acceptance (a): wallet-bearing request for a public token reads
  // cache when warm and writes it when cold.
  it("caches a wallet-bearing public-token response on cold miss and serves it on warm hit", async () => {
    // Cold: public lens hits, hidden bypass branch never runs, response
    // is admitted to the cache under the wallet-stripped URL.
    mockSelectWhere.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce(null);

    const app = createApp();
    const cold = await app.request(
      `/tokens/${VALID_ADDRESS}?wallet=${VALID_CREATOR}`,
      {},
      makeEnv(),
    );

    expect(cold.status).toBe(200);
    expect(cold.headers.get("Cache-Control")).toMatch(/s-maxage=\d+/);
    // The cache write happens against the wallet-stripped URL — the
    // canonical "public" slot for this token.
    expect(cachePut).toHaveBeenCalledTimes(1);
    const [putReq] = cachePut.mock.calls[0]!;
    expect((putReq as Request).url).not.toContain("wallet=");
    // Hono preserves the request URL casing, so the cache key carries
    // the checksum-cased address verbatim from `c.req.url`. We just
    // assert the address portion is present (case-insensitive).
    expect((putReq as Request).url.toLowerCase()).toContain(
      VALID_ADDRESS.toLowerCase(),
    );

    // Warm: same wallet-bearing URL, cache short-circuits the route
    // before any DB / indexer / RPC work runs. We DON'T queue a second
    // `mockSelectWhere` — if the route reached the DB the test would
    // fail with a TypeError on the unmocked select chain.
    const warm = await app.request(
      `/tokens/${VALID_ADDRESS}?wallet=${VALID_CREATOR}`,
      {},
      makeEnv(),
    );

    expect(warm.status).toBe(200);
    const warmBody = (await warm.json()) as {
      status: string;
      data: { address: string };
    };
    expect(warmBody.status).toBe("success");
    expect(warmBody.data.address).toBe(VALID_ADDRESS);
    expect(mockReadContract).not.toHaveBeenCalled();
  });

  // Acceptance (b): anonymous request shares the same cache entry as
  // the wallet-bearing request for a public token.
  it("shares one cache slot between wallet-bearing and anonymous requests for the same public token", async () => {
    mockSelectWhere.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce(null);

    const app = createApp();
    // Prime: wallet-bearing cold request writes one entry under the
    // wallet-stripped key.
    const primer = await app.request(
      `/tokens/${VALID_ADDRESS}?wallet=${VALID_CREATOR}`,
      {},
      makeEnv(),
    );
    expect(primer.status).toBe(200);
    expect(cacheStore.size).toBe(1);

    // Hit: anonymous request resolves the same key. Again, NO DB mock
    // is queued — if the route slipped past the cache it would throw.
    const anon = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());
    expect(anon.status).toBe(200);
    const anonBody = (await anon.json()) as { data: { address: string } };
    expect(anonBody.data.address).toBe(VALID_ADDRESS);

    // And the symmetric direction: priming with an anonymous request
    // and reading back through a wallet-bearing one MUST also share
    // the slot — fresh cache, primed anonymously this time.
    cacheStore.clear();
    cacheMatch.mockClear();
    cachePut.mockClear();
    mockSelectWhere.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValue([makeDbToken()]),
    });
    mockPonderQuery.mockResolvedValueOnce(null);

    const anonPrimer = await app.request(
      `/tokens/${VALID_ADDRESS}`,
      {},
      makeEnv(),
    );
    expect(anonPrimer.status).toBe(200);
    expect(cacheStore.size).toBe(1);

    const walletHit = await app.request(
      `/tokens/${VALID_ADDRESS}?wallet=${VALID_CREATOR}`,
      {},
      makeEnv(),
    );
    expect(walletHit.status).toBe(200);
  });

  // Acceptance (c): hidden-token holder bypass response is NOT cached.
  it("never caches a hidden-token holder-bypass response", async () => {
    // Public lens misses, hidden lens hits, on-chain probe confirms
    // ownership → bypass fires. The body is per-wallet and MUST stay
    // out of `caches.default`.
    mockSelectWhere.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockSelectWhere.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValue([makeDbToken({ isHidden: true })]),
    });
    mockReadContract.mockResolvedValueOnce(1_000_000_000_000_000_000n);
    mockPonderQuery.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request(
      `/tokens/${VALID_ADDRESS}?wallet=${VALID_CREATOR}`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { isHidden: boolean } };
    expect(body.data.isHidden).toBe(true);

    // The cache lookup happened (we still want to short-circuit if the
    // *public* row of this address gets cached later), but the write
    // for THIS response must not have run.
    expect(cacheMatch).toHaveBeenCalledTimes(1);
    expect(cachePut).not.toHaveBeenCalled();
    expect(cacheStore.size).toBe(0);

    const cacheControl = res.headers.get("Cache-Control") ?? "";
    expect(cacheControl).toMatch(/no-store/i);
    expect(cacheControl).toMatch(/private/i);
    expect(cacheControl).not.toMatch(/s-maxage=[1-9]/);
  });

  // Acceptance (d): wallet-bearing request for a hidden-not-held token
  // returns 404 and is NOT cached.
  it("returns 404 without caching when a wallet doesn't hold the hidden token", async () => {
    mockSelectWhere.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockSelectWhere.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValue([makeDbToken({ isHidden: true })]),
    });
    // `balanceOf` says zero → ownership not proven → 404.
    mockReadContract.mockResolvedValueOnce(0n);

    const app = createApp();
    const res = await app.request(
      `/tokens/${VALID_ADDRESS}?wallet=${VALID_CREATOR}`,
      {},
      makeEnv(),
    );

    expect(res.status).toBe(404);
    // Caching a 404 here would let an attacker poison the public slot
    // for a token that's about to launch under that address. We ALWAYS
    // skip `cache.put` for the 404 path, regardless of how the lookup
    // got there.
    expect(cachePut).not.toHaveBeenCalled();
    expect(cacheStore.size).toBe(0);
  });

  // Defense-in-depth: even with NO wallet supplied, a public-lens 404
  // must not poison the cache. (Pre-#930 this was already the
  // behaviour; the new code path keeps it that way because
  // `cache.put` only runs after a successful row lookup.)
  it("does not cache a public-lens 404 (no wallet supplied)", async () => {
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([]),
    });

    const app = createApp();
    const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    expect(res.status).toBe(404);
    expect(cachePut).not.toHaveBeenCalled();
    expect(cacheStore.size).toBe(0);
  });
});

describe("GET /tokens — list tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLiveLtRatesCache();
  });

  it("returns 400 for invalid pagination parameters", async () => {
    const app = createApp();
    const res = await app.request("/tokens?limit=abc", {}, makeEnv());

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string | null; data: unknown };
    expect(body.error).toBe("Invalid pagination parameters");
  });

  it("returns 400 for negative offset", async () => {
    const app = createApp();
    const res = await app.request("/tokens?offset=-1", {}, makeEnv());

    expect(res.status).toBe(400);
  });
});
