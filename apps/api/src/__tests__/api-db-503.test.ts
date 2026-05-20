/// <reference types="vite/client" />
/**
 * Issue #1110 — every direct read against the API's own `public.tokens`
 * (or `public.user_profiles`) table inside `apps/api/src/routes/**` must
 * surface a Neon HTTP failure as a documented 503, not a generic 500.
 *
 * Before this change, an unwrapped `await db.select().from(tokens)...`
 * threw a `NeonDbError` straight through to `app.onError` in
 * `apps/api/src/index.ts:325`, which emits a 500. The frontend already
 * handles 503 as a transient-outage degraded path (the
 * `dataSource: "degraded"` banner + retry-after-N-seconds path) but
 * treats 500 as an actionable bug. The same underlying Neon 1006 ban
 * was producing two different observable HTTP codes depending on which
 * route happened to read the API DB before the indexer DB.
 *
 * These tests pin the new contract: the API-DB callsites land on the
 * same 503 the indexer-side reads already emit.
 *
 * Sibling grep gate further down asserts no future `await db.select`
 * regression can slip in. The triple-slash reference above pulls in
 * `ImportMeta.glob` for the static-source scan — vitest runs on Vite,
 * so the type is available at test time without bloating the runtime
 * `tsconfig` types list.
 */

import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppBindings } from "../lib/types.js";

// ---------- DB mock: rejects-on-await ----------
//
// Helper to build a Drizzle-shaped chain where every terminal awaitable
// (`.where(...)`, `.limit(...)`, `.offset(...)`) rejects with the same
// `NeonDbError`-shaped value we see from the production Cloudflare ban
// (`Failed query: ...` wrapper with the 1006 status carried on `cause`).
// Matches Drizzle's `neon-http` driver's wrapping behaviour so the
// `describeError` log shim has the cause chain it expects.
function makeRejectingChain(): {
  then: (
    resolve: (value: never) => unknown,
    reject?: (error: unknown) => unknown,
  ) => unknown;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  offset: ReturnType<typeof vi.fn>;
} {
  const rejection = Object.assign(
    new Error('Failed query: select ... from "tokens" ...'),
    {
      cause: Object.assign(
        new Error("Server error (HTTP status 403): error code: 1006"),
        { code: 1006 },
      ),
    },
  );
  // Drizzle's chainable is itself a thenable — `await chain` runs the
  // SQL. A `then` that immediately invokes `reject` produces the same
  // observable behaviour as the production NeonDbError throw.
  const chain = {
    then: (_resolve: unknown, reject?: (error: unknown) => unknown) => {
      return Promise.resolve(reject?.(rejection));
    },
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.offset.mockReturnValue(chain);
  return chain;
}

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => makeRejectingChain()),
  })),
  insert: vi.fn(),
};

vi.mock("../db/client.js", () => ({
  createDb: () => mockDb,
}));

// ---------- Indexer / market-data stubs ----------
//
// The detail route's market-data fetch normally fans out to BounceTech +
// the indexer. Stub at the helper boundary so the rejecting `db.select`
// is the only failure surface in these tests — otherwise an unmocked
// upstream would mask the route's 503 with a 503 from a different
// source and the assertion that *this* code path emits 503 wouldn't
// prove the regression is fixed.
vi.mock("../lib/market-data.js", () => ({
  computeMarketDataSingle: vi.fn(async () => ({ ok: false })),
  computeMarketDataForAddresses: vi.fn(async () => ({ ok: false })),
  buildBatchFromTokens: vi.fn(async () => ({ ok: false })),
  fetchGraduatedTokensOnchain: vi.fn(async () => []),
  fetchNonGraduatedTokensOnchain: vi.fn(async () => []),
  fetchTrendingCandidatesByVolume: vi.fn(async () => []),
}));

vi.mock("../lib/protocol-config.js", () => ({
  getGraduationThresholdUsd: vi.fn(async () => 12_000),
  _resetGraduationThresholdCache: vi.fn(),
}));

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

// The `tokens/create.ts` route handler imports `token-registration`,
// which in turn pulls the WebSocket broadcast helper. Broadcast walks
// through the Durable Object module (`cloudflare:workers` import) which
// can't be resolved in vitest. Stubbing at the broadcast boundary keeps
// the import graph happy without exercising any of the registration /
// broadcast code in these tests (none of the routes under exercise here
// hit that path).
vi.mock("../lib/broadcast.js", () => ({
  broadcastToChannel: vi.fn().mockResolvedValue(undefined),
}));

vi.stubGlobal("caches", undefined);

const { default: tokensRoute } = await import("../routes/tokens/index.js");

function createApp(): Hono<{ Bindings: AppBindings }> {
  const app = new Hono<{ Bindings: AppBindings }>();
  app.route("/tokens", tokensRoute);
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

const VALID_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

describe("API DB reads — issue #1110: 503 on transient Neon failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Silence the `tryApiDbRead` structured-error log line. Otherwise
    // each rejecting query writes the full NeonDbError shape to stdout,
    // which makes vitest output noisy and the actual test signal hard
    // to read.
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  describe("GET /tokens/:address", () => {
    it("returns 503 (not 500) when the public-lens DB read rejects", async () => {
      // The bug: an unwrapped `db.select().from(tokens)...` threw a
      // `NeonDbError` straight through to `app.onError` and the route
      // emitted 500. We expect 503 now.
      const app = createApp();
      const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

      expect(res.status).toBe(503);
      expect(res.status).not.toBe(500);
      const body = (await res.json()) as { status: string; error: string };
      expect(body.status).toBe("error");
      expect(body.error).toContain("unavailable");
    });

    it("does not pin the 503 at the edge (no positive s-maxage on the failure body)", async () => {
      // Acceptance criterion in issue #1110: a transient outage must
      // never carry a `Cache-Control: s-maxage > 0` — otherwise the
      // edge stores the 503 for the TTL window and a 30 s Neon hiccup
      // becomes a multi-minute outage. We don't set Cache-Control at
      // all on the 503 (Hono's default), which is the documented
      // contract.
      const app = createApp();
      const res = await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

      expect(res.status).toBe(503);
      // `Cache-Control` is either unset or empty/`no-store`. We don't
      // assert the exact absence form (Hono / Workers may stamp a
      // default value upstream) — only the property the issue cares
      // about: no positive `s-maxage` that would pin this 503 at the
      // edge for the TTL window.
      const cacheControl = res.headers.get("Cache-Control") ?? "";
      expect(cacheControl).not.toMatch(/s-maxage=\s*[1-9]/);
    });
  });

  describe("GET /tokens — list", () => {
    it("returns 503 (not 500) when the list-page DB read rejects", async () => {
      // Default DB-first path: `dbTokens = await db.select().from(tokens)
      // .where(...).orderBy(...).limit(...).offset(...)`. The chain
      // rejects, the route returns 503.
      const app = createApp();
      const res = await app.request("/tokens?limit=10", {}, makeEnv());

      expect(res.status).toBe(503);
      expect(res.status).not.toBe(500);
      const body = (await res.json()) as { status: string; error: string };
      expect(body.status).toBe("error");
      expect(body.error).toContain("unavailable");
    });
  });

  describe("POST /tokens/batch", () => {
    it("returns 503 (not 500) when the batch DB read rejects", async () => {
      const app = createApp();
      const res = await app.request(
        "/tokens/batch",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addresses: [VALID_ADDRESS] }),
        },
        makeEnv(),
      );

      expect(res.status).toBe(503);
      expect(res.status).not.toBe(500);
    });
  });

  describe("GET /tokens/search", () => {
    it("returns 503 (not 500) when the search DB read rejects", async () => {
      const app = createApp();
      const res = await app.request("/tokens/search?q=foo", {}, makeEnv());

      expect(res.status).toBe(503);
      expect(res.status).not.toBe(500);
    });
  });

  it("logs a structured failure line on the catch path", async () => {
    // Operators triage these via Cloudflare logs / `wrangler tail`
    // pivoting on the `event` field. Without the structured log line
    // a 503 cluster is unactionable — the cause chain (Neon HTTP
    // status / 1006) is buried under Drizzle's `Failed query:`
    // wrapper at the top level. Asserts `describeError` walks the
    // wrapper and surfaces `code: 1006` for grep.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const app = createApp();
    await app.request(`/tokens/${VALID_ADDRESS}`, {}, makeEnv());

    const structuredLines = logSpy.mock.calls
      .map((call) => call[0])
      .filter((s): s is string => typeof s === "string")
      .map((s) => {
        try {
          return JSON.parse(s) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((o): o is Record<string, unknown> => o !== null);

    const apiDbErrorLine = structuredLines.find(
      (l) =>
        typeof l.event === "string" && l.event.startsWith("api_db."),
    );
    expect(apiDbErrorLine).toBeDefined();
    expect(apiDbErrorLine?.level).toBe("error");
    // `describeError` walks the cause chain — the 1006 status surfaces
    // at the top of the `error` payload so log filters can pivot on it.
    const errorField = apiDbErrorLine?.error as
      | { cause?: { message?: string } }
      | undefined;
    expect(errorField?.cause?.message).toContain("1006");
  });
});

// ---------- grep gate ----------
//
// Issue #1110 acceptance: every direct DB read in `apps/api/src/routes/**`
// must be wrapped in a try/catch (via `tryApiDbRead` by convention).
// We verify this with a one-shot static check rather than an ESLint
// rule — vitest already runs in CI and the failure mode is identical
// (red CI), but a custom ESLint rule for one project-specific pattern
// is more machinery than the constraint deserves.
//
// The gate is intentionally simple: any `await db.select` token inside
// `routes/**/*.ts` indicates an unwrapped read. The `tryApiDbRead`
// callback form (`() => db.select()...`) doesn't carry the `await`
// keyword immediately before `db.select`, so wrapped reads don't trip
// the check. Test files (`__tests__/`) are explicitly excluded by the
// directory scope.
describe("grep gate — no unwrapped `await db.select` in routes/", () => {
  it("every routes/**/*.ts file routes its DB reads through tryApiDbRead", async () => {
    // Vite's `?raw` query loads each module's source as a string at
    // build time, so the grep gate runs as a static check inside the
    // vitest process without needing the `node:fs` shape (which vitest
    // doesn't expose to TS by default in this project's `tsconfig`).
    // `eager: true` resolves the imports synchronously into the
    // returned map — by the time we read `routeSources`, every entry
    // is a `{ default: <source code string> }`. Globs are relative to
    // the importing file.
    const routeSources = import.meta.glob<string>(
      "../routes/**/*.ts",
      { query: "?raw", import: "default", eager: true },
    );

    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const [relPath, text] of Object.entries(routeSources)) {
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        // `await db.select(...).from(...)...` is the legacy unwrapped
        // shape. We don't allow it in routes/ anymore — every read
        // must go through `tryApiDbRead` so a Neon HTTP failure surfaces
        // as 503, not 500. Issue #1110.
        if (/\bawait\s+db\.select\b/.test(line)) {
          offenders.push({ file: relPath, line: i + 1, text: line.trim() });
        }
      }
    }

    if (offenders.length > 0) {
      const formatted = offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
        .join("\n");
      throw new Error(
        `Found ${offenders.length} unwrapped \`await db.select\` read(s) in apps/api/src/routes/.\n\n` +
          `Each one bypasses the issue-#1110 try/catch contract — a transient Neon\n` +
          `HTTP failure (e.g. 1006) at any of these callsites would surface to\n` +
          `\`app.onError\` as a generic 500 instead of the documented 503 the\n` +
          `frontend handles as a degraded-data outage.\n\n` +
          `Wrap each one via \`tryApiDbRead\` in lib/api-db-reads.js:\n\n${formatted}`,
      );
    }
    expect(offenders).toEqual([]);
  });
});
