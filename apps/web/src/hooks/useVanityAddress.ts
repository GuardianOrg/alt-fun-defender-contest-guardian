import { useCallback, useEffect, useRef, useState } from "react";

import { metadataHash, VANITY_SUFFIX } from "@launchpad/shared";
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
// new Token impl without disturbing already-launched tokens. If we hardcoded the
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
   * Resolves once the miner has found a vanity salt for the given
   * `(name, ticker)` tuple. There is *no fallback* — `Bonding._deployAndSeed`
   * enforces the `VANITY_SUFFIX` invariant on-chain and would revert with
   * `NotVanityAddress` for any other salt. The promise never settles to a
   * "random" salt.
   *
   * The arguments must be the exact strings the caller will pass into
   * `Bonding.LaunchParams` — typically the trimmed live form values, not
   * the debounced ones the hook was constructed with. If they differ from
   * the currently-mining tuple, this function force-restarts mining for
   * the given tuple and waits for the new result, so that a user who
   * clicks Launch inside the consumer's debounce window still gets a salt
   * mined for the value that will actually hit the chain.
   */
  ensureSalt: (name: string, ticker: string) => Promise<VanityResult>;
  /** Imperative restart (e.g. after impl rotation or wallet change). */
  restart: () => void;
}

/**
 * Spawns one Web Worker per CPU core and races them to find a salt that
 * deploys the user's Token clone to a vanity address ending in
 * `VANITY_SUFFIX`. Starts once the wallet is connected and the user has
 * entered both a name and a ticker — the on-chain mix binds the salt to
 * `(creator, name, ticker)` so we can't begin mining without those.
 *
 * Re-mines when any of `(creator, tokenImplementation, name, ticker)`
 * changes. The caller is expected to pass debounced `name`/`ticker` so
 * typing doesn't thrash the worker pool; `ensureSalt` accepts the live
 * (un-debounced) values and force-restarts mining if those differ from
 * what the pool was last spawned for, closing the race where a user
 * clicks Launch within the debounce window.
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

export interface UseVanityAddressArgs {
  /** Token name as the user has it in the form. Mining waits for non-empty. */
  name: string;
  /** Token ticker. Mining waits for non-empty. */
  ticker: string;
}

export function useVanityAddress({
  name,
  ticker,
}: UseVanityAddressArgs): UseVanityAddressReturn {
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
      ? getAddress(ADDRESSES.tokenImplementation)
      : undefined;

  const [status, setStatus] = useState<VanityStatus>("idle");
  const [result, setResult] = useState<VanityResult | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  const workersRef = useRef<Worker[]>([]);
  const startTimeRef = useRef<number>(0);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks the (creator, impl, name, ticker) tuple that the currently-running
  // pool was spawned for. Lets the auto-start effect skip spurious re-spawns
  // when TanStack Query refetches and returns an unchanged impl, or when an
  // unrelated render reuses the same metadata — without this guard, the
  // periodic refetch could discard a `found` result and force the user to
  // wait for re-mining for no reason.
  const lastSpawnRef = useRef<{
    creator: Address;
    impl: Address;
    name: string;
    ticker: string;
  } | null>(null);
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
    (
      creator: Address,
      implementation: Address,
      tokenName: string,
      tokenTicker: string,
    ): boolean => {
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
      const workers: Worker[] = [];
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
            // Hash off the main thread so the worker hot loop only ever sees
            // 32-byte words — matches `Bonding._mixSalt`'s pre-hashed inputs.
            nameHash: metadataHash(tokenName),
            tickerHash: metadataHash(tokenTicker),
            suffix: VANITY_SUFFIX,
            workerIndex: i,
            workerCount: cores,
          });
          workers.push(worker);
        }
      } catch (spawnErr) {
        // Synchronous spawn failure (sandboxed iframe / CSP / very old
        // browser). Roll back the optimistic state we set above so the
        // hook doesn't sit in `mining` forever, AND drain any pending
        // `ensureSalt` resolvers — without that drain, callers that
        // pushed before us hang on a pool that no longer exists, and
        // callers that push *after* us (e.g. the `ensureSalt` flush
        // path) would too unless they also check our return value.
        console.error("[useVanityAddress] worker spawn failed", spawnErr);
        workers.forEach((w) => w.terminate());
        if (tickIntervalRef.current) {
          clearInterval(tickIntervalRef.current);
          tickIntervalRef.current = null;
        }
        setStatus("error");
        const pending = pendingResolversRef.current;
        pendingResolversRef.current = [];
        pending.forEach(({ reject }) =>
          reject(new Error(MINER_ERROR_MESSAGE)),
        );
        workersRef.current = [];
        return false;
      }

      workersRef.current = workers;
      return true;
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
    if (!name || !ticker) return;
    setStatus("mining");
    void (async () => {
      let fresh: Address;
      try {
        const result = await refetchImpl();
        fresh = result.data ?? getAddress(ADDRESSES.tokenImplementation);
      } catch {
        fresh = getAddress(ADDRESSES.tokenImplementation);
      }
      const creator = getAddress(address);
      lastSpawnRef.current = { creator, impl: fresh, name, ticker };
      start(creator, fresh, name, ticker);
    })();
  }, [address, name, ticker, refetchImpl, start]);

  // Auto-start once `(wallet, impl, name, ticker)` are all available, and
  // auto-tear-down on disconnect or unmount. Re-spawns whenever any of the
  // four change — `lastSpawnRef` ensures we don't restart on unrelated
  // re-renders (e.g. a TanStack refetch returning the same impl) and
  // therefore don't discard an in-progress mine or a `found` result.
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
    // Mining requires a concrete `(name, ticker)` because both are mixed
    // into the salt on-chain. With either still empty we sit idle — the
    // CreateView gates the Launch button on non-empty values anyway.
    if (!name || !ticker) {
      teardown();
      setStatus("idle");
      setResult(null);
      lastSpawnRef.current = null;
      return;
    }

    const creator = getAddress(address);
    const last = lastSpawnRef.current;
    if (
      last
      && last.creator === creator
      && last.impl === effectiveImpl
      && last.name === name
      && last.ticker === ticker
    ) {
      return;
    }

    lastSpawnRef.current = { creator, impl: effectiveImpl, name, ticker };
    start(creator, effectiveImpl, name, ticker);
    return () => {
      teardown();
    };
  }, [address, name, ticker, effectiveImpl, start, teardown]);

  const ensureSalt = useCallback(
    (requestedName: string, requestedTicker: string): Promise<VanityResult> => {
      if (!requestedName || !requestedTicker) {
        return Promise.reject(
          new Error(
            "Token name and ticker are required to mine a vanity salt.",
          ),
        );
      }

      const last = lastSpawnRef.current;
      const minedForRequested = last
        && last.name === requestedName
        && last.ticker === requestedTicker;

      // Caller raced the consumer-side debounce: they want a salt for a
      // (name, ticker) we haven't started mining for yet. Force-restart the
      // pool against the requested tuple before resolving so we never hand
      // back a salt mined for a stale value.
      if (!minedForRequested) {
        if (!address || !effectiveImpl) {
          return Promise.reject(
            new Error(
              "Cannot mine vanity salt without a connected wallet and token implementation.",
            ),
          );
        }
        const creator = getAddress(address);
        lastSpawnRef.current = {
          creator,
          impl: effectiveImpl,
          name: requestedName,
          ticker: requestedTicker,
        };
        // `start` returns `false` on synchronous spawn failure (sandboxed
        // iframe, etc.) — without this guard the resolver we'd push below
        // would hang forever, since no worker exists to fire `found` and
        // `start`'s catch path has already drained the pre-existing queue.
        const started = start(
          creator,
          effectiveImpl,
          requestedName,
          requestedTicker,
        );
        if (!started) {
          return Promise.reject(new Error(MINER_ERROR_MESSAGE));
        }
        return new Promise<VanityResult>((resolve, reject) => {
          pendingResolversRef.current.push({ resolve, reject });
        });
      }

      if (result) return Promise.resolve(result);

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
    },
    [address, effectiveImpl, result, start, status],
  );

  return {
    status,
    result,
    attempts,
    elapsedMs,
    ensureSalt,
    restart,
  };
}
