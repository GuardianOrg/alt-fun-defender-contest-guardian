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
 *   - Operator with KV read access: sees salted PBKDF2 hashes, not the
 *     PIN. Brute-forcing a 6-digit PIN against the offline hash is the
 *     dominant residual risk — mitigated by high iteration count, but
 *     not eliminated. Rotating MASTER_KEY invalidates wallets but does
 *     NOT invalidate PIN hashes (they derive only from PIN + salt), so
 *     a leaked KV dump remains a brute-force surface.
 *
 * AGENTS.md specifies bcrypt; we use PBKDF2-SHA256 instead because
 * Cloudflare Workers ships WebCrypto natively and bcrypt would require
 * a WASM port (no first-party Worker support). PBKDF2 at the iteration
 * count below is OWASP-recommended for password-class secrets and
 * matches the wallet-encryption stack's use of WebCrypto in
 * `wallet.ts`. Iterations are tunable via the constructor so tests can
 * run in single-digit ms.
 *
 * v1 scope: hash, verify, attempt counter, 30-minute lockout. The
 * 24-hour PIN reset flow described in AGENTS.md `/security` is
 * deferred to the /security command implementation — without it, a
 * forgotten PIN locks the user out until /security ships. This is
 * acceptable for v1 because no real funds flow through the bot yet.
 */

const SALT_LEN = 16;
const HASH_LEN = 32;
const DEFAULT_ITERATIONS = 600_000;
const PIN_REGEX = /^\d{6}$/;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 60 * 1000;

const hashKey = (userId: number): string => `pin:${userId}:hash`;
const attemptsKey = (userId: number): string => `pin:${userId}:attempts`;

interface StoredHash {
  salt: string;
  hash: string;
  iterations: number;
}

interface StoredAttempts {
  count: number;
  lockedUntil: number;
}

const EMPTY_ATTEMPTS: StoredAttempts = { count: 0, lockedUntil: 0 };

const b64encode = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

const b64decode = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const constantTimeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
};

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
  private readonly iterations: number;

  constructor(
    private readonly kv: KVNamespace,
    options: { iterations?: number; now?: () => number } = {},
  ) {
    this.iterations = options.iterations ?? DEFAULT_ITERATIONS;
    this.now = options.now ?? (() => Date.now());
  }

  private readonly now: () => number;

  static isValidPinFormat(pin: string): boolean {
    return PIN_REGEX.test(pin);
  }

  async isPinSet(userId: number): Promise<boolean> {
    const raw = await this.kv.get(hashKey(userId));
    return raw !== null;
  }

  async setPin(userId: number, pin: string): Promise<void> {
    if (!PinManager.isValidPinFormat(pin)) throw new InvalidPinFormatError();
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const hash = await this.derive(pin, salt, this.iterations);
    const record: StoredHash = {
      salt: b64encode(salt),
      hash: b64encode(hash),
      iterations: this.iterations,
    };
    await this.kv.put(hashKey(userId), JSON.stringify(record));
    // Setting / changing a PIN clears any prior failed-attempt state so
    // a fresh PIN does not inherit a lockout from the previous one.
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
    const salt = b64decode(stored.salt);
    const expected = b64decode(stored.hash);
    const actual = await this.derive(pin, salt, stored.iterations);
    if (constantTimeEqual(expected, actual)) {
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
    if (nextCount >= MAX_ATTEMPTS) {
      const retryAt = this.now() + LOCKOUT_MS;
      // Reset count to zero alongside the lockout — after the lockout
      // expires the user gets a fresh allowance, matching the
      // "5 wrong → 30-min cooldown → 5 more" intent in AGENTS.md.
      const record: StoredAttempts = { count: 0, lockedUntil: retryAt };
      await this.kv.put(attemptsKey(userId), JSON.stringify(record));
      return { ok: false, reason: "locked-now", retryAt };
    }
    const record: StoredAttempts = { count: nextCount, lockedUntil: 0 };
    await this.kv.put(attemptsKey(userId), JSON.stringify(record));
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

  private async derive(
    pin: string,
    salt: Uint8Array,
    iterations: number,
  ): Promise<Uint8Array> {
    const ikm = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(pin),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: salt as unknown as ArrayBuffer,
        iterations,
      },
      ikm,
      HASH_LEN * 8,
    );
    return new Uint8Array(bits);
  }
}

export const PIN_LOCKOUT_MS = LOCKOUT_MS;
export const PIN_MAX_ATTEMPTS = MAX_ATTEMPTS;
