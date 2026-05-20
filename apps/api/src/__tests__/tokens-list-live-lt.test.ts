/**
 * Coverage for the BounceTech directory-membership filter applied to
 * `GET /tokens` and `GET /tokens/search` (originally issue #621, then
 * relaxed in #vdpf so a token whose backing LT is in BounceTech's
 * directory but missing a logo PNG stays visible — see the JSDoc on
 * `LtAvailability.directoryAddresses` for the asymmetry rationale).
 *
 * The filter pushes an `lt_pair IN (...)` clause into the SQL when the
 * directory snapshot is fresh, and fail-opens when it's stale/missing.
 */

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppBindings } from "../lib/types.js";

// ── Directory-membership mock — every test sets `currentDirectoryAddresses`. ──
// `liveAddresses` is intentionally a strict subset on hot paths in prod (an
// LT is in the directory but its logo PNG hasn't been published yet); the
// tests below pin that the listing endpoint reads `directoryAddresses`, not
// `liveAddresses`, so populating each set independently lets us regression-
// test that distinction.
const currentDirectoryAddresses: {
  value: ReadonlySet<string>;
  fresh: boolean;
} = {
  value: new Set<string>(),
  fresh: false,
};
const currentLiveAddresses: { value: ReadonlySet<string> } = {
  value: new Set<string>(),
};

vi.mock("../lib/lt-availability.js", () => ({
  getLiveLtAvailability: vi.fn(async () => ({
    liveAddresses: currentLiveAddresses.value,
    liveSymbols: new Set<string>(),
    liveUnderlyings: new Set<string>(),
    directoryAddresses: currentDirectoryAddresses.value,
    fresh: currentDirectoryAddresses.fresh,
  })),
  _resetLtAvailabilityCache: vi.fn(),
}));

// ── Drizzle chain mock — capture the final WHERE clause ──
//
// The route assembles `and(...)` into a single SQL fragment passed to
// `.where()`. We don't reconstruct it; we just check whether
// `inArray(tokens.ltPair, ...)` was added to the conditions array via
// drizzle's `inArray()` helper, by spying on that helper.
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

const currentDbRows: { rows: unknown[] } = { rows: [] };

function makeThenable() {
  const self = {
    then: (resolve: (rows: unknown[]) => unknown) =>
      resolve(currentDbRows.rows),
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

// Same stubs the other route tests use — keeps imports light and avoids
// fanout to a real indexer / RPC.
vi.mock("../lib/protocol-config.js", () => ({
  getGraduationThresholdUsd: vi.fn(async () => 12_000),
  _resetGraduationThresholdCache: vi.fn(),
}));
vi.mock("../lib/market-data.js", () => ({
  fetchGraduatedTokensOnchain: vi.fn(),
  fetchNonGraduatedTokensOnchain: vi.fn(),
  fetchTrendingCandidatesByVolume: vi.fn(async () => []),
  computeMarketDataForAddresses: vi.fn(async () => ({
    ok: true,
    data: { tokens: [], market: {} },
  })),
  buildBatchFromTokens: vi.fn(),
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

beforeEach(() => {
  // Stubbed per-test (rather than at module scope) so the `caches`
  // override doesn't leak across test files — Vitest doesn't have
  // `unstubGlobals: true` in this project, so a module-scope stub
  // would survive into sibling files and silently break edge-cache
  // assertions there. Mirrors the same pattern in `search-route.test.ts`.
  vi.stubGlobal("caches", undefined);
  inArrayCalls.length = 0;
  currentDbRows.rows = [];
  // Reset the module-scoped availability state explicitly so the
  // suite has no test-order coupling: every test re-asserts both
  // `.value` and `.fresh` for the field(s) it cares about, and the
  // ones it doesn't get a clean empty/non-fresh starting point.
  // Without this a future test that forgets to set `.fresh = false`
  // would silently inherit `true` from the previous case and add a
  // hidden ordering dependency.
  currentDirectoryAddresses.value = new Set<string>();
  currentDirectoryAddresses.fresh = false;
  currentLiveAddresses.value = new Set<string>();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /tokens — directory-membership filter pushed into SQL", () => {
  it("adds an `ltPair IN (...)` clause when the directory snapshot is fresh + populated", async () => {
    currentDirectoryAddresses.value = new Set([
      "0xb88339cb7199b77e23db6e890353e22632ba630f", // HYPE LT (lowercased)
    ]);
    currentDirectoryAddresses.fresh = true;

    await createApp().request("/tokens", {}, makeEnv());

    expect(inArrayCalls.length).toBeGreaterThan(0);
    const ltCall = inArrayCalls.find((call) =>
      // The route checksums every directory address before handing the
      // array to drizzle so the `IN (...)` comparison matches Postgres's
      // case-sensitive VARCHAR column.
      (call.values as string[]).some((v) =>
        v.startsWith("0xb88339CB"),
      ),
    );
    expect(ltCall).toBeDefined();
    expect(ltCall?.values).toEqual([
      "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
    ]);
  });

  it("includes LTs whose logo HEAD failed but that remain in BounceTech's directory", async () => {
    // Regression test for the "newly-created tokens vanish from /tokens"
    // bug: a token's LT can be present in BounceTech's `/leveraged-tokens`
    // directory while the per-LT logo PNG hasn't yet been uploaded (or
    // BounceTech rolled an SPA build whose fallback HTML trips the
    // `content-type !== image/*` check). Listing must use the looser
    // `directoryAddresses` set so the creator-launched token stays visible,
    // even though `liveAddresses` (which gates `/api/v1/assets`) doesn't
    // know about that LT yet.
    const unpublishedLt = "0x06286fd8030a8d6f40827ab9f2c0d386b19cce18"; // xyz:GOLD5L
    currentDirectoryAddresses.value = new Set([unpublishedLt]);
    currentDirectoryAddresses.fresh = true;
    currentLiveAddresses.value = new Set(); // logo HEAD failed for every LT

    await createApp().request("/tokens", {}, makeEnv());

    const ltCall = inArrayCalls.find((call) =>
      (call.values as string[]).some(
        (v) => v.toLowerCase() === unpublishedLt,
      ),
    );
    expect(ltCall).toBeDefined();
  });

  it("skips the SQL filter when the snapshot is stale (fresh: false)", async () => {
    currentDirectoryAddresses.value = new Set([
      "0xb88339cb7199b77e23db6e890353e22632ba630f",
    ]);
    currentDirectoryAddresses.fresh = false;

    await createApp().request("/tokens", {}, makeEnv());

    // Without `fresh: true` we MUST fail-open so a transient BounceTech
    // outage doesn't blank the home page.
    const ltFilter = inArrayCalls.find((call) =>
      (call.values as string[]).some((v) => v.toLowerCase().startsWith("0xb88339")),
    );
    expect(ltFilter).toBeUndefined();
  });

  it("skips the SQL filter when the directory set is empty (degraded signal)", async () => {
    currentDirectoryAddresses.value = new Set();
    currentDirectoryAddresses.fresh = true;

    await createApp().request("/tokens", {}, makeEnv());
    expect(inArrayCalls.length).toBe(0);
  });

  it("drops malformed BounceTech entries without 500ing the response", async () => {
    // Defensive guard: `getAddress("not-an-address")` throws, and an
    // unhandled throw inside the route handler bubbles to `app.onError`
    // (500 → "Internal Server Error" envelope). The directory feed is
    // external data and we mirror the `isAddress` → `getAddress` pattern
    // the rest of the codebase uses to keep one bad row from taking
    // down the home page. The well-formed entry must survive the filter
    // so we still pin the SQL `IN (...)` clause to the valid address.
    currentDirectoryAddresses.value = new Set([
      "not-a-real-address",
      "0xb88339cb7199b77e23db6e890353e22632ba630f",
    ]);
    currentDirectoryAddresses.fresh = true;

    const res = await createApp().request("/tokens", {}, makeEnv());
    expect(res.status).toBe(200);

    const ltCall = inArrayCalls.find((call) =>
      (call.values as string[]).some((v) =>
        v.startsWith("0xb88339CB"),
      ),
    );
    expect(ltCall?.values).toEqual([
      "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
    ]);
  });

  it("drops the SQL filter entirely when every directory entry is malformed", async () => {
    // The contrapositive: if `isAddress` rejects every entry, the
    // checksummed list is empty and we MUST skip `inArray(...)` so
    // drizzle doesn't emit a degenerate `IN ()` clause. Fail-open
    // matches the "empty directory" branch.
    currentDirectoryAddresses.value = new Set([
      "not-a-real-address",
      "also-garbage",
    ]);
    currentDirectoryAddresses.fresh = true;

    const res = await createApp().request("/tokens", {}, makeEnv());
    expect(res.status).toBe(200);
    expect(inArrayCalls.length).toBe(0);
  });
});

describe("GET /tokens/search — directory-membership filter pushed into SQL", () => {
  it("filters search results to directory-backed tokens when the snapshot is fresh", async () => {
    currentDirectoryAddresses.value = new Set([
      "0xb88339cb7199b77e23db6e890353e22632ba630f",
    ]);
    currentDirectoryAddresses.fresh = true;

    await createApp().request("/tokens/search?q=test", {}, makeEnv());

    const ltCall = inArrayCalls.find((call) =>
      (call.values as string[]).some((v) =>
        v.startsWith("0xb88339CB"),
      ),
    );
    expect(ltCall).toBeDefined();
  });

  it("does NOT narrow search to logo-only LTs when the directory has more entries", async () => {
    // Same regression case as the listing path: a search for a token
    // whose LT is in BounceTech's directory but hasn't been logo-published
    // must still find the token. Mirrors the pair we'd hit in production
    // for `xyz:GOLD5L`-backed tokens.
    const unpublishedLt = "0x06286fd8030a8d6f40827ab9f2c0d386b19cce18";
    currentDirectoryAddresses.value = new Set([unpublishedLt]);
    currentDirectoryAddresses.fresh = true;
    currentLiveAddresses.value = new Set();

    await createApp().request("/tokens/search?q=test", {}, makeEnv());

    const ltCall = inArrayCalls.find((call) =>
      (call.values as string[]).some(
        (v) => v.toLowerCase() === unpublishedLt,
      ),
    );
    expect(ltCall).toBeDefined();
  });

  it("fails open on a stale snapshot", async () => {
    currentDirectoryAddresses.value = new Set([
      "0xb88339cb7199b77e23db6e890353e22632ba630f",
    ]);
    currentDirectoryAddresses.fresh = false;

    await createApp().request("/tokens/search?q=test", {}, makeEnv());

    const ltFilter = inArrayCalls.find((call) =>
      (call.values as string[]).some((v) => v.toLowerCase().startsWith("0xb88339")),
    );
    expect(ltFilter).toBeUndefined();
  });

  it("drops malformed BounceTech entries without 500ing the search response", async () => {
    // Search shares the same external-data trust boundary as the list
    // path — pin the `isAddress` guard here too so a degraded BounceTech
    // payload can't kill `?q=...` and break the search modal.
    currentDirectoryAddresses.value = new Set([
      "garbage",
      "0xb88339cb7199b77e23db6e890353e22632ba630f",
    ]);
    currentDirectoryAddresses.fresh = true;

    const res = await createApp().request("/tokens/search?q=test", {}, makeEnv());
    expect(res.status).toBe(200);

    const ltCall = inArrayCalls.find((call) =>
      (call.values as string[]).some((v) =>
        v.startsWith("0xb88339CB"),
      ),
    );
    expect(ltCall?.values).toEqual([
      "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
    ]);
  });
});
