/**
 * API Worker smoke test — starts wrangler dev (real Workers runtime),
 * hits every read endpoint, and verifies responses.
 *
 * Catches:
 * - Runtime-incompatible modules (e.g. TCP-based DB driver hanging)
 * - Missing CORS middleware
 * - DB schema mismatches
 * - Broken read endpoints
 *
 * Requires DATABASE_URL in .dev.vars. Skips gracefully if missing.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const PORT = 8799;
const BASE_URL = `http://localhost:${PORT}`;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 10_000;
const DATABASE_PROBE_RETRIES = 3;
const DATABASE_PROBE_RETRY_DELAY_MS = 1_000;

function randomAddress() {
  const hex = "0123456789abcdef";
  let addr = "0x";
  for (let i = 0; i < 40; i++) addr += hex[Math.floor(Math.random() * hex.length)];
  return addr;
}

const NONEXISTENT_ADDRESS = randomAddress();

function getVarFromDevVars(filePath, key) {
  if (!existsSync(filePath)) return "";
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf("=");
    if (sep === -1) continue;
    if (trimmed.slice(0, sep).trim() === key) return trimmed.slice(sep + 1).trim();
  }
  return "";
}

const devVarsPath = fileURLToPath(new URL("../.dev.vars", import.meta.url));
const databaseUrl =
  process.env.DATABASE_URL?.trim() || getVarFromDevVars(devVarsPath, "DATABASE_URL");
// The chart probe (see `/api/v1/chart` below) depends on the BounceTech
// LT exchange-rate DB for its `generate_series` query; the route returns
// 500 when the binding is missing. Detect that here so we can skip the
// chart probe gracefully instead of failing the smoke test on a missing
// dev secret. Mirrors the `databaseUrl` lookup above so the probe still
// runs against whatever `wrangler dev` picks up via `.dev.vars`.
const bouncetechDatabaseUrl =
  process.env.BOUNCETECH_DATABASE_URL?.trim() ||
  getVarFromDevVars(devVarsPath, "BOUNCETECH_DATABASE_URL");

/**
 * Race a promise against a timeout. Neon's HTTP driver does not honour
 * an AbortSignal on individual queries, so a stalled TCP connection
 * (DNS hang, half-open socket, slow handshake) would otherwise block
 * the smoke test indefinitely instead of falling through to the retry
 * + skip-on-failure branch below. Mirrors the `fetchWithTimeout`
 * pattern used for the HTTP probes further down.
 */
async function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function getDatabaseReadiness(connectionString) {
  const sql = neon(connectionString);
  let lastError = null;

  for (let attempt = 1; attempt <= DATABASE_PROBE_RETRIES; attempt++) {
    try {
      const probe = sql`
        SELECT
          to_regclass('ponder_views.token_balance')::text AS token_balance,
          to_regclass('ponder_views.wallet_position')::text AS wallet_position
      `;
      const [row] = await withTimeout(
        probe,
        REQUEST_TIMEOUT_MS,
        "Indexer view probe",
      );
      return {
        available: true,
        reason: null,
        tokenBalance: typeof row?.token_balance === "string",
        walletPosition: typeof row?.wallet_position === "string",
      };
    } catch (error) {
      lastError = error;
      if (attempt < DATABASE_PROBE_RETRIES) {
        await sleep(DATABASE_PROBE_RETRY_DELAY_MS);
      }
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  console.warn(
    "Could not probe database readiness before smoke test; skipping DB-backed endpoint checks",
    reason,
  );
  return {
    available: false,
    reason,
    tokenBalance: false,
    walletPosition: false,
  };
}

if (!databaseUrl) {
  console.log("DATABASE_URL is unset or empty — skipping API smoke test");
  process.exit(0);
}

let passed = 0;
let failed = 0;
let skipped = 0;
let databaseReadiness = {
  available: true,
  reason: null,
  tokenBalance: true,
  walletPosition: true,
};

function describeMissingIndexerViews() {
  const missing = [];
  if (!databaseReadiness.tokenBalance) missing.push("ponder_views.token_balance");
  if (!databaseReadiness.walletPosition) missing.push("ponder_views.wallet_position");
  return missing.join(", ");
}

function skipIfDatabaseUnavailable() {
  if (databaseReadiness.available) return;
  skip(`database unavailable for smoke test: ${databaseReadiness.reason}`);
}

class SkipTest extends Error {
  constructor(reason) {
    super(reason);
    this.name = "SkipTest";
  }
}

function skip(reason) {
  throw new SkipTest(reason);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    if (err instanceof SkipTest) {
      console.log(`  ⊘  ${name} (skipped: ${err.message})`);
      skipped++;
      return;
    }
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchJson(path) {
  const res = await fetchWithTimeout(`${BASE_URL}${path}`);
  const body = await res.json();
  return { res, body };
}

// ─── Test definitions ────────────────────────────────────────────────

async function runTests() {
  console.log("\n--- Worker runtime ---\n");

  await test("GET / responds with success", async () => {
    const { res, body } = await fetchJson("/");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body.status === "success", `Expected success, got ${body.status}`);
  });

  await test("GET /health responds", async () => {
    const { res, body } = await fetchJson("/health");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body.data.services.api === true, "Expected api: true");
  });

  await test("Unknown routes return 404", async () => {
    const { res } = await fetchJson("/does-not-exist");
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  console.log("\n--- CORS ---\n");

  await test("Success responses have CORS headers", async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/`);
    const origin = res.headers.get("access-control-allow-origin");
    assert(origin === "*", `Expected *, got ${origin}`);
  });

  await test("Error responses have CORS headers", async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/does-not-exist`);
    const origin = res.headers.get("access-control-allow-origin");
    assert(origin === "*", `Expected *, got ${origin}`);
  });

  await test("OPTIONS preflight returns CORS headers", async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/api/v1/tokens`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    assert(res.status === 204, `Expected 204, got ${res.status}`);
    assert(res.headers.get("access-control-allow-origin") === "*", "Missing CORS origin");
    assert(res.headers.get("access-control-allow-methods")?.includes("GET"), "Missing GET in methods");
  });

  console.log("\n--- Token endpoints (DB) ---\n");

  // Discover a real token dynamically so tests aren't coupled to seeded data
  let discoveredToken = null;
  let discoveredCreator = null;

  await test("GET /api/v1/tokens returns list", async () => {
    skipIfDatabaseUnavailable();
    const { res, body } = await fetchJson("/api/v1/tokens?limit=10&offset=0");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(body.data), "Expected array");
    if (body.data.length >= 1) {
      discoveredToken = body.data[0].address;
      discoveredCreator = body.data[0].creator;
    }
  });

  await test("Token has expected shape", async () => {
    skipIfDatabaseUnavailable();
    const { body } = await fetchJson("/api/v1/tokens?limit=1&offset=0");
    if (body.data.length === 0) skip("DB has no tokens");
    const t = body.data[0];
    for (const key of ["address", "name", "ticker", "leverage", "underlying", "status", "creator", "createdAt"]) {
      assert(key in t, `Missing property: ${key}`);
    }
  });

  await test("Token list respects limit", async () => {
    skipIfDatabaseUnavailable();
    const { body } = await fetchJson("/api/v1/tokens?limit=1&offset=0");
    assert(body.data.length <= 1, `Expected <=1, got ${body.data.length}`);
  });

  await test("Token list filters by status", async () => {
    skipIfDatabaseUnavailable();
    const { res, body } = await fetchJson("/api/v1/tokens?status=curve&limit=10&offset=0");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    for (const t of body.data) {
      assert(t.status === "curve", `Expected status=curve, got ${t.status}`);
    }
  });

  await test("Token list rejects bad pagination", async () => {
    const { res } = await fetchJson("/api/v1/tokens?limit=abc");
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await test("GET /api/v1/tokens/search returns results", async () => {
    skipIfDatabaseUnavailable();
    if (!discoveredToken) skip("DB has no tokens");
    const { body: detail } = await fetchJson(`/api/v1/tokens/${discoveredToken}`);
    // Grab the first contiguous ASCII-alphanumeric run from the name and
    // cap at 3 chars. `slice(0, 3)` on the raw name walks UTF-16 code
    // units, which can split a leading emoji's surrogate pair and produce
    // a lone surrogate that `encodeURIComponent` refuses to encode
    // (`URI malformed`). Pulling a contiguous run also keeps the query as
    // a real substring of the token name — a filter/join would fabricate
    // matches like `"A-B"` → `"AB"` that the search index can't find.
    const rawName = typeof detail.data.name === "string" ? detail.data.name : "";
    const namePrefix = (rawName.match(/[a-z0-9]+/i)?.[0] ?? "").slice(0, 3);
    if (!namePrefix) skip("Token name has no searchable alphanumeric chars");
    const { res, body } = await fetchJson(`/api/v1/tokens/search?q=${encodeURIComponent(namePrefix)}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body.data.length >= 1, "Expected at least 1 result");
  });

  await test("Search returns empty for no matches", async () => {
    skipIfDatabaseUnavailable();
    const { body } = await fetchJson("/api/v1/tokens/search?q=zzzznonexistent");
    assert(body.data.length === 0, "Expected empty array");
  });

  await test("GET /api/v1/tokens/:address returns detail", async () => {
    skipIfDatabaseUnavailable();
    if (!discoveredToken) skip("DB has no tokens");
    const { res, body } = await fetchJson(`/api/v1/tokens/${discoveredToken}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body.data.address === discoveredToken, `Wrong address: ${body.data.address}`);
    assert(typeof body.data.name === "string" && body.data.name.length > 0, "Expected non-empty name");
    assert("curveFilled" in body.data, "Missing curveFilled");
    assert("curveSupply" in body.data, "Missing curveSupply");
  });

  await test("Token detail returns 404 for unknown", async () => {
    skipIfDatabaseUnavailable();
    const { res } = await fetchJson(`/api/v1/tokens/${NONEXISTENT_ADDRESS}`);
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  await test("Token detail returns 400 for invalid address", async () => {
    const { res } = await fetchJson("/api/v1/tokens/not-an-address");
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  console.log("\n--- Creators (DB) ---\n");

  await test("GET /api/v1/creators/:address returns profile", async () => {
    skipIfDatabaseUnavailable();
    if (!discoveredCreator) skip("DB has no creators");
    const { res, body } = await fetchJson(`/api/v1/creators/${discoveredCreator}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body.data.tokens.length >= 1, "Expected at least 1 token");
    assert(body.data.stats.tokensCreated >= 1, "Expected tokensCreated >= 1");
    assert("totalVolume" in body.data.stats, "Missing totalVolume");
  });

  await test("Creator returns empty for unknown address", async () => {
    skipIfDatabaseUnavailable();
    const { res, body } = await fetchJson(`/api/v1/creators/${NONEXISTENT_ADDRESS}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body.data.tokens.length === 0, "Expected no tokens");
  });

  await test("Creator returns 400 for bad address", async () => {
    const { res } = await fetchJson("/api/v1/creators/bad");
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  console.log("\n--- Profiles (DB) ---\n");

  await test("GET /api/v1/profiles/:address returns default", async () => {
    skipIfDatabaseUnavailable();
    const { res, body } = await fetchJson(`/api/v1/profiles/${NONEXISTENT_ADDRESS}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      body.data.address.toLowerCase() === NONEXISTENT_ADDRESS.toLowerCase(),
      `Wrong address: expected ${NONEXISTENT_ADDRESS}, got ${body.data.address}`,
    );
    assert(body.data.displayName === null, "Expected null displayName");
  });

  await test("Profile returns 400 for bad address", async () => {
    const { res } = await fetchJson("/api/v1/profiles/bad");
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  console.log("\n--- Ponder process down (indexer routes read direct from Postgres) ---\n");

  // After the GraphQL → direct-SQL migration, /trades, /stats, /holders, and
  // /portfolio read `ponder_prod.*` straight from Neon — they do NOT depend
  // on the Ponder process being reachable. So with no Ponder running we
  // still expect 200s from this set, sourced from whatever rows the shared
  // Postgres holds. This is a deliberate resilience improvement: the API
  // stays up under Ponder outages as long as Neon is up.

  await test("GET /api/v1/trades serves from Postgres without Ponder", async () => {
    skipIfDatabaseUnavailable();
    const { res, body } = await fetchJson("/api/v1/trades?limit=5");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(body.data), "Expected `data` to be an array");
  });

  await test("GET /api/v1/stats serves live counters without Ponder", async () => {
    skipIfDatabaseUnavailable();
    const { res, body } = await fetchJson("/api/v1/stats");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert("totalTokens" in body.data, "Missing totalTokens");
    // Direct SQL — `dataSource` should now be "live" since Postgres is
    // reachable. A `degraded` reply would mean the indexer-side read
    // failed (the very thing this PR was meant to eliminate).
    assert(
      body.dataSource === "live",
      `Expected live (direct-SQL path), got ${body.dataSource}`,
    );
  });

  await test("GET /api/v1/holders/:address serves from Postgres without Ponder", async () => {
    skipIfDatabaseUnavailable();
    if (!databaseReadiness.tokenBalance) {
      skip(`staging DB is missing ${describeMissingIndexerViews()}`);
    }
    if (!discoveredToken) skip("DB has no tokens");
    const { res, body } = await fetchJson(`/api/v1/holders/${discoveredToken}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(body.data.holders), "Expected `holders` to be an array");
    assert(
      typeof body.data.totalHolders === "number",
      "Expected `totalHolders` to be a number",
    );
  });

  await test("GET /api/v1/portfolio/:wallet serves from Postgres without Ponder", async () => {
    skipIfDatabaseUnavailable();
    if (!databaseReadiness.tokenBalance || !databaseReadiness.walletPosition) {
      skip(`staging DB is missing ${describeMissingIndexerViews()}`);
    }
    // Use the zero address as a sentinel wallet — every running indexer
    // has zero rows for it, so we get a stable empty-positions response
    // without needing to discover a real holder.
    const { res, body } = await fetchJson(
      "/api/v1/portfolio/0x0000000000000000000000000000000000000001",
    );
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      Array.isArray(body.data.positions),
      "Expected `positions` to be an array",
    );
  });

  await test("GET /api/v1/security/:address returns fallback", async () => {
    skipIfDatabaseUnavailable();
    if (!discoveredToken) skip("DB has no tokens");
    const { res, body } = await fetchJson(`/api/v1/security/${discoveredToken}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert("contractVerified" in body.data, "Missing contractVerified");
  });

  await test("GET /api/v1/trades/sparkline/:address returns empty", async () => {
    skipIfDatabaseUnavailable();
    if (!discoveredToken) skip("DB has no tokens");
    const { res, body } = await fetchJson(`/api/v1/trades/sparkline/${discoveredToken}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(body.data), "Expected array");
  });

  console.log("\n--- Assets (external APIs) ---\n");

  await test("GET /api/v1/assets returns prices", async () => {
    const { res, body } = await fetchJson("/api/v1/assets");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(body.data.underlying), "Missing underlying");
    assert(Array.isArray(body.data.leveragedTokens), "Missing leveragedTokens");
  });

  // ─── Chart endpoint ────────────────────────────────────────────────
  //
  // The chart route is the single highest-engagement element on a token
  // page and was silently 503'ing on the busiest token (ALT) for weeks
  // before the direct-Postgres cut-over in #951. The failure mode was
  // load-correlated: pagination capped at 20k rows, so the regression
  // fired first on top-traffic tokens and last on local fixtures —
  // exactly the class of bug a static seed-against-a-known-token probe
  // misses. Hitting the live top-trending token's chart at every
  // user-pickable timeframe + a representative interval sample bounds
  // that risk by failing the smoke test on day 1 of any similar
  // per-token cap regression. See issue #976.
  console.log("\n--- Chart endpoint ---\n");

  /**
   * The set of (timeframe, interval) pairs the frontend can request.
   * Mirrors the user-visible chart toolbar — every value here is reachable
   * from a single click in the production UI, so each is a legitimate
   * regression surface. Three explicit interval cases (60s / 5m / 4h)
   * cover the spread between fine-grained intraday and coarse multi-hour
   * candles where row-count caps tend to trip.
   */
  const CHART_PROBE_CASES = [
    { q: "timeframe=1d", label: "tf=1d" },
    { q: "timeframe=5d", label: "tf=5d" },
    { q: "timeframe=1m", label: "tf=1m" },
    { q: "interval=60", label: "iv=60" },
    { q: "interval=300", label: "iv=300" },
    { q: "interval=14400", label: "iv=14400" },
  ];

  async function probeChartAddress(address) {
    for (const probeCase of CHART_PROBE_CASES) {
      const res = await fetchWithTimeout(
        `${BASE_URL}/api/v1/chart/${address}?${probeCase.q}`,
      );
      assert(
        res.status === 200,
        `chart ${probeCase.label} for ${address}: HTTP ${res.status}`,
      );
      // Treat a non-JSON body as a probe failure rather than letting the
      // raw SyntaxError surface — the chart route always returns JSON in
      // the contract under test, so a parse failure here is itself a
      // regression signal.
      let body;
      try {
        body = await res.json();
      } catch (err) {
        throw new Error(
          `chart ${probeCase.label} for ${address}: non-JSON body (${err instanceof Error ? err.message : String(err)})`,
        );
      }
      assert(
        body?.status === "success",
        `chart ${probeCase.label} for ${address}: status=${body?.status} error=${body?.error}`,
      );
      assert(
        Array.isArray(body?.data?.candles),
        `chart ${probeCase.label} for ${address}: missing data.candles array`,
      );
    }
  }

  await test("Chart probes top trending token at every timeframe + interval", async () => {
    skipIfDatabaseUnavailable();
    if (!bouncetechDatabaseUrl) {
      skip("BOUNCETECH_DATABASE_URL unset — chart route requires the LT-rate DB");
    }
    // `sort=trending` ranks by rolling 24h gross volume — the address
    // returned here is the highest-snapshot-count token in the
    // catalogue, which is the worst case for any per-token row cap.
    // Fall back to "newest" if trending is empty (degraded indexer
    // path) so the probe still runs.
    const { body: trendingBody } = await fetchJson(
      "/api/v1/tokens?limit=1&sort=trending",
    );
    const topTrending = trendingBody?.data?.[0]?.address;
    if (!topTrending) skip("no trending token available to probe");
    await probeChartAddress(topTrending);
  });

  await test("Chart probes most-recently launched token", async () => {
    skipIfDatabaseUnavailable();
    if (!bouncetechDatabaseUrl) {
      skip("BOUNCETECH_DATABASE_URL unset — chart route requires the LT-rate DB");
    }
    // Default sort is `createdAt desc` (see `apps/api/src/routes/tokens/list.ts`),
    // which gives the newest launched token — a different code path from
    // the trending probe above because pre-graduation tokens have a
    // much smaller snapshot window and exercise the empty-/short-history
    // branches in `buildPriceTimeline`. If we land on the same address
    // as the trending probe (small catalogues), skip to avoid redundant
    // work.
    const { body: newestBody } = await fetchJson("/api/v1/tokens?limit=1");
    const newest = newestBody?.data?.[0]?.address;
    if (!newest) skip("no recently launched token available to probe");
    const { body: trendingBody } = await fetchJson(
      "/api/v1/tokens?limit=1&sort=trending",
    );
    const topTrending = trendingBody?.data?.[0]?.address;
    if (
      topTrending &&
      newest.toLowerCase() === topTrending.toLowerCase()
    ) {
      skip("newest == top trending — already covered by previous probe");
    }
    await probeChartAddress(newest);
  });
}

// ─── Runner ──────────────────────────────────────────────────────────

async function waitForServer() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/`);
      if (res.ok) return;
    } catch {
      // not ready
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Worker not ready after ${STARTUP_TIMEOUT_MS / 1000}s`);
}

async function main() {
  console.log("Starting wrangler dev for smoke test...\n");

  const child = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let exitCode = null;
  child.on("exit", (code) => { exitCode = code; });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
    process.stdout.write(`[wrangler] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
    process.stderr.write(`[wrangler] ${chunk}`);
  });

  try {
    databaseReadiness = await getDatabaseReadiness(databaseUrl);
    console.log(
      "Database readiness:",
      `available=${databaseReadiness.available ? "yes" : "no"}`,
      `token_balance=${databaseReadiness.tokenBalance ? "present" : "missing"}`,
      `wallet_position=${databaseReadiness.walletPosition ? "present" : "missing"}`,
      databaseReadiness.reason ? `reason=${databaseReadiness.reason}` : "",
    );

    await sleep(2_000);
    if (exitCode !== null) {
      throw new Error(`Wrangler exited immediately with code ${exitCode}.\n${output.slice(-2000)}`);
    }

    console.log("Waiting for Worker...");
    await waitForServer();
    console.log("Worker ready — running tests:");

    await runTests();

    console.log(
      `\n${passed + failed + skipped} tests: ${passed} passed, ${failed} failed, ${skipped} skipped`,
    );
    if (failed > 0) process.exitCode = 1;
  } catch (err) {
    console.error(`\nSmoke test FAILED: ${err.message}`);
    if (output) {
      console.error("\nWrangler output (last 2000 chars):");
      console.error(output.slice(-2000));
    }
    process.exitCode = 1;
  } finally {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already dead */ }
    const exited = await Promise.race([
      new Promise((r) => child.on("exit", r)),
      sleep(3_000).then(() => null),
    ]);
    if (exited === null) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already dead */ }
    }
    process.exit(process.exitCode ?? 0);
  }
}

main();
