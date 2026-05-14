import { useCallback, useEffect, useRef, useState } from "react";

import { metadataHash, VANITY_SUFFIX } from "@launchpad/shared";
import { useQuery } from "@tanstack/react-query";
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import { useWallet } from "./useWallet";
import {
  deleteVanityCache,
  readVanityCache,
  vanityKey,
  writeVanityCache,
} from "./vanityStorage";
import { hyperEVM } from "../config/chains";
import { BondingAbi } from "../contracts/abis";
import { ADDRESSES } from "../contracts/addresses";

import type { WorkerOutbound } from "../workers/vanity.worker";

const rpcUrl = import.meta.env.VITE_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const hyperEvmClient = createPublicClient({
  chain: hyperEVM,
  transport: http(rpcUrl),
});

const IMPL_STALE_MS = 5 * 60 * 1000;
const IMPL_GC_MS = 30 * 60 * 1000;

/**
 * The `VANITY_SUFFIX` shared module is the source of truth for the
 * on-chain minimum (`"00000"` → 5 zeros). We mine for that minimum, then
 * keep mining indefinitely for progressively rarer addresses, with each
 * extra zero ~16x harder than the last. The "best-so-far" salt is
 * usable for launch the moment we hit the base; everything beyond that
 * is a cosmetic flex (drives the tier system in `vanityTier.ts`).
 */
const BASE_TARGET_ZEROS = VANITY_SUFFIX.length;

export type VanityStatus =
  | "idle" // no wallet connected, no mining
  | "mining" // workers are searching, no salt yet
  | "ready" // a launch-eligible salt exists; mining continues for a better one
  | "error"; // worker spawn failed (extremely rare)

export interface VanityResult {
  /** Salt to pass into `LaunchParams.salt`. Always vanity. */
  salt: Hex;
  /** Predicted token address — purely informational for the UI. */
  address: Address;
  /** Total trailing-zero count of `address` (always ≥ `BASE_TARGET_ZEROS`). */
  zeros: number;
}

export interface UseVanityAddressReturn {
  status: VanityStatus;
  /** The best (highest-zero) salt mined so far, or null while still mining. */
  best: VanityResult | null;
  attempts: number;
  /** Total ms since mining started; resets on each restart. */
  elapsedMs: number;
  /**
   * Resolves once the miner has at least the launch-eligible salt for the
   * given `(name, ticker)` tuple. There is *no fallback* —
   * `Bonding._deployAndSeed` enforces the `VANITY_SUFFIX` invariant
   * on-chain and would revert with `NotVanityAddress` for any other salt.
   * The promise never settles to a "random" salt.
   *
   * Returns whichever best-so-far salt is current at resolve time —
   * background mining keeps pushing for rarer addresses, but `ensureSalt`
   * doesn't wait for those: the user's launch click cashes in the current
   * best. If a higher-tier salt arrives a millisecond later it's lost,
   * which is fine — the user already chose to launch.
   */
  ensureSalt: (name: string, ticker: string) => Promise<VanityResult>;
  /** Imperative restart (e.g. after impl rotation or wallet change). */
  restart: () => void;
  /**
   * Drop the cached salt for `(creator, impl, name, ticker)` and
   * restart mining from scratch. The next `ensureSalt(name, ticker)`
   * waits for a freshly-mined salt rather than handing back the stale
   * cache entry.
   *
   * Called from `CreateView`'s `mineFreshSalt` callback when
   * `useCreateToken`'s pre-flight `getBytecode` on the predicted
   * clone address shows the address is already taken — i.e. the user
   * has previously launched a token with the same
   * `(creator, name, ticker, salt)` quartet. Without this the miner
   * would just keep serving the same colliding salt to every retry,
   * stranding the user behind a permanent `Clones.FailedDeployment()`
   * revert (`0xb06ebf3d`). Re-mining produces a fresh `userSalt` that
   * derives a different CREATE2 address, breaking the collision so the
   * pre-flight can pass on the next iteration without user
   * intervention.
   */
  invalidateCachedSalt: (name: string, ticker: string) => void;
}

const MINER_ERROR_MESSAGE =
  "Vanity address miner failed. Please refresh and try again.";

/**
 * Validate untrusted cache shape (other tabs, dev-tools, future versions
 * of this app, etc.) before promoting it to a `VanityResult`. Returns
 * null on any structural issue rather than throwing — `getAddress` and
 * the salt-format check would crash the create flow if we didn't guard
 * against tampering / corrupt rows.
 */
function parseCacheEntry(
  raw: { salt: Hex; address: Address; zeros: number } | null | undefined,
): VanityResult | null {
  if (!raw) return null;
  if (typeof raw.zeros !== "number" || raw.zeros < BASE_TARGET_ZEROS) {
    return null;
  }
  if (typeof raw.salt !== "string" || !isHex(raw.salt) || raw.salt.length !== 66) {
    return null;
  }
  if (typeof raw.address !== "string" || !isAddress(raw.address)) {
    return null;
  }
  try {
    return {
      salt: raw.salt,
      address: getAddress(raw.address),
      zeros: raw.zeros,
    };
  } catch {
    return null;
  }
}

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
  const [best, setBest] = useState<VanityResult | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  const workersRef = useRef<Worker[]>([]);
  const startTimeRef = useRef<number>(0);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks the currently-running pool's metadata so we don't re-spawn on
  // unrelated re-renders (e.g. a TanStack refetch returning the same impl).
  const lastSpawnRef = useRef<{
    creator: Address;
    impl: Address;
    name: string;
    ticker: string;
  } | null>(null);
  // Synchronous mirror of `best`. Two reasons we keep this alongside the
  // React state:
  //   1. Worker message handlers race themselves on back-to-back finds —
  //      `setBest` is async, so without a ref we'd accept improvements
  //      against a stale `best.zeros`.
  //   2. The `ensureSalt` fast path (just-restarted with a cache-seeded
  //      best) needs the freshly-installed `VanityResult` synchronously.
  //      Re-reading from `localStorage` would work in the happy path but
  //      degrades to a wait if storage is cleared / evicted between
  //      `start` and `ensureSalt`.
  const bestRef = useRef<VanityResult | null>(null);
  // Cache key for the active (creator, name, ticker) tuple. Recomputed on
  // each `start` so we don't re-derive it per `found` event.
  const cacheKeyRef = useRef<string | null>(null);
  // Pending listeners waiting on `ensureSalt`.
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
    // Clear the cache key so the cross-tab `storage` listener can't
    // resurrect `best` / `status` for a tuple this tab is no longer
    // mining (wallet disconnect, metadata cleared, unmount). `start()`
    // re-installs a fresh key on its next call, so this is safe to do
    // unconditionally — teardown is the sole "stop everything"
    // chokepoint.
    cacheKeyRef.current = null;
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

      // Seed from cache if we have a previously-mined salt for this exact
      // tuple. Workers will then start mining for `cached.zeros + 1` and
      // only re-emit `found` when they beat that. The user gets an
      // instant "ready" state on revisit.
      //
      // Cache values are user-writable (other tabs, dev-tools, browser
      // extensions) so we validate the shape strictly before trusting
      // them. A bad row (mangled hex, dropped fields, casing tampering)
      // gets ignored and overwritten on the next legitimate `found`.
      const key = vanityKey(creator, implementation, tokenName, tokenTicker);
      cacheKeyRef.current = key;
      const cached = readVanityCache(key);
      const initialBest = parseCacheEntry(cached);
      const initialTargetZeros = initialBest
        ? initialBest.zeros + 1
        : BASE_TARGET_ZEROS;

      bestRef.current = initialBest;
      setBest(initialBest);
      setStatus(initialBest ? "ready" : "mining");
      setAttempts(0);
      setElapsedMs(0);
      startTimeRef.current = performance.now();

      tickIntervalRef.current = setInterval(() => {
        setElapsedMs(performance.now() - startTimeRef.current);
      }, 100);

      const handlePoolFailure = (err: unknown) => {
        if (workersRef.current.length === 0) return;
        console.error("[useVanityAddress] worker failed at runtime", err);
        // If we already have a launch-eligible cached salt, a worker
        // crash mid-mining is non-fatal — the user can still launch with
        // the cached best. Stay in "ready" rather than flipping to
        // "error". The launch path resolves `ensureSalt` from `bestRef`.
        if (bestRef.current && bestRef.current.zeros >= BASE_TARGET_ZEROS) {
          teardown();
          return;
        }
        setStatus("error");
        const pending = pendingResolversRef.current;
        pendingResolversRef.current = [];
        pending.forEach(({ reject }) => reject(new Error(MINER_ERROR_MESSAGE)));
        teardown();
      };

      const workers: Worker[] = [];
      try {
        const cores = Math.min(
          Math.max(navigator.hardwareConcurrency ?? 4, 1),
          8,
        );
        for (let i = 0; i < cores; i++) {
          const worker = new Worker(
            new URL("../workers/vanity.worker.ts", import.meta.url),
            { type: "module" },
          );
          worker.addEventListener(
            "message",
            (event: MessageEvent<WorkerOutbound>) => {
              const msg = event.data;
              if (msg.type === "progress") {
                setAttempts((prev) => prev + msg.attemptsDelta);
                return;
              }
              if (msg.type === "found") {
                setAttempts((prev) => prev + msg.attemptsDelta);
                // Race guard: a sibling worker may have already posted a
                // higher-tier `found` while this one was in flight. Only
                // accept strict improvements.
                const currentZeros = bestRef.current?.zeros ?? 0;
                if (msg.zeros <= currentZeros) return;

                const winning: VanityResult = {
                  salt: msg.salt,
                  address: getAddress(msg.address),
                  zeros: msg.zeros,
                };
                bestRef.current = winning;
                setBest(winning);
                setStatus("ready");

                // Persist for the next visit. Best-effort; failures are
                // swallowed inside `writeVanityCache`.
                if (cacheKeyRef.current) {
                  writeVanityCache(cacheKeyRef.current, {
                    salt: winning.salt,
                    address: winning.address,
                    zeros: winning.zeros,
                    savedAt: Date.now(),
                  });
                }

                // Drain any pending `ensureSalt` callers immediately —
                // we now have a launch-eligible salt. Higher-tier finds
                // later just upgrade `best` for tier rendering; we
                // don't make new launchers wait for them.
                if (pendingResolversRef.current.length > 0) {
                  const pending = pendingResolversRef.current;
                  pendingResolversRef.current = [];
                  pending.forEach(({ resolve }) => resolve(winning));
                }

                // Broadcast to every sibling worker so they don't waste
                // cycles re-discovering this threshold. Workers also
                // self-bump locally on found, this is belt-and-braces.
                const nextTarget = msg.zeros + 1;
                workersRef.current.forEach((w) => {
                  try {
                    w.postMessage({
                      type: "bumpTarget",
                      targetZeros: nextTarget,
                    });
                  } catch {
                    // Worker may have died; ignore.
                  }
                });
              }
            },
          );
          worker.addEventListener("error", (event) => {
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
            nameHash: metadataHash(tokenName),
            tickerHash: metadataHash(tokenTicker),
            initialTargetZeros,
            workerIndex: i,
            workerCount: cores,
          });
          workers.push(worker);
        }
      } catch (spawnErr) {
        console.error("[useVanityAddress] worker spawn failed", spawnErr);
        workers.forEach((w) => w.terminate());
        if (tickIntervalRef.current) {
          clearInterval(tickIntervalRef.current);
          tickIntervalRef.current = null;
        }
        // If we have a cached launch-eligible salt, a spawn failure
        // shouldn't strand the user — they can still launch with the
        // cache. Stay in `ready` and resolve any pending `ensureSalt`.
        if (initialBest) {
          const pending = pendingResolversRef.current;
          pendingResolversRef.current = [];
          pending.forEach(({ resolve }) => resolve(initialBest));
          workersRef.current = [];
          return false;
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

  const invalidateCachedSalt = useCallback(
    (currentName: string, currentTicker: string): void => {
      if (!address || !effectiveImpl) return;
      const trimmedName = currentName.trim();
      const trimmedTicker = currentTicker.trim();
      if (!trimmedName || !trimmedTicker) return;
      const creator = getAddress(address);
      const key = vanityKey(
        creator,
        effectiveImpl,
        trimmedName,
        trimmedTicker,
      );
      deleteVanityCache(key);
      // Force `start` to re-spawn the worker pool from scratch even if
      // `(creator, impl, name, ticker)` matches the running pool — the
      // re-entry guard inside the auto-start `useEffect` would
      // otherwise short-circuit. Clearing `lastSpawnRef` together with
      // the cache row makes both layers agree the previous best is
      // gone.
      lastSpawnRef.current = {
        creator,
        impl: effectiveImpl,
        name: trimmedName,
        ticker: trimmedTicker,
      };
      start(creator, effectiveImpl, trimmedName, trimmedTicker);
    },
    [address, effectiveImpl, start],
  );

  const refetchImpl = implQuery.refetch;
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
  // four change.
  useEffect(() => {
    if (!address) {
      teardown();
      setStatus("idle");
      setBest(null);
      bestRef.current = null;
      lastSpawnRef.current = null;
      return;
    }
    if (!effectiveImpl) {
      setStatus((prev) => (prev === "ready" ? prev : "mining"));
      return;
    }
    if (!name || !ticker) {
      teardown();
      setStatus("idle");
      setBest(null);
      bestRef.current = null;
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

  // Keep `best` in sync if another tab updates the cache for the same
  // tuple while this tab is mining — without this, the second tab would
  // re-mine threshold-N hits for an entry the first tab already pushed
  // past.
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (!event.key || !event.key.startsWith("vanity:")) return;
      if (event.key !== cacheKeyRef.current) return;
      if (!event.newValue) return;
      // `event.newValue` is untrusted (other tabs, dev-tools, browser
      // extensions, future schema versions) — validate the payload
      // strictly before promoting it. Bad rows are silently dropped.
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.newValue);
      } catch {
        return;
      }
      const upgraded = parseCacheEntry(
        parsed as { salt: Hex; address: Address; zeros: number } | null,
      );
      if (!upgraded) return;
      const currentZeros = bestRef.current?.zeros ?? 0;
      if (upgraded.zeros <= currentZeros) return;
      bestRef.current = upgraded;
      setBest(upgraded);
      setStatus("ready");
      const nextTarget = upgraded.zeros + 1;
      workersRef.current.forEach((w) => {
        try {
          w.postMessage({ type: "bumpTarget", targetZeros: nextTarget });
        } catch {
          // Worker may have died; ignore.
        }
      });
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

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
        const started = start(
          creator,
          effectiveImpl,
          requestedName,
          requestedTicker,
        );
        // `start` synchronously installs the cached best (if any) into
        // `bestRef` before returning, so this fast-path resolution
        // doesn't race with the async `setBest` state update — and
        // doesn't depend on the cache row still being present in
        // localStorage either.
        const seeded = bestRef.current;
        if (seeded && seeded.zeros >= BASE_TARGET_ZEROS) {
          return Promise.resolve(seeded);
        }
        if (!started) {
          return Promise.reject(new Error(MINER_ERROR_MESSAGE));
        }
        return new Promise<VanityResult>((resolve, reject) => {
          pendingResolversRef.current.push({ resolve, reject });
        });
      }

      // Same metadata as the running pool — read the freshest best from
      // the ref rather than the (possibly one render behind) state.
      const current = bestRef.current;
      if (current && current.zeros >= BASE_TARGET_ZEROS) {
        return Promise.resolve(current);
      }

      return new Promise<VanityResult>((resolve, reject) => {
        if (status === "error") {
          reject(new Error(MINER_ERROR_MESSAGE));
          return;
        }
        pendingResolversRef.current.push({ resolve, reject });
      });
    },
    [address, effectiveImpl, start, status],
  );

  return {
    status,
    best,
    attempts,
    elapsedMs,
    ensureSalt,
    restart,
    invalidateCachedSalt,
  };
}
