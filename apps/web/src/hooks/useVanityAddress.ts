import { useCallback, useEffect, useRef, useState } from "react";

import { VANITY_SUFFIX } from "@launchpad/shared";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";

import { useWallet } from "./useWallet";
import { hyperEVM } from "../config/chains";
import { BondingAbi } from "../contracts/abis";
import { ADDRESSES } from "../contracts/addresses";

import type { WorkerOutbound } from "../workers/vanity.worker";

// Dedicated read-only client for the impl lookup. Mirrors the per-hook
// pattern in `useGraduationThreshold` etc. — the read is infrequent and
// doesn't justify a shared client.
const rpcUrl = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl),
});

// `Bonding.tokenImplementation` is owner-rotatable via `setTokenImplementation`
// (see `Bonding.sol:497`) — explicitly designed to be hot-swapped to ship a
// new FERC20 without disturbing already-launched tokens. If we hardcoded the
// impl into worker init, every launch would silently revert with
// `NotVanityAddress` after a rotation (the miner would compute salts against
// the stale `initCodeHash`) until every user refreshed against a redeployed
// frontend. Reading it from chain on hook init closes that gap.
//
// We deliberately *don't* read `VANITY_SUFFIX()` from chain — it's a
// `bytes2 public constant` baked into bytecode (`Bonding.sol:110`), so the
// only way it changes is a Bonding redeploy, which already requires bumping
// the `@launchpad/shared` constant.
const IMPL_STALE_MS = 5 * 60 * 1000;
const IMPL_GC_MS = 30 * 60 * 1000;

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
// Single user-facing message for any miner failure (spawn-time or runtime).
// Both paths land the hook in `status === "error"` and pending callers see
// the same message — distinguishing between "couldn't construct Worker" and
// "Worker threw at runtime" doesn't help the user, the remediation is the
// same.
const MINER_ERROR_MESSAGE =
  "Vanity address miner failed. Please refresh and try again.";

export function useVanityAddress(): UseVanityAddressReturn {
  const { address } = useWallet();

  // Live `Bonding.tokenImplementation`. On RPC failure (`isError`) we fall
  // back to the compile-time address rather than refusing to mine — that's
  // strictly better than blocking, since the only thing the user loses is
  // resilience against a *concurrent* impl rotation. The pre-existing
  // hardcoded behaviour was the same fallback; we're only adding the
  // happy-path read.
  const implQuery = useQuery({
    queryKey: ["bondingTokenImplementation", ADDRESSES.bonding],
    queryFn: async (): Promise<Address> => {
      const impl = (await hyperEvmClient.readContract({
        address: ADDRESSES.bonding,
        abi: BondingAbi,
        functionName: "tokenImplementation",
      })) as Address;
      return getAddress(impl);
    },
    staleTime: IMPL_STALE_MS,
    gcTime: IMPL_GC_MS,
  });
  const effectiveImpl: Address | undefined = implQuery.data
    ? implQuery.data
    : implQuery.isError
      ? getAddress(ADDRESSES.ferc20Implementation)
      : undefined;

  const [status, setStatus] = useState<VanityStatus>("idle");
  const [result, setResult] = useState<VanityResult | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  const workersRef = useRef<Worker[]>([]);
  const startTimeRef = useRef<number>(0);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks the (creator, impl) pair that the currently-running pool was
  // spawned for. Lets the auto-start effect skip spurious re-spawns when
  // TanStack Query refetches and returns an unchanged impl — without this
  // guard, the periodic refetch could discard a `found` result and force
  // the user to wait for re-mining for no reason.
  const lastSpawnRef = useRef<{ creator: Address; impl: Address } | null>(null);
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
    (creator: Address, implementation: Address) => {
      teardown();
      setStatus("mining");
      setResult(null);
      setAttempts(0);
      setElapsedMs(0);
      startTimeRef.current = performance.now();

      tickIntervalRef.current = setInterval(() => {
        setElapsedMs(performance.now() - startTimeRef.current);
      }, 100);

      // Shared failure path for any worker crash *after* spawn (uncaught
      // exception in the hot loop, missing `crypto.getRandomValues`, CSP
      // killing module load, structured-clone failure on postMessage, …).
      // Without this the hook would stay in "mining" forever and any
      // pending `ensureSalt` await would never settle, leaving the UI
      // stuck on "FINDING YOUR ADDRESS…".
      //
      // Guarded by `workersRef.current.length` so a late stray error from
      // a sibling worker — fired *after* a successful `found` already
      // tore down the pool — can't clobber `status: "found"` back to
      // "error". Teardown is the canonical "we're done" signal.
      const handlePoolFailure = (err: unknown) => {
        if (workersRef.current.length === 0) return;
        console.error("[useVanityAddress] worker failed at runtime", err);
        setStatus("error");
        // Drain *before* teardown so awaiters get the specific runtime
        // error rather than the generic "cancelled" message teardown
        // emits when it finds resolvers still pending.
        const pending = pendingResolversRef.current;
        pendingResolversRef.current = [];
        pending.forEach(({ reject }) => reject(new Error(MINER_ERROR_MESSAGE)));
        teardown();
      };

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
          // `error` fires for uncaught exceptions inside the worker
          // (including module-load failures). `messageerror` fires when a
          // posted message can't be deserialized — vanishingly rare for
          // our plain-object protocol, but listening costs nothing and
          // closes a hang vector.
          worker.addEventListener("error", (event) => {
            // Stop the event from bubbling to `window.onerror` — we've
            // already handled it and don't want it surfacing as an
            // uncaught error in the host page.
            event.preventDefault();
            handlePoolFailure(event.error ?? event.message ?? event);
          });
          worker.addEventListener("messageerror", () => {
            handlePoolFailure(
              new Error("Vanity worker posted an undeserializable message"),
            );
          });
          worker.postMessage({
            type: "init",
            implementation,
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

  const refetchImpl = implQuery.refetch;
  // Manual restart bypasses the TanStack `staleTime` cache by forcing a
  // refetch — the whole point of `restart` is "I think state may be stale,
  // give me a clean slate". Without the refetch, a user hitting Restart
  // within 5min of a previous read would still spawn against a potentially
  // outdated impl, defeating the rotation safety we're adding here.
  const restart = useCallback(() => {
    if (!address) return;
    setStatus("mining");
    void (async () => {
      let fresh: Address;
      try {
        const result = await refetchImpl();
        fresh = result.data ?? getAddress(ADDRESSES.ferc20Implementation);
      } catch {
        fresh = getAddress(ADDRESSES.ferc20Implementation);
      }
      const creator = getAddress(address);
      lastSpawnRef.current = { creator, impl: fresh };
      start(creator, fresh);
    })();
  }, [address, refetchImpl, start]);

  // Auto-start on wallet connect, auto-tear-down on disconnect or unmount.
  // Also re-spawns if the on-chain impl rotates mid-session (TanStack
  // refetches every 5min) — `lastSpawnRef` ensures we only restart when
  // (creator, impl) actually changed, so a refetch returning the same impl
  // doesn't discard an in-progress mine or a `found` result.
  useEffect(() => {
    if (!address) {
      teardown();
      setStatus("idle");
      setResult(null);
      lastSpawnRef.current = null;
      return;
    }
    // Show "mining" eagerly so the LivePreview spinner doesn't blip back to
    // the idle "—" placeholder during the (sub-second) impl read on first
    // wallet connect. The timer / attempt counter still only start when
    // workers actually spawn, which keeps the displayed hashrate accurate.
    if (!effectiveImpl) {
      setStatus((prev) => (prev === "found" ? prev : "mining"));
      return;
    }

    const creator = getAddress(address);
    const last = lastSpawnRef.current;
    if (last && last.creator === creator && last.impl === effectiveImpl) {
      return;
    }

    lastSpawnRef.current = { creator, impl: effectiveImpl };
    start(creator, effectiveImpl);
    return () => {
      teardown();
    };
  }, [address, effectiveImpl, start, teardown]);

  const ensureSalt = useCallback((): Promise<VanityResult> => {
    if (result) {
      return Promise.resolve(result);
    }

    return new Promise<VanityResult>((resolve, reject) => {
      // If mining errored (spawn failure or runtime crash in a worker),
      // reject immediately so the UI can surface the error rather than
      // hang forever waiting on a `found` event that's never coming.
      if (status === "error") {
        reject(new Error(MINER_ERROR_MESSAGE));
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
