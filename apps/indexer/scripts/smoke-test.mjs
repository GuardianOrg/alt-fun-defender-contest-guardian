/**
 * Indexer smoke test — starts ponder dev with a far-future start block,
 * waits for the GraphQL server, and runs a query against every table
 * to verify the schema is intact and the server boots cleanly.
 *
 * Requires PONDER_RPC_URL_999 to be set (skips gracefully if missing).
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 42069;
const BASE_URL = `http://localhost:${PORT}`;
const STARTUP_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;

if (!process.env.PONDER_RPC_URL_999) {
  console.log("PONDER_RPC_URL_999 not set — skipping indexer smoke test");
  process.exit(0);
}

async function gql(query) {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function waitForServer() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await gql("{ _meta { status } }");
      if (res.data?._meta) return;
    } catch {
      // server not ready yet
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
  {
    name: "ltExchangeRates",
    query: `{ ltExchangeRates(limit: 1) { items { id ltAddress rate } totalCount } }`,
  },
];

async function runSmokeQueries() {
  let passed = 0;
  for (const { name, query } of SMOKE_QUERIES) {
    const result = await gql(query);
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
  console.log("Starting Ponder dev server for smoke test...\n");

  const child = spawn("npx", ["ponder", "dev"], {
    env: {
      ...process.env,
      // Far-future start block so ponder boots without indexing real data
      BONDING_START_BLOCK: "999999999",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let exitedEarly = false;
  child.on("exit", (code) => {
    if (code !== null && code !== 0) exitedEarly = true;
  });

  let ponderStderr = "";
  child.stderr.on("data", (chunk) => {
    ponderStderr += chunk.toString();
  });

  try {
    console.log("Waiting for GraphQL server...");
    await waitForServer();

    if (exitedEarly) {
      throw new Error(
        `Ponder exited before queries ran.\nstderr: ${ponderStderr.slice(-1000)}`,
      );
    }

    console.log("Server ready — running queries:\n");
    const passed = await runSmokeQueries();
    console.log(
      `\nSmoke test passed (${passed}/${SMOKE_QUERIES.length} queries OK)`,
    );
  } catch (err) {
    console.error(`\nSmoke test FAILED: ${err.message}`);
    if (ponderStderr) {
      console.error("\nPonder stderr (last 1000 chars):");
      console.error(ponderStderr.slice(-1000));
    }
    process.exitCode = 1;
  } finally {
    child.kill("SIGTERM");
    await sleep(2_000);
    if (!child.killed) child.kill("SIGKILL");
  }
}

main();
