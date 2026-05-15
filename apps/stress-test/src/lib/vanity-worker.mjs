/**
 * Worker-thread entrypoint for vanity mining. We keep the worker itself
 * as plain ESM so Node can load it directly, then register tsx inside
 * the worker before importing the TypeScript mining loop.
 */

import { parentPort, workerData } from "node:worker_threads";
import { register } from "tsx/esm/api";

register();

const { runMiningLoop } = await import("./vanity-core.ts");

if (!parentPort) {
  throw new Error(
    "vanity-worker.mjs must be spawned as a Worker — `parentPort` is null on the main thread.",
  );
}

try {
  const result = runMiningLoop(workerData);
  parentPort.postMessage({ ok: true, result });
} catch (err) {
  parentPort.postMessage({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  });
}
