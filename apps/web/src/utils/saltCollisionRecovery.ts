import type { Address, Hex } from "viem";

/**
 * Auto-retry budget for the pre-flight CREATE2 collision recovery in
 * `useCreateToken.create`. Each retry asks the caller to drop the
 * stale `localStorage` cache row and re-mine a fresh `userSalt`, then
 * re-runs `eth_getCode` against the new predicted address. In
 * practice the first retry always succeeds because the cache is now
 * empty and worker pools pick a random nonce per worker; the budget
 * exists purely so a bug in the miner or the caller's `mineFreshSalt`
 * (e.g. it returns the same salt) can't loop forever.
 *
 * Total attempt cap is `DEFAULT_MAX_SALT_COLLISION_RETRIES + 1` (one
 * initial pre-flight plus that many re-mined retries).
 */
export const DEFAULT_MAX_SALT_COLLISION_RETRIES = 3;

/**
 * Copy used when we hit a collision but the caller didn't pass a
 * `mineFreshSalt` recovery callback (defensive — should never fire in
 * practice because `CreateView` always wires one up). Same wording the
 * pre-auto-retry implementation surfaced so the manual recovery path
 * is still actionable for the user.
 */
export const SALT_COLLISION_NO_RECOVERY_MESSAGE =
  "A token with this name and ticker already exists for your wallet. " +
  "Change the name or ticker, or click Launch again to mine a new " +
  "vanity address.";

export function saltCollisionExhaustedMessage(maxRetries: number): string {
  return (
    `Couldn't find an unused launch address after ` +
    `${maxRetries + 1} attempts. ` +
    `Change the name or ticker and try again.`
  );
}

export interface ResolveLaunchSaltArgs {
  /**
   * Salt the caller wants to launch with. The first pre-flight check
   * runs against `initialPredicted`; if it's clear we resolve to
   * `(initialSalt, initialPredicted)` without invoking `mineFreshSalt`.
   */
  initialSalt: Hex;
  initialPredicted: Address;
  /**
   * Reads on-chain bytecode at `address`. Returns `"0x"` (or
   * `undefined`) for an empty slot — anything else means a contract is
   * already deployed there and we'd revert with
   * `Clones.FailedDeployment()` if we tried to land our CREATE2 clone
   * on top of it.
   */
  getBytecode: (address: Address) => Promise<Hex | undefined>;
  /**
   * Invalidates the cached salt and re-mines a fresh one for the same
   * `(creator, impl, name, ticker)` tuple. Resolves to the new pair we
   * should re-check. Optional; if missing we throw the manual-recovery
   * message instead of looping.
   */
  mineFreshSalt?: () => Promise<{ salt: Hex; address: Address }>;
  /**
   * Override the default retry budget. The total number of distinct
   * pre-flight checks is `maxRetries + 1` (one initial + `maxRetries`
   * re-mined retries). Tests pin small values; production callers
   * should leave this at the default.
   */
  maxRetries?: number;
}

export interface ResolvedLaunchSalt {
  salt: Hex;
  address: Address;
  /** Number of `mineFreshSalt` invocations it took to find a free slot.
   *  Zero means the initial salt was already free. */
  retries: number;
}

/**
 * Resolve a launch-eligible `(salt, predictedAddress)` pair, looping
 * past CREATE2 address collisions by re-mining a fresh salt up to
 * `maxRetries` times.
 *
 * Why this lives outside the hook: the retry logic is plain async
 * orchestration with no React state, so isolating it keeps
 * `useCreateToken` focused on wallet/tx plumbing AND lets us
 * unit-test the loop without mocking `usePrivyWalletClient`,
 * `useTokenPermit`, the viem RPC client, the upload service, etc.
 *
 * Throws if:
 *   - The initial slot is occupied AND no `mineFreshSalt` callback is
 *     provided (manual-recovery message).
 *   - We exhaust `maxRetries` re-mines without finding a free slot
 *     (exhaustion message).
 *
 * The caller is responsible for surfacing the thrown message; this
 * function does not interact with React state on its own.
 */
export async function resolveLaunchSalt({
  initialSalt,
  initialPredicted,
  getBytecode,
  mineFreshSalt,
  maxRetries = DEFAULT_MAX_SALT_COLLISION_RETRIES,
}: ResolveLaunchSaltArgs): Promise<ResolvedLaunchSalt> {
  let activeSalt: Hex = initialSalt;
  let activePredicted: Address = initialPredicted;

  for (let retries = 0; retries <= maxRetries; retries++) {
    const existingCode = await getBytecode(activePredicted);
    if (!existingCode || existingCode === "0x") {
      return { salt: activeSalt, address: activePredicted, retries };
    }

    if (!mineFreshSalt) {
      throw new Error(SALT_COLLISION_NO_RECOVERY_MESSAGE);
    }
    if (retries === maxRetries) {
      throw new Error(saltCollisionExhaustedMessage(maxRetries));
    }

    const fresh = await mineFreshSalt();
    activeSalt = fresh.salt;
    activePredicted = fresh.address;
  }

  // Unreachable: the loop either returns or throws on every iteration.
  // Kept as a defensive belt-and-braces so a future refactor of the
  // termination conditions can't silently fall through to a stale
  // salt.
  throw new Error(saltCollisionExhaustedMessage(maxRetries));
}
