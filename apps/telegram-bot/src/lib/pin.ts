import bcrypt from "bcryptjs";

/**
 * PIN management for wallet-sensitive flows (export key, withdraw,
 * delete wallet). The PIN gate is the second factor on top of the
 * MASTER_KEY + per-user HKDF derivation in `wallet.ts` — neither the
 * KV ciphertext on its own nor possession of the Telegram session
 * suffices to extract a private key.
 *
 * Threat model:
 *   - Online attacker with a stolen Telegram session: blocked by PIN,
 *     and after 5 wrong PINs the user is locked out for 30 minutes.
 *   - Operator with KV read access: sees bcrypt hashes, not the PIN.
 *     Brute-forcing a 6-digit PIN against the offline hash is the
 *     dominant residual risk — mitigated by bcrypt's tunable cost,
 *     but not eliminated. Rotating MASTER_KEY invalidates wallets
 *     but does NOT invalidate PIN hashes (bcrypt is independent of
 *     the AES master key), so a leaked KV dump remains a
 *     brute-force surface.
 *
 * bcrypt implementation is `bcryptjs` — pure-JS, runs in the
 * Cloudflare Workers runtime (no native bindings, no WASM). Tuning
 * cost via `saltRounds` lets tests run in single-digit ms (rounds=4)
 * while production keeps OWASP's recommended rounds=12. Per AGENTS.md
 * `/security` spec, PINs are 6-digit numeric and bcrypt-hashed in KV.
 *
 * v1 scope: hash, verify, attempt counter, 30-minute lockout. The
 * 24-hour PIN reset flow described in AGENTS.md `/security` is
 * deferred to the /security command implementation — without it, a
 * forgotten PIN locks the user out until /security ships. This is
 * acceptable for v1 because no real funds flow through the bot yet.
 */

const DEFAULT_SALT_ROUNDS = 12;
const PIN_REGEX = /^\d{6}$/;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 60 * 1000;

const hashKey = (userId: number): string => `pin:${userId}:hash`;
const attemptsKey = (userId: number): string => `pin:${userId}:attempts`;

interface StoredHash {
  /** bcrypt encoded string (algorithm + cost + salt + digest). */
  hash: string;
}

interface StoredAttempts {
  count: number;
  lockedUntil: number;
}

const EMPTY_ATTEMPTS: StoredAttempts = { count: 0, lockedUntil: 0 };

export class InvalidPinFormatError extends Error {
  constructor() {
    super("PIN must be exactly 6 digits");
    this.name = "InvalidPinFormatError";
  }
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "locked"; retryAt: number }
  | { ok: false; reason: "unset" }
  | { ok: false; reason: "wrong"; attemptsRemaining: number }
  | { ok: false; reason: "locked-now"; retryAt: number };

export class PinManager {
  private readonly saltRounds: number;
  private readonly now: () => number;

  constructor(
    private readonly kv: KVNamespace,
    options: { saltRounds?: number; now?: () => number } = {},
  ) {
    this.saltRounds = options.saltRounds ?? DEFAULT_SALT_ROUNDS;
    this.now = options.now ?? (() => Date.now());
  }

  static isValidPinFormat(pin: string): boolean {
    return PIN_REGEX.test(pin);
  }

  async isPinSet(userId: number): Promise<boolean> {
    const raw = await this.kv.get(hashKey(userId));
    return raw !== null;
  }

  async setPin(userId: number, pin: string): Promise<void> {
    if (!PinManager.isValidPinFormat(pin)) throw new InvalidPinFormatError();
    const hash = await bcrypt.hash(pin, this.saltRounds);
    const record: StoredHash = { hash };
    await this.kv.put(hashKey(userId), JSON.stringify(record));
    // Setting / changing a PIN clears any prior failed-attempt state
    // so a fresh PIN does not inherit a lockout from the previous one.
    await this.kv.delete(attemptsKey(userId));
  }

  async verifyPin(userId: number, pin: string): Promise<VerifyResult> {
    if (!PinManager.isValidPinFormat(pin)) {
      // Treat format errors as wrong attempts — otherwise an attacker
      // could probe with malformed input to avoid incrementing the
      // counter. Use the same path as a wrong PIN to keep the
      // attempt-counter behaviour uniform.
      return this.recordWrong(userId);
    }
    const attempts = await this.readAttempts(userId);
    const now = this.now();
    if (attempts.lockedUntil > now) {
      // Reject before hashing — both faster and avoids a timing
      // signal that hints whether the PIN was the right shape.
      return { ok: false, reason: "locked", retryAt: attempts.lockedUntil };
    }
    const stored = await this.readHash(userId);
    if (!stored) return { ok: false, reason: "unset" };
    const matches = await bcrypt.compare(pin, stored.hash);
    if (matches) {
      if (attempts.count !== 0 || attempts.lockedUntil !== 0) {
        await this.kv.delete(attemptsKey(userId));
      }
      return { ok: true };
    }
    return this.recordWrong(userId);
  }

  async clearLockout(userId: number): Promise<void> {
    await this.kv.delete(attemptsKey(userId));
  }

  private async recordWrong(userId: number): Promise<VerifyResult> {
    const attempts = await this.readAttempts(userId);
    const nextCount = attempts.count + 1;
    // AGENTS.md `/security`: "Lockout state stored in KV with TTL."
    // The TTL also clears stale partial-attempt counters so a user
    // who fails 3x then walks away for a week doesn't come back to a
    // pre-loaded counter waiting to trip on the next slip.
    const ttlSeconds = Math.ceil(LOCKOUT_MS / 1000);
    if (nextCount >= MAX_ATTEMPTS) {
      const retryAt = this.now() + LOCKOUT_MS;
      // Reset count to zero alongside the lockout — after the lockout
      // expires the user gets a fresh allowance, matching the
      // "5 wrong → 30-min cooldown → 5 more" intent in AGENTS.md.
      const record: StoredAttempts = { count: 0, lockedUntil: retryAt };
      await this.kv.put(attemptsKey(userId), JSON.stringify(record), {
        expirationTtl: ttlSeconds,
      });
      return { ok: false, reason: "locked-now", retryAt };
    }
    const record: StoredAttempts = { count: nextCount, lockedUntil: 0 };
    await this.kv.put(attemptsKey(userId), JSON.stringify(record), {
      expirationTtl: ttlSeconds,
    });
    return {
      ok: false,
      reason: "wrong",
      attemptsRemaining: MAX_ATTEMPTS - nextCount,
    };
  }

  private async readAttempts(userId: number): Promise<StoredAttempts> {
    const raw = await this.kv.get(attemptsKey(userId));
    if (!raw) return { ...EMPTY_ATTEMPTS };
    return JSON.parse(raw) as StoredAttempts;
  }

  private async readHash(userId: number): Promise<StoredHash | null> {
    const raw = await this.kv.get(hashKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredHash;
  }
}

export const PIN_LOCKOUT_MS = LOCKOUT_MS;
export const PIN_MAX_ATTEMPTS = MAX_ATTEMPTS;
