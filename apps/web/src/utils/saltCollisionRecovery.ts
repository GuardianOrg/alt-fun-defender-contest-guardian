import type { Address, Hex } from "viem";

// Retry budget for pre-flight CREATE2 collision recovery.
export const DEFAULT_MAX_SALT_COLLISION_RETRIES = 3;

// Defensive fallback when a caller cannot re-mine after a collision.
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
  /** Salt the caller wants to launch with. */
  initialSalt: Hex;
  initialPredicted: Address;
  /** Reads bytecode; anything besides `"0x"`/`undefined` means occupied. */
  getBytecode: (address: Address) => Promise<Hex | undefined>;
  /** Re-mines a fresh salt for the same launch tuple. */
  mineFreshSalt?: () => Promise<{ salt: Hex; address: Address }>;
  /** Override retry budget; total checks are `maxRetries + 1`. */
  maxRetries?: number;
}

export interface ResolvedLaunchSalt {
  salt: Hex;
  address: Address;
  /** Number of re-mines; zero means the initial salt was free. */
  retries: number;
}

/** Resolve a launch salt, re-mining around occupied CREATE2 slots. */
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

  // Unreachable unless the loop termination changes later.
  throw new Error(saltCollisionExhaustedMessage(maxRetries));
}
