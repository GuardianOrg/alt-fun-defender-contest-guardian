import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppBindings } from "../lib/types.js";

// The /search route filters the `tokens` table by name / ticker — and,
// when the query looks like an address, by address prefix as well.
// These tests pin the *which columns get matched* contract directly,
// because the user-visible bug from issue #528 ("typing `1` returns
// every token") was a SQL-level mistake (substring-matching the address
// column for every query) rather than something we can catch at the
// HTTP boundary alone.

interface IlikeCall {
  column: { name?: string };
  pattern: string;
}
const ilikeCalls: IlikeCall[] = [];

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    ilike: vi.fn((column: { name?: string }, pattern: string) => {
      ilikeCalls.push({ column, pattern });
      return actual.ilike(
        column as Parameters<typeof actual.ilike>[0],
        pattern,
      );
    }),
  };
});

// Drizzle chain mock — the route calls `.select().from().where().limit()`.
// We don't care about the value resolved here (these tests assert on the
// `ilike` call shape), but the chain still has to be awaitable.
const currentDbRows: { rows: unknown[] } = { rows: [] };

function makeThenable() {
  const self = {
    then: (resolve: (rows: unknown[]) => unknown) => resolve(currentDbRows.rows),
    where: vi.fn(),
    limit: vi.fn(),
  };
  self.where.mockReturnValue(self);
  self.limit.mockReturnValue(self);
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

function ilikeColumns(): string[] {
  return ilikeCalls.map((call) => call.column.name ?? "<unknown>");
}

describe("GET /tokens/search", () => {
  beforeEach(() => {
    // Stub `caches` per-test (and unstub in `afterEach`) rather than
    // module-scope so this file can't leak `globalThis.caches = undefined`
    // into siblings: the suite-level vitest config doesn't enable
    // `unstubGlobals`, so a top-level stub would persist across files
    // and silently flake any test that relies on the real Cache API.
    vi.stubGlobal("caches", undefined);
    ilikeCalls.length = 0;
    currentDbRows.rows = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an empty array for an empty query without hitting the DB", async () => {
    const res = await createApp().request("/tokens/search?q=", {}, makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
    // No `ilike` calls and no DB chain initialised — the route must
    // short-circuit on the empty-query check before any SQL is built.
    expect(ilikeCalls).toHaveLength(0);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("treats whitespace-only queries as empty", async () => {
    const res = await createApp().request(
      "/tokens/search?q=%20%20%20",
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
    expect(ilikeCalls).toHaveLength(0);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("does NOT match against the address column for short non-`0x` queries (issue #528)", async () => {
    // Regression for #528: typing `1` used to substring-match every EVM
    // address (almost all of them contain a `1` somewhere in the hex
    // body), so the result list was indistinguishable from "no filter
    // applied". We expect *only* the name + ticker columns to be queried.
    const res = await createApp().request(
      "/tokens/search?q=1",
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const cols = ilikeColumns();
    expect(cols).toContain("name");
    expect(cols).toContain("ticker");
    expect(cols).not.toContain("address");
  });

  it("does NOT match against the address column for arbitrary text queries", async () => {
    // Same rule for word-shaped queries — even `cafebabe` (valid hex but
    // no `0x` prefix) should be treated as a name/ticker search. Users
    // who mean "address" type/paste the `0x` prefix; everything else is
    // a word and should never amplify into an address scan.
    await createApp().request(
      "/tokens/search?q=doge",
      {},
      makeEnv(),
    );

    const cols = ilikeColumns();
    expect(cols).toContain("name");
    expect(cols).toContain("ticker");
    expect(cols).not.toContain("address");
  });

  it("includes the address column (prefix match) for `0x`-prefixed queries", async () => {
    const prefix = "0xd8da6bf2";
    await createApp().request(
      `/tokens/search?q=${prefix}`,
      {},
      makeEnv(),
    );

    const addressCalls = ilikeCalls.filter(
      (call) => call.column.name === "address",
    );
    expect(addressCalls).toHaveLength(1);
    // Prefix match (no leading `%`), not a substring scan — pasting an
    // address prefix should locate the token whose address *starts* with
    // those bytes, never some unrelated address that happens to contain
    // them mid-string.
    expect(addressCalls[0]?.pattern).toBe(`${prefix}%`);
  });

  it("trims surrounding whitespace before searching", async () => {
    await createApp().request(
      "/tokens/search?q=%20%20doge%20%20",
      {},
      makeEnv(),
    );

    // The pattern handed to `ilike` must be the trimmed form — leading /
    // trailing whitespace in the search box should never appear inside
    // the SQL `LIKE` body.
    const namePattern = ilikeCalls.find(
      (call) => call.column.name === "name",
    )?.pattern;
    expect(namePattern).toBe("%doge%");
  });
});
