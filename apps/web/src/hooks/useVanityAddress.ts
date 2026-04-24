import { useCallback, useEffect, useRef, useState } from "react";

import { VANITY_SUFFIX } from "@launchpad/shared";
import { getAddress, type Address, type Hex } from "viem";

import { useWallet } from "./useWallet";
import { ADDRESSES } from "../contracts/addresses";

import type { WorkerOutbound } from "../workers/vanity.worker";

export type VanityStatus =
  | "idle" // no wallet connected, no mining
  | "mining" // workers are searching
  | "found" // a salt has been mined
  | "error"; // worker spawn failed (extremely rare)

export interface VanityResult {
  /** Salt to pass into `LaunchParams.salt`. Always vanity. */
  salt: Hex;
  /** Predicted token address — purely informational for the UI. */
  address: Address;
}

export interface UseVanityAddressReturn {
  status: VanityStatus;
  result: VanityResult | null;
  attempts: number;
  /** Total ms since mining started; resets on each restart. */
  elapsedMs: number;
  /**
   * Resolves once the miner has found a vanity salt. There is *no fallback* —
   * `Bonding._deployAndSeed` enforces the `VANITY_SUFFIX` invariant on-chain
   * and would revert with `NotVanityAddress` for any other salt. The promise
   * never settles to a "random" salt.
   */
  ensureSalt: () => Promise<VanityResult>;
  /** Imperative restart (e.g. after impl rotation or wallet change). */
  restart: () => void;
}

/**
 * Spawns one Web Worker per CPU core and races them to find a salt that
 * deploys the user's FERC20 clone to a vanity address ending in
 * `VANITY_SUFFIX`. Starts as soon as the wallet is connected so by the
 * time the user clicks "Launch" the salt is usually already mined
 * (~50-300ms with a worker pool).
 *
 * No fallback path: every launched token MUST have the vanity suffix to
 * satisfy the on-chain invariant in `Bonding`. If mining hasn't completed
 * by the time the user clicks Launch, `ensureSalt` waits — the UI surfaces
 * a "FINDING YOUR ADDRESS…" state for as long as that takes.
 */
export function useVanityAddress(): UseVanityAddressReturn {
  const { address } = useWallet();

  const [status, setStatus] = useState<VanityStatus>("idle");
  const [result, setResult] = useState<VanityResult | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  const workersRef = useRef<Worker[]>([]);
  const startTimeRef = useRef<number>(0);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Pending listeners waiting on `ensureSalt`. We keep a list so multiple
  // simultaneous awaiters (rare, but possible if a user double-clicks
  // Launch) all settle from the same terminal event. Each entry holds both
  // halves of the promise so a `teardown` (wallet disconnect, restart,
  // unmount) can reject them instead of leaving callers hanging.
  const pendingResolversRef = useRef<
    Array<{
      resolve: (r: VanityResult) => void;
      reject: (err: Error) => void;
    }>
  >([]);

  const teardown = useCallback(() => {
    workersRef.current.forEach((w) => {
      try {
        w.postMessage({ type: "stop" });
      } catch {
        // Worker might already be terminated; ignore.
      }
      w.terminate();
    });
    workersRef.current = [];
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    // Cancel any in-flight `ensureSalt` awaiters. If the user disconnects
    // their wallet (or the component unmounts) while Launch is pending,
    // the caller's `await` would otherwise never settle — the miner is
    // gone but no `found` event is ever going to arrive. On `found` the
    // resolvers array is drained *before* teardown, so this is a no-op
    // in the happy path.
    if (pendingResolversRef.current.length > 0) {
      const pending = pendingResolversRef.current;
      pendingResolversRef.current = [];
      pending.forEach(({ reject }) =>
        reject(new Error("Vanity mining was cancelled.")),
      );
    }
  }, []);

  const start = useCallback(
    (creator: Address) => {
      teardown();
      setStatus("mining");
      setResult(null);
      setAttempts(0);
      setElapsedMs(0);
      startTimeRef.current = performance.now();

      tickIntervalRef.current = setInterval(() => {
        setElapsedMs(performance.now() - startTimeRef.current);
      }, 100);

      // `Web Worker` constructor support: we wrap in try/catch because some
      // restricted browser contexts (sandboxed iframes, very old browsers)
      // can't spawn workers. In that case we transition to "error" — the
      // launch button stays disabled until the user retries on a browser
      // that supports workers. There's no random-salt fallback because the
      // contract enforces the vanity suffix.
      let workers: Worker[] = [];
      try {
        const cores = Math.min(
          Math.max(navigator.hardwareConcurrency ?? 4, 1),
          8, // Cap at 8: more workers means more startup overhead than gain
          //   for sub-second searches.
        );
        for (let i = 0; i < cores; i++) {
          // Vite handles this `new URL(..., import.meta.url)` form natively
          // — it bundles the worker as a separate chunk and serves it with
          // the right MIME type in dev.
          const worker = new Worker(
            new URL("../workers/vanity.worker.ts", import.meta.url),
            { type: "module" },
          );
          worker.addEventListener(
            "message",
            (event: MessageEvent<WorkerOutbound>) => {
              const msg = event.data;
              // Both `progress` and `found` carry `attemptsDelta` (work done
              // since this worker's previous tick). Summing the deltas across
              // every worker's events gives a correct pool-wide total without
              // the hook needing per-worker state. The worker contract
              // guarantees deltas never overlap.
              if (msg.type === "progress") {
                setAttempts((prev) => prev + msg.attemptsDelta);
              } else if (msg.type === "found") {
                setAttempts((prev) => prev + msg.attemptsDelta);
                const winning: VanityResult = {
                  salt: msg.salt,
                  address: getAddress(msg.address),
                };
                setResult(winning);
                setStatus("found");
                // Drain resolvers *before* teardown so the cancel-on-teardown
                // path doesn't turn a legitimate `found` into a rejection.
                const pending = pendingResolversRef.current;
                pendingResolversRef.current = [];
                pending.forEach(({ resolve }) => resolve(winning));
                teardown();
              }
            },
          );
          worker.postMessage({
            type: "init",
            implementation: ADDRESSES.ferc20Implementation,
            bondingProxy: ADDRESSES.bonding,
            creator,
            suffix: VANITY_SUFFIX,
            workerIndex: i,
            workerCount: cores,
          });
          workers.push(worker);
        }
      } catch {
        workers.forEach((w) => w.terminate());
        workers = [];
        setStatus("error");
      }

      workersRef.current = workers;
    },
    [teardown],
  );

  const restart = useCallback(() => {
    if (!address) return;
    start(getAddress(address));
  }, [address, start]);

  // Auto-start on wallet connect, auto-tear-down on disconnect or unmount.
  useEffect(() => {
    if (!address) {
      teardown();
      setStatus("idle");
      setResult(null);
      return;
    }
    start(getAddress(address));
    return () => {
      teardown();
    };
  }, [address, start, teardown]);

  const ensureSalt = useCallback((): Promise<VanityResult> => {
    if (result) {
      return Promise.resolve(result);
    }

    return new Promise<VanityResult>((resolve, reject) => {
      // If mining errored (worker spawn failed), reject immediately so the
      // UI can surface the error rather than hang forever.
      if (status === "error") {
        reject(
          new Error(
            "Vanity address miner failed to start. Please refresh and try again.",
          ),
        );
        return;
      }
      pendingResolversRef.current.push({ resolve, reject });
    });
  }, [result, status]);

  return {
    status,
    result,
    attempts,
    elapsedMs,
    ensureSalt,
    restart,
  };
}
