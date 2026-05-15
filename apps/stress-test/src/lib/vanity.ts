/**
 * Public vanity-mining API. Spawns a dedicated `node:worker_threads`
 * Worker per mine so multiple concurrent miners actually run on
 * different CPU cores instead of time-slicing a single JS event loop.
 *
 * Why this matters for the harness
 * --------------------------------
 * Single-threaded throughput is ~45k attempts/sec, bound by viem's
 * pure-JS keccak256. At the production 5-zero suffix that's a mean of
 * ~22s per mine. With `--concurrency K` running on the same thread,
 * each mine only sees ~1/K of that throughput, so a `--concurrency 10`
 * run had each mine taking ~3.5 minutes — observably indistinguishable
 * from "stuck" until the first iteration finally completes.
 *
 * Worker threads fix it: K concurrent mines run on K cores (capped by
 * `os.availableParallelism()`), each at full single-thread throughput.
 * On an 8-core laptop that's ~22s per mine at concurrency 8 — same
 * shape as concurrency 1, just K-wide.
 *
 * Per-mine spawn cost is ~50ms — negligible against the mining work
 * itself, so we prefer a one-shot worker over a pool for lifecycle
 * simplicity.
 */

import { Worker } from "node:worker_threads";

import { runMiningLoop, type MineParams, type MinedSalt } from "./vanity-core.ts";

export type { MineParams, MinedSalt } from "./vanity-core.ts";

interface WorkerMessage {
  ok: boolean;
  result?: MinedSalt;
  error?: string;
}

/**
 * Mine a vanity salt. Returns a Promise that resolves with the mined
 * salt + predicted address. Always dispatches to a worker thread —
 * the main thread stays free for I/O (API calls, RPC reads, receipt
 * waits) while the mine runs in parallel on another core.
 */
export function mineVanitySalt(params: MineParams): Promise<MinedSalt> {
  return new Promise<MinedSalt>((resolve, reject) => {
    const workerUrl = new URL("./vanity-worker.mjs", import.meta.url);
    const worker = new Worker(workerUrl, { workerData: params });

    // `settled` collapses the three event listeners into one
    // resolution. Without it, the previous code only rejected on
    // non-zero exit codes — a worker that exited cleanly (code 0)
    // before its `postMessage` reached the parent would leave the
    // Promise pending forever, freezing the iteration. CodeRabbit
    // flagged the case on PR #736; can't reproduce reliably (the
    // race window is microseconds wide between worker `process.exit`
    // and parent message receipt) but the failure mode is bad
    // enough that the guard is cheap insurance.
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    worker.once("message", (msg: WorkerMessage) => {
      void worker.terminate();
      if (msg.ok && msg.result) {
        const result = msg.result;
        settle(() => resolve(result));
      } else {
        settle(() =>
          reject(new Error(msg.error ?? "Vanity worker failed without a message")),
        );
      }
    });

    worker.once("error", (err) => {
      void worker.terminate();
      settle(() => reject(err));
    });

    worker.once("exit", (code) => {
      // Reject on ANY exit that lands before a `message` settled the
      // promise — clean exits without a result are just as much of a
      // hang as crashes if we don't reject. Exits that follow a
      // resolved `message` no-op via the `settled` guard.
      settle(() =>
        reject(
          new Error(
            `Vanity worker exited (code ${code ?? "null"}) without posting a result`,
          ),
        ),
      );
    });
  });
}

/**
 * Synchronous in-process miner. Exposed for callers that genuinely
 * need a sync result and don't care about parallelism (CLI smoke
 * tests, one-off scripts). The harness uses `mineVanitySalt` above —
 * NOT this function — so per-iteration parallelism actually
 * materialises across cores.
 */
export function mineVanitySaltSync(params: MineParams): MinedSalt {
  return runMiningLoop(params);
}
