/**
 * Worker-thread entrypoint for vanity mining. Loaded by `vanity.ts`
 * via `new Worker(new URL("./vanity-worker.ts", import.meta.url))` —
 * tsx's loader hook propagates to spawned workers, so the `.ts` URL
 * works without a separate build step.
 *
 * One-shot: receives `MineParams` via `workerData`, runs the loop, posts
 * the result (or error) back, and exits. The parent calls `.terminate()`
 * once it has the result. We could pool workers and reuse them, but the
 * spawn cost is ~50ms — negligible against a mine that takes 20+ seconds
 * — and one-shot keeps the lifecycle plainly correct.
 */

import { parentPort, workerData } from "node:worker_threads";

import { runMiningLoop, type MineParams } from "./vanity-core.ts";

if (!parentPort) {
  throw new Error(
    "vanity-worker.ts must be spawned as a Worker — `parentPort` is null on the main thread.",
  );
}

try {
  const result = runMiningLoop(workerData as MineParams);
  parentPort.postMessage({ ok: true, result });
} catch (err) {
  parentPort.postMessage({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  });
}
