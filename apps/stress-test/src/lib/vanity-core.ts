/**
 * Pure synchronous vanity miner. Lives in its own file so it can be
 * called from either the main thread (tests, single-iteration use) or a
 * worker thread (production scenario, where parallelism across CPU
 * cores is the whole point — see `vanity-worker.ts` and the async
 * wrapper in `vanity.ts`).
 *
 * The loop mirrors `mixSalt` + `predictCloneAddress` from
 * `packages/shared/src/vanity.ts` byte-for-byte, with the per-name and
 * per-implementation constants hoisted out. Drift in either direction
 * silently produces salts the contract rejects with `NotVanityAddress` —
 * the post-loop sanity check below is the canary.
 *
 * Single-threaded throughput: ~45-50k attempts/sec on a modern laptop
 * (bound by viem's pure-JS keccak256). At the production 5-zero suffix
 * that's a mean of ~22s per mine. The worker-threads wrapper exists to
 * make K parallel mines actually run on K cores instead of time-slicing
 * one event loop — see the diagnosis in chat history under the
 * "concurrency 10 looks stuck" thread.
 */

import {
  eip1167InitCodeHash,
  hasVanitySuffix,
  metadataHash,
  VANITY_SUFFIX,
} from "@launchpad/shared";
import { randomBytes } from "node:crypto";
import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

export interface MinedSalt {
  salt: Hex;
  address: Address;
  attempts: number;
}

export interface MineParams {
  implementation: Address;
  bondingProxy: Address;
  creator: Address;
  name: string;
  ticker: string;
  /**
   * Override the target vanity suffix. Production callers MUST omit this
   * — `Bonding._checkVanity` enforces exactly `VANITY_SUFFIX` on-chain,
   * so any other suffix mines a salt that the contract rejects with
   * `NotVanityAddress`. The override exists for tests where mining the
   * full 5-zero suffix would make the suite flaky.
   */
  suffixOverride?: string;
}

const MAX_ATTEMPTS_PER_CALL = 50_000_000;

export function runMiningLoop(params: MineParams): MinedSalt {
  const {
    implementation,
    bondingProxy,
    creator,
    name,
    ticker,
    suffixOverride,
  } = params;

  const creatorChecksum = getAddress(creator);
  const deployerChecksum = getAddress(bondingProxy);
  const nameHash = metadataHash(name);
  const tickerHash = metadataHash(ticker);
  const initCodeHash = eip1167InitCodeHash(implementation);

  const suffix = (suffixOverride ?? VANITY_SUFFIX).toLowerCase();

  // Pre-build the static portion of the CREATE2 input
  // (`0xff || deployer || …`). We only swap in the `mixedSalt` per
  // attempt. Done as a hex template rather than a Uint8Array splice
  // because viem's `keccak256` accepts hex directly and the cost of
  // string concatenation is dwarfed by the keccak itself.
  const deployerHexNoPrefix = deployerChecksum.slice(2).toLowerCase();
  const initCodeHashNoPrefix = initCodeHash.slice(2);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CALL; attempt++) {
    const userSalt = `0x${randomBytes(32).toString("hex")}` as Hex;

    // `mixSalt` — keccak256(abi.encode(creator, nameHash, tickerHash, userSalt))
    const mixedSalt = keccak256(
      encodeAbiParameters(
        [
          { type: "address" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
        ],
        [creatorChecksum, nameHash, tickerHash, userSalt],
      ),
    );

    // `predictCloneAddress` — keccak256(0xff || deployer || mixedSalt || initCodeHash)
    const hash = keccak256(
      `0xff${deployerHexNoPrefix}${mixedSalt.slice(2)}${initCodeHashNoPrefix}` as Hex,
    );
    const candidate = `0x${hash.slice(-40)}`;

    if (candidate.endsWith(suffix)) {
      const address = getAddress(candidate);
      if (!hasVanitySuffix(address, suffix)) {
        // Sanity guard against precomputation drift — if the helpers
        // upstream ever change, the in-process check above is the
        // canary that prevents us from publishing a non-vanity salt
        // that the contract would reject with `NotVanityAddress`.
        throw new Error(
          "Miner produced an address that fails the canonical vanity check — " +
            "constants in this file have drifted from `@launchpad/shared/vanity.ts`.",
        );
      }
      return { salt: userSalt, address, attempts: attempt };
    }
  }

  throw new Error(
    `Vanity miner exhausted ${MAX_ATTEMPTS_PER_CALL} attempts without a hit — ` +
      `expected ~16^${suffix.length} ≈ ${16 ** suffix.length} attempts ` +
      `on average. Something is wrong with the predict-address pipeline.`,
  );
}
