/**
 * Coverage for issue #621's "hide tokens whose backing LT isn't live on
 * BounceTech's UI yet" filter as applied to `GET /tokens` and
 * `GET /tokens/search`. The filter pushes an `lt_pair IN (...)` clause
 * into the SQL when the live-LT snapshot is fresh, and fail-opens when
 * it's stale/missing.
 */

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppBindings } from "../lib/types.js";

// ── Live-LT availability mock — every test sets `currentLiveAddresses` ──
const currentLiveAddresses: { value: ReadonlySet<string>; fresh: boolean } = {
  value: new Set<string>(),
  fresh: false,
};

vi.mock("../lib/lt-availability.js", () => ({
  getLiveLtAvailability: vi.fn(async () => ({
    liveAddresses: currentLiveAddresses.value,
    liveSymbols: new Set<string>(),
    liveUnderlyings: new Set<string>(),
    fresh: currentLiveAddresses.fresh,
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
  fetchTrendingCandidateAddresses: vi.fn(async () => []),
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

beforeEach(() => {
  // Stubbed per-test (rather than at module scope) so the `caches`
  // override doesn't leak across test files — Vitest doesn't have
  // `unstubGlobals: true` in this project, so a module-scope stub
  // would survive into sibling files and silently break edge-cache
  // assertions there. Mirrors the same pattern in `search-route.test.ts`.
  vi.stubGlobal("caches", undefined);
  inArrayCalls.length = 0;
  currentDbRows.rows = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /tokens — live-LT filter pushed into SQL (issue #621)", () => {
  it("adds an `ltPair IN (...)` clause when the snapshot is fresh + populated", async () => {
    currentLiveAddresses.value = new Set([
      "0xb88339cb7199b77e23db6e890353e22632ba630f", // HYPE LT (lowercased)
    ]);
    currentLiveAddresses.fresh = true;

    await createApp().request("/tokens", {}, makeEnv());

    expect(inArrayCalls.length).toBeGreaterThan(0);
    const ltCall = inArrayCalls.find((call) =>
      // The route checksums every live address before handing the array
      // to drizzle so the `IN (...)` comparison matches Postgres's
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

  it("skips the SQL filter when the snapshot is stale (fresh: false)", async () => {
    currentLiveAddresses.value = new Set([
      "0xb88339cb7199b77e23db6e890353e22632ba630f",
    ]);
    currentLiveAddresses.fresh = false;

    await createApp().request("/tokens", {}, makeEnv());

    // Without `fresh: true` we MUST fail-open so a transient BounceTech
    // outage doesn't blank the home page.
    const ltFilter = inArrayCalls.find((call) =>
      (call.values as string[]).some((v) => v.toLowerCase().startsWith("0xb88339")),
    );
    expect(ltFilter).toBeUndefined();
  });

  it("skips the SQL filter when the live set is empty (no LT live = degraded signal)", async () => {
    currentLiveAddresses.value = new Set();
    currentLiveAddresses.fresh = true;

    await createApp().request("/tokens", {}, makeEnv());
    expect(inArrayCalls.length).toBe(0);
  });
});

describe("GET /tokens/search — live-LT filter pushed into SQL (issue #621)", () => {
  it("filters search results to live-LT-backed tokens when the snapshot is fresh", async () => {
    currentLiveAddresses.value = new Set([
      "0xb88339cb7199b77e23db6e890353e22632ba630f",
    ]);
    currentLiveAddresses.fresh = true;

    await createApp().request("/tokens/search?q=test", {}, makeEnv());

    const ltCall = inArrayCalls.find((call) =>
      (call.values as string[]).some((v) =>
        v.startsWith("0xb88339CB"),
      ),
    );
    expect(ltCall).toBeDefined();
  });

  it("fails open on a stale snapshot", async () => {
    currentLiveAddresses.value = new Set([
      "0xb88339cb7199b77e23db6e890353e22632ba630f",
    ]);
    currentLiveAddresses.fresh = false;

    await createApp().request("/tokens/search?q=test", {}, makeEnv());

    const ltFilter = inArrayCalls.find((call) =>
      (call.values as string[]).some((v) => v.toLowerCase().startsWith("0xb88339")),
    );
    expect(ltFilter).toBeUndefined();
  });
});
