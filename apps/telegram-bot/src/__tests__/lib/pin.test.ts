import { describe, it, expect } from "vitest";

import {
  InvalidPinFormatError,
  PIN_LOCKOUT_MS,
  PIN_MAX_ATTEMPTS,
  PinManager,
} from "../../lib/pin.js";

class MemoryKV {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }
}

/**
 * bcrypt cost is exponential — rounds=12 (prod default) is ~250ms
 * per hash, rounds=4 (bcrypt minimum) is <5ms. The hash/verify
 * contract is identical across cost values, so the assertions are
 * unaffected; lockout tests do ≥5 hashes each so the cost dominates
 * if not pinned.
 */
const FAST_SALT_ROUNDS = 4;

const makeKv = (): MemoryKV => new MemoryKV();
const makePm = (kv: MemoryKV, now?: () => number): PinManager =>
  new PinManager(kv as unknown as KVNamespace, {
    saltRounds: FAST_SALT_ROUNDS,
    now,
  });

describe("PinManager", () => {
  describe("format", () => {
    it("isValidPinFormat accepts 6 digits and rejects everything else", () => {
      expect(PinManager.isValidPinFormat("123456")).toBe(true);
      expect(PinManager.isValidPinFormat("000000")).toBe(true);
      expect(PinManager.isValidPinFormat("12345")).toBe(false);
      expect(PinManager.isValidPinFormat("1234567")).toBe(false);
      expect(PinManager.isValidPinFormat("12345a")).toBe(false);
      expect(PinManager.isValidPinFormat(" 123456 ")).toBe(false);
      expect(PinManager.isValidPinFormat("")).toBe(false);
    });

    it("setPin throws on malformed PIN", async () => {
      const pm = makePm(makeKv());
      await expect(pm.setPin(7, "12345")).rejects.toThrow(
        InvalidPinFormatError,
      );
      await expect(pm.setPin(7, "abcdef")).rejects.toThrow(
        InvalidPinFormatError,
      );
    });
  });

  describe("set / verify", () => {
    it("correct PIN verifies successfully", async () => {
      const pm = makePm(makeKv());
      await pm.setPin(7, "123456");
      const result = await pm.verifyPin(7, "123456");
      expect(result.ok).toBe(true);
    });

    it("isPinSet flips false → true after setPin", async () => {
      const pm = makePm(makeKv());
      expect(await pm.isPinSet(7)).toBe(false);
      await pm.setPin(7, "123456");
      expect(await pm.isPinSet(7)).toBe(true);
    });

    it("verify before any PIN is set returns 'unset' rather than 'wrong'", async () => {
      const pm = makePm(makeKv());
      const result = await pm.verifyPin(7, "123456");
      expect(result).toEqual({ ok: false, reason: "unset" });
    });

    it("wrong PIN increments attempt counter and reports attemptsRemaining", async () => {
      const pm = makePm(makeKv());
      await pm.setPin(7, "123456");
      const first = await pm.verifyPin(7, "000000");
      expect(first).toEqual({
        ok: false,
        reason: "wrong",
        attemptsRemaining: PIN_MAX_ATTEMPTS - 1,
      });
      const second = await pm.verifyPin(7, "111111");
      expect(second).toEqual({
        ok: false,
        reason: "wrong",
        attemptsRemaining: PIN_MAX_ATTEMPTS - 2,
      });
    });

    it("successful PIN clears the attempt counter (next wrong PIN starts over)", async () => {
      const pm = makePm(makeKv());
      await pm.setPin(7, "123456");
      await pm.verifyPin(7, "000000");
      await pm.verifyPin(7, "111111");
      const ok = await pm.verifyPin(7, "123456");
      expect(ok.ok).toBe(true);
      const wrongAfter = await pm.verifyPin(7, "999999");
      expect(wrongAfter).toEqual({
        ok: false,
        reason: "wrong",
        attemptsRemaining: PIN_MAX_ATTEMPTS - 1,
      });
    });

    it("malformed PIN attempt during verify increments the wrong-attempt counter", async () => {
      const pm = makePm(makeKv());
      await pm.setPin(7, "123456");
      const result = await pm.verifyPin(7, "12");
      expect(result).toEqual({
        ok: false,
        reason: "wrong",
        attemptsRemaining: PIN_MAX_ATTEMPTS - 1,
      });
    });
  });

  describe("lockout", () => {
    it("5 wrong attempts sets a lockout 30 minutes ahead", async () => {
      const fixed = 1_700_000_000_000;
      const kv = makeKv();
      const pm = makePm(kv, () => fixed);
      await pm.setPin(7, "123456");
      let last: Awaited<ReturnType<PinManager["verifyPin"]>> | undefined;
      for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) {
        last = await pm.verifyPin(7, "000000");
      }
      expect(last).toEqual({
        ok: false,
        reason: "locked-now",
        retryAt: fixed + PIN_LOCKOUT_MS,
      });
    });

    it("attempt during lockout rejects immediately without checking the hash", async () => {
      const fixed = 1_700_000_000_000;
      const kv = makeKv();
      const pm = makePm(kv, () => fixed);
      await pm.setPin(7, "123456");
      for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) {
        await pm.verifyPin(7, "000000");
      }
      // Even the correct PIN must be rejected while the lockout is hot.
      // Without the early-return, a 5th wrong attempt + correct 6th
      // would let an attacker through.
      const stillLocked = await pm.verifyPin(7, "123456");
      expect(stillLocked).toEqual({
        ok: false,
        reason: "locked",
        retryAt: fixed + PIN_LOCKOUT_MS,
      });
    });

    it("lockout expires after 30 minutes — correct PIN then succeeds", async () => {
      let nowMs = 1_700_000_000_000;
      const kv = makeKv();
      const pm = makePm(kv, () => nowMs);
      await pm.setPin(7, "123456");
      for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) {
        await pm.verifyPin(7, "000000");
      }
      nowMs += PIN_LOCKOUT_MS + 1;
      const result = await pm.verifyPin(7, "123456");
      expect(result.ok).toBe(true);
    });

    it("setPin clears any existing lockout (so PIN change frees the account)", async () => {
      const fixed = 1_700_000_000_000;
      const kv = makeKv();
      const pm = makePm(kv, () => fixed);
      await pm.setPin(7, "123456");
      for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) {
        await pm.verifyPin(7, "000000");
      }
      await pm.setPin(7, "654321");
      const result = await pm.verifyPin(7, "654321");
      expect(result.ok).toBe(true);
    });
  });
});
