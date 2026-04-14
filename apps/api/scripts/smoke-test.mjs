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

const PORT = 8799;
const BASE_URL = `http://localhost:${PORT}`;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 10_000;

const TEST_TOKEN = "0x26F8ED8C7548e066Bea4A86412aD7f099E30caBb";
const TEST_CREATOR = "0x681E6a109e586bAE0FD5e4b5aCad8e20E0e600BA";
const NONEXISTENT_ADDRESS = "0x0000000000000000000000000000000000000001";

// Check if DATABASE_URL is available
const devVarsPath = new URL("../.dev.vars", import.meta.url).pathname;
const hasDb = existsSync(devVarsPath) &&
  readFileSync(devVarsPath, "utf8").includes("DATABASE_URL=");

if (!hasDb) {
  console.log("DATABASE_URL not in .dev.vars — skipping API smoke test");
  process.exit(0);
}

let passed = 0;
let failed = 0;

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

  await test("GET /api/v1/tokens returns list", async () => {
    const { res, body } = await fetchJson("/api/v1/tokens?limit=10&offset=0");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(body.data), "Expected array");
    assert(body.data.length >= 1, "Expected at least 1 token");
  });

  await test("Token has expected shape", async () => {
    const { body } = await fetchJson("/api/v1/tokens?limit=1&offset=0");
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

  await test("GET /api/v1/tokens/search finds by name", async () => {
    const { res, body } = await fetchJson("/api/v1/tokens/search?q=E2E");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body.data.length >= 1, "Expected at least 1 result");
  });

  await test("Search returns empty for no matches", async () => {
    const { body } = await fetchJson("/api/v1/tokens/search?q=zzzznonexistent");
    assert(body.data.length === 0, "Expected empty array");
  });

  await test("GET /api/v1/tokens/:address returns detail", async () => {
    const { res, body } = await fetchJson(`/api/v1/tokens/${TEST_TOKEN}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body.data.address === TEST_TOKEN, `Wrong address: ${body.data.address}`);
    assert(body.data.name === "E2E Test Token", `Wrong name: ${body.data.name}`);
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

  console.log("\n--- Comments (DB) ---\n");

  await test("GET /api/v1/tokens/:address/comments returns list", async () => {
    const { res, body } = await fetchJson(`/api/v1/tokens/${TEST_TOKEN}/comments`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(body.data), "Expected array");
    assert(body.data.length >= 1, "Expected at least 1 comment");
    assert("content" in body.data[0], "Missing content");
    assert("author" in body.data[0], "Missing author");
  });

  await test("Comments empty for unknown token", async () => {
    const { res, body } = await fetchJson(`/api/v1/tokens/${NONEXISTENT_ADDRESS}/comments`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body.data.length === 0, "Expected empty array");
  });

  console.log("\n--- Creators (DB) ---\n");

  await test("GET /api/v1/creators/:address returns profile", async () => {
    const { res, body } = await fetchJson(`/api/v1/creators/${TEST_CREATOR}`);
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
    assert(body.data.address === NONEXISTENT_ADDRESS, "Wrong address");
    assert(body.data.displayName === null, "Expected null displayName");
  });

  await test("Profile returns 400 for bad address", async () => {
    const { res } = await fetchJson("/api/v1/profiles/bad");
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  console.log("\n--- Ponder degradation ---\n");

  await test("GET /api/v1/trades returns 503 without indexer", async () => {
    const { res } = await fetchJson("/api/v1/trades?limit=5");
    assert(res.status === 503, `Expected 503, got ${res.status}`);
  });

  await test("GET /api/v1/stats returns degraded data", async () => {
    const { res, body } = await fetchJson("/api/v1/stats");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert("totalTokens" in body.data, "Missing totalTokens");
    assert(body.dataSource === "degraded", `Expected degraded, got ${body.dataSource}`);
  });

  await test("GET /api/v1/holders/:address returns 503", async () => {
    const { res } = await fetchJson(`/api/v1/holders/${TEST_TOKEN}`);
    assert(res.status === 503, `Expected 503, got ${res.status}`);
  });

  await test("GET /api/v1/security/:address returns fallback", async () => {
    const { res, body } = await fetchJson(`/api/v1/security/${TEST_TOKEN}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert("contractVerified" in body.data, "Missing contractVerified");
  });

  await test("GET /api/v1/trades/sparkline/:address returns empty", async () => {
    const { res, body } = await fetchJson(`/api/v1/trades/sparkline/${TEST_TOKEN}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body.data.length === 0, "Expected empty array");
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
    await sleep(2_000);
    if (exitCode !== null) {
      throw new Error(`Wrangler exited immediately with code ${exitCode}.\n${output.slice(-2000)}`);
    }

    console.log("Waiting for Worker...");
    await waitForServer();
    console.log("Worker ready — running tests:");

    await runTests();

    console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } catch (err) {
    console.error(`\nSmoke test FAILED: ${err.message}`);
    if (output) {
      console.error("\nWrangler output (last 2000 chars):");
      console.error(output.slice(-2000));
    }
    process.exitCode = 1;
  } finally {
    child.kill("SIGTERM");
    const exited = await Promise.race([
      new Promise((r) => child.on("exit", r)),
      sleep(3_000).then(() => null),
    ]);
    if (exited === null) child.kill("SIGKILL");
  }
}

main();
