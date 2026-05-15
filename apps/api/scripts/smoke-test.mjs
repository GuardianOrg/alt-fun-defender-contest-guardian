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

async function getIndexerViewAvailability(connectionString) {
  try {
    const sql = neon(connectionString);
    const [row] = await sql`
      SELECT
        to_regclass('ponder_views.token_balance')::text AS token_balance,
        to_regclass('ponder_views.wallet_position')::text AS wallet_position
    `;
    return {
      tokenBalance: typeof row?.token_balance === "string",
      walletPosition: typeof row?.wallet_position === "string",
    };
  } catch (error) {
    console.warn(
      "Could not probe ponder_views availability before smoke test; leaving all endpoint checks enabled",
      error instanceof Error ? error.message : String(error),
    );
    return {
      tokenBalance: true,
      walletPosition: true,
    };
  }
}

if (!databaseUrl) {
  console.log("DATABASE_URL is unset or empty — skipping API smoke test");
  process.exit(0);
}

let passed = 0;
let failed = 0;
let skipped = 0;
let indexerViewAvailability = {
  tokenBalance: true,
  walletPosition: true,
};

function describeMissingIndexerViews() {
  const missing = [];
  if (!indexerViewAvailability.tokenBalance) missing.push("ponder_views.token_balance");
  if (!indexerViewAvailability.walletPosition) missing.push("ponder_views.wallet_position");
  return missing.join(", ");
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
    const { res, body } = await fetchJson("/api/v1/tokens?limit=10&offset=0");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(body.data), "Expected array");
    if (body.data.length >= 1) {
      discoveredToken = body.data[0].address;
      discoveredCreator = body.data[0].creator;
    }
  });

  await test("Token has expected shape", async () => {
    const { body } = await fetchJson("/api/v1/tokens?limit=1&offset=0");
    if (body.data.length === 0) skip("DB has no tokens");
    const t = body.data[0];
    for (const key of ["address", "name", "ticker", "leverage", "underlying", "status", "creator", "createdAt"]) {
      assert(key in t, `Missing property: ${key}`);
    }
  });

  await test("Token list respects limit", async () => {
    const { body } = await fetchJson("/api/v1/tokens?limit=1&offset=0");
    assert(body.data.length <= 1, `Expected <=1, got ${body.data.length}`);
  });

  await test("Token list filters by status", async () => {
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
    const { body } = await fetchJson("/api/v1/tokens/search?q=zzzznonexistent");
    assert(body.data.length === 0, "Expected empty array");
  });

  await test("GET /api/v1/tokens/:address returns detail", async () => {
    if (!discoveredToken) skip("DB has no tokens");
    const { res, body } = await fetchJson(`/api/v1/tokens/${discoveredToken}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body.data.address === discoveredToken, `Wrong address: ${body.data.address}`);
    assert(typeof body.data.name === "string" && body.data.name.length > 0, "Expected non-empty name");
    assert("curveFilled" in body.data, "Missing curveFilled");
    assert("curveSupply" in body.data, "Missing curveSupply");
  });

  await test("Token detail returns 404 for unknown", async () => {
    const { res } = await fetchJson(`/api/v1/tokens/${NONEXISTENT_ADDRESS}`);
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  await test("Token detail returns 400 for invalid address", async () => {
    const { res } = await fetchJson("/api/v1/tokens/not-an-address");
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  console.log("\n--- Creators (DB) ---\n");

  await test("GET /api/v1/creators/:address returns profile", async () => {
    if (!discoveredCreator) skip("DB has no creators");
    const { res, body } = await fetchJson(`/api/v1/creators/${discoveredCreator}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body.data.tokens.length >= 1, "Expected at least 1 token");
    assert(body.data.stats.tokensCreated >= 1, "Expected tokensCreated >= 1");
    assert("totalVolume" in body.data.stats, "Missing totalVolume");
  });

  await test("Creator returns empty for unknown address", async () => {
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
    const { res, body } = await fetchJson("/api/v1/trades?limit=5");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(body.data), "Expected `data` to be an array");
  });

  await test("GET /api/v1/stats serves live counters without Ponder", async () => {
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
    if (!indexerViewAvailability.tokenBalance) {
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
    if (!indexerViewAvailability.tokenBalance || !indexerViewAvailability.walletPosition) {
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
    if (!discoveredToken) skip("DB has no tokens");
    const { res, body } = await fetchJson(`/api/v1/security/${discoveredToken}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert("contractVerified" in body.data, "Missing contractVerified");
  });

  await test("GET /api/v1/trades/sparkline/:address returns empty", async () => {
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
    indexerViewAvailability = await getIndexerViewAvailability(databaseUrl);
    console.log(
      "Indexer stable views:",
      `token_balance=${indexerViewAvailability.tokenBalance ? "present" : "missing"}`,
      `wallet_position=${indexerViewAvailability.walletPosition ? "present" : "missing"}`,
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
