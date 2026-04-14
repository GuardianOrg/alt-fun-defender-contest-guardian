/**
 * Indexer smoke test — starts ponder dev with a far-future start block,
 * waits for the GraphQL server, and runs a query against every table
 * to verify the schema is intact and the server boots cleanly.
 *
 * Requires PONDER_RPC_URL_999 to be set (skips gracefully if missing).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 42069;
const BASE_URL = `http://localhost:${PORT}`;
const STARTUP_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 3_000;

if (!process.env.PONDER_RPC_URL_999) {
  console.log("PONDER_RPC_URL_999 not set — skipping indexer smoke test");
  process.exit(0);
}

/**
 * Resolve the ponder binary from node_modules rather than relying on npx,
 * which may try to download the wrong package (`ponder` vs `@ponder/core`).
 */
function findPonderBin() {
  const candidates = [
    resolve("node_modules", ".bin", "ponder"),
    resolve("..", "..", "node_modules", ".bin", "ponder"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "ponder";
}

async function gql(url, query) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function waitForServer() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  const endpoints = [BASE_URL, `${BASE_URL}/graphql`];

  while (Date.now() < deadline) {
    for (const url of endpoints) {
      try {
        const res = await gql(url, "{ _meta { status } }");
        if (res.data?._meta) {
          return url;
        }
      } catch {
        // server not ready yet
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Ponder server not ready after ${STARTUP_TIMEOUT_MS / 1000}s`,
  );
}

const SMOKE_QUERIES = [
  {
    name: "tokens",
    query: `{ tokens(limit: 1) { items { address name symbol creator } totalCount } }`,
  },
  {
    name: "trades",
    query: `{ trades(limit: 1) { items { id tokenAddress trader isBuy } totalCount } }`,
  },
  {
    name: "routerTrades",
    query: `{ routerTrades(limit: 1) { items { id tokenAddress trader isBuy } totalCount } }`,
  },
  {
    name: "graduations",
    query: `{ graduations(limit: 1) { items { tokenAddress pairAddress liquidity } totalCount } }`,
  },
  {
    name: "referrals",
    query: `{ referrals(limit: 1) { items { id referrer trader } totalCount } }`,
  },
  {
    name: "feeClaims",
    query: `{ feeClaims(limit: 1) { items { id claimer amount } totalCount } }`,
  },
  {
    name: "swaps",
    query: `{ swaps(limit: 1) { items { id pairAddress sender to } totalCount } }`,
  },
  {
    name: "pairReserves",
    query: `{ pairReserves(limit: 1) { items { pairAddress reserve0 reserve1 } totalCount } }`,
  },
];

async function runSmokeQueries(graphqlUrl) {
  let passed = 0;
  for (const { name, query } of SMOKE_QUERIES) {
    const result = await gql(graphqlUrl, query);
    if (result.errors) {
      throw new Error(
        `Query "${name}" failed: ${JSON.stringify(result.errors)}`,
      );
    }
    if (!result.data?.[name]) {
      throw new Error(`Query "${name}" returned no data field`);
    }
    const count = result.data[name].totalCount;
    console.log(`  OK  ${name} (${count} records)`);
    passed++;
  }
  return passed;
}

async function main() {
  const bin = findPonderBin();
  console.log(`Ponder binary: ${bin}`);
  console.log("Starting Ponder dev server for smoke test...\n");

  const child = spawn(bin, ["dev"], {
    env: {
      ...process.env,
      // Far-future start block so ponder boots without indexing real data
      BONDING_START_BLOCK: "999999999",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let exitCode = null;
  child.on("exit", (code) => {
    exitCode = code;
  });

  // Stream ponder output for CI visibility
  let ponderOutput = "";
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    ponderOutput += text;
    process.stdout.write(`[ponder] ${text}`);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    ponderOutput += text;
    process.stderr.write(`[ponder:err] ${text}`);
  });

  try {
    // Give ponder a moment to crash if the binary is wrong
    await sleep(3_000);
    if (exitCode !== null) {
      throw new Error(
        `Ponder exited immediately with code ${exitCode}.\n${ponderOutput.slice(-2000)}`,
      );
    }

    console.log("Waiting for GraphQL server...");
    const graphqlUrl = await waitForServer();
    console.log(`Server ready at ${graphqlUrl} — running queries:\n`);

    const passed = await runSmokeQueries(graphqlUrl);
    console.log(
      `\nSmoke test passed (${passed}/${SMOKE_QUERIES.length} queries OK)`,
    );
  } catch (err) {
    console.error(`\nSmoke test FAILED: ${err.message}`);
    if (ponderOutput) {
      console.error("\nPonder output (last 2000 chars):");
      console.error(ponderOutput.slice(-2000));
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
