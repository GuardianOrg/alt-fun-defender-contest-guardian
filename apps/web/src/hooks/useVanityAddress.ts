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
  transport: http(rpcUrl, { batch: true }),
});

const IMPL_STALE_MS = 5 * 60 * 1000;
const IMPL_GC_MS = 30 * 60 * 1000;

/** `VANITY_SUFFIX` is the on-chain minimum enforced by `Bonding._checkVanity`. */
const BASE_TARGET_ZEROS = VANITY_SUFFIX.length;

export type VanityStatus =
  | "idle" // no wallet connected, no mining
  | "mining" // workers are searching, no salt yet
  | "ready" // a launch-eligible salt exists
  | "error"; // worker spawn failed (extremely rare)

export interface VanityResult {
  /** Salt to pass into `LaunchParams.salt`. */
  salt: Hex;
  /** Predicted token address, used for CREATE2 collision pre-flight. */
  address: Address;
  /** Total trailing-zero count of `address` (always ≥ `BASE_TARGET_ZEROS`). */
  zeros: number;
}

export interface UseVanityAddressReturn {
  status: VanityStatus;
  /** Launch-eligible salt, or null while still mining. */
  best: VanityResult | null;
  attempts: number;
  /** Total ms since mining started; resets on each restart. */
  elapsedMs: number;
  /** Resolves to a launch-eligible salt; no random fallback exists. */
  ensureSalt: (name: string, ticker: string) => Promise<VanityResult>;
  /** Imperative restart (e.g. after impl rotation or wallet change). */
  restart: () => void;
  /** Drop a colliding cached salt and restart mining for the same tuple. */
  invalidateCachedSalt: (name: string, ticker: string) => void;
}

const MINER_ERROR_MESSAGE =
  "Address miner failed. Please refresh and try again.";

/** Validate untrusted cache rows before promoting them to `VanityResult`. */
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
  // Current pool metadata, used to avoid re-spawns on unrelated renders.
  const lastSpawnRef = useRef<{
    creator: Address;
    impl: Address;
    name: string;
    ticker: string;
  } | null>(null);
  // Synchronous mirror for `ensureSalt`; React state can lag a fresh cache seed.
  const bestRef = useRef<VanityResult | null>(null);
  // Active cache key for storage events and worker results.
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
    // Prevent storage events from resurrecting a tuple this tab stopped mining.
    cacheKeyRef.current = null;
    if (pendingResolversRef.current.length > 0) {
      const pending = pendingResolversRef.current;
      pendingResolversRef.current = [];
      pending.forEach(({ reject }) =>
        reject(new Error("Address mining was cancelled.")),
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

      // Cache is user-writable, so validate before trusting.
      const key = vanityKey(creator, implementation, tokenName, tokenTicker);
      cacheKeyRef.current = key;
      const cached = readVanityCache(key);
      const initialBest = parseCacheEntry(cached);

      bestRef.current = initialBest;
      setBest(initialBest);
      setStatus(initialBest ? "ready" : "mining");
      setAttempts(0);
      setElapsedMs(0);
      startTimeRef.current = performance.now();

      if (initialBest) return true;

      tickIntervalRef.current = setInterval(() => {
        setElapsedMs(performance.now() - startTimeRef.current);
      }, 100);

      const handlePoolFailure = (err: unknown) => {
        if (workersRef.current.length === 0) return;
        console.error("[useVanityAddress] worker failed at runtime", err);
        // A cached launch-eligible salt makes worker crashes non-fatal.
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
                if (bestRef.current) return;

                const winning: VanityResult = {
                  salt: msg.salt,
                  address: getAddress(msg.address),
                  zeros: msg.zeros,
                };
                bestRef.current = winning;
                setBest(winning);
                setStatus("ready");

                // Best-effort persistence for the next visit.
                if (cacheKeyRef.current) {
                  writeVanityCache(cacheKeyRef.current, {
                    salt: winning.salt,
                    address: winning.address,
                    zeros: winning.zeros,
                    savedAt: Date.now(),
                  });
                }

                if (pendingResolversRef.current.length > 0) {
                  const pending = pendingResolversRef.current;
                  pendingResolversRef.current = [];
                  pending.forEach(({ resolve }) => resolve(winning));
                }

                teardown();
              }
            },
          );
          worker.addEventListener("error", (event) => {
            event.preventDefault();
            handlePoolFailure(event.error ?? event.message ?? event);
          });
          worker.addEventListener("messageerror", () => {
            handlePoolFailure(
              new Error("Address worker posted an undeserializable message"),
            );
          });
          worker.postMessage({
            type: "init",
            implementation,
            bondingProxy: ADDRESSES.bonding,
            creator,
            nameHash: metadataHash(tokenName),
            tickerHash: metadataHash(tokenTicker),
            initialTargetZeros: BASE_TARGET_ZEROS,
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
        // Cached salt keeps launch unblocked even if worker spawn fails.
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
      // Clear the spawn guard so the same tuple re-mines after cache invalidation.
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

  // Auto-start once wallet, implementation, name, and ticker are available.
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

  // Keep `best` in sync if another tab mines this tuple first.
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (!event.key || !event.key.startsWith("vanity:")) return;
      if (event.key !== cacheKeyRef.current) return;
      if (!event.newValue) return;
      // Storage payloads are untrusted; validate before promoting.
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
      if (bestRef.current) return;
      bestRef.current = upgraded;
      setBest(upgraded);
      setStatus("ready");
      teardown();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [teardown]);

  const ensureSalt = useCallback(
    (requestedName: string, requestedTicker: string): Promise<VanityResult> => {
      if (!requestedName || !requestedTicker) {
        return Promise.reject(
          new Error(
            "Token name and ticker are required to mine a launch salt.",
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
              "Cannot mine a launch salt without a connected wallet and token implementation.",
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
        // `start` seeds `bestRef` synchronously from cache if available.
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

      // Read freshest best from the ref, not possibly-lagging state.
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
