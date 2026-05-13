import { describe, it, expect } from "vitest";

import {
  SecurityState,
  WITHDRAW_LOCK_DISABLE_COOLDOWN_MS,
} from "../../lib/security-state.js";

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
}

const makeState = (now?: () => number): { state: SecurityState; kv: MemoryKV } => {
  const kv = new MemoryKV();
  return {
    state: new SecurityState(kv as unknown as KVNamespace, { now }),
    kv,
  };
};

describe("SecurityState", () => {
  describe("withdraw lock", () => {
    it("defaults to disabled with no pending request", async () => {
      const { state } = makeState();
      expect(await state.getWithdrawLock(7)).toEqual({
        enabled: false,
        disableRequestedAt: null,
      });
    });

    it("enableWithdrawLock flips the flag", async () => {
      const { state } = makeState();
      await state.enableWithdrawLock(7);
      const lock = await state.getWithdrawLock(7);
      expect(lock.enabled).toBe(true);
      expect(lock.disableRequestedAt).toBeNull();
    });

    it("first disable call records a request 24h ahead and leaves the lock enabled", async () => {
      const fixed = 1_700_000_000_000;
      const { state } = makeState(() => fixed);
      await state.enableWithdrawLock(7);
      const result = await state.requestDisableWithdrawLock(7);
      expect(result).toEqual({
        kind: "pending",
        readyAt: fixed + WITHDRAW_LOCK_DISABLE_COOLDOWN_MS,
      });
      // Still enabled — disable is intentionally not instant.
      expect((await state.getWithdrawLock(7)).enabled).toBe(true);
    });

    it("second disable call inside the cooldown still returns pending and keeps the original readyAt", async () => {
      let nowMs = 1_700_000_000_000;
      const { state } = makeState(() => nowMs);
      await state.enableWithdrawLock(7);
      await state.requestDisableWithdrawLock(7);
      nowMs += 60 * 60 * 1000;
      const result = await state.requestDisableWithdrawLock(7);
      expect(result).toEqual({
        kind: "pending",
        readyAt: 1_700_000_000_000 + WITHDRAW_LOCK_DISABLE_COOLDOWN_MS,
      });
      expect((await state.getWithdrawLock(7)).enabled).toBe(true);
    });

    it("second disable call after the cooldown clears the lock", async () => {
      let nowMs = 1_700_000_000_000;
      const { state } = makeState(() => nowMs);
      await state.enableWithdrawLock(7);
      await state.requestDisableWithdrawLock(7);
      nowMs += WITHDRAW_LOCK_DISABLE_COOLDOWN_MS + 1;
      const result = await state.requestDisableWithdrawLock(7);
      expect(result).toEqual({ kind: "disabled" });
      expect(await state.getWithdrawLock(7)).toEqual({
        enabled: false,
        disableRequestedAt: null,
      });
    });

    it("disable on an unenabled lock returns 'not-enabled' without writing to KV", async () => {
      const { state } = makeState();
      const result = await state.requestDisableWithdrawLock(7);
      expect(result).toEqual({ kind: "not-enabled" });
      expect(await state.getWithdrawLock(7)).toEqual({
        enabled: false,
        disableRequestedAt: null,
      });
    });

    it("cancelDisableWithdrawLock wipes the pending request and keeps the lock enabled", async () => {
      const { state } = makeState();
      await state.enableWithdrawLock(7);
      await state.requestDisableWithdrawLock(7);
      await state.cancelDisableWithdrawLock(7);
      const lock = await state.getWithdrawLock(7);
      expect(lock.enabled).toBe(true);
      expect(lock.disableRequestedAt).toBeNull();
    });

    it("cancelDisableWithdrawLock on a lock with no pending request is a no-op", async () => {
      const { state } = makeState();
      await state.enableWithdrawLock(7);
      await state.cancelDisableWithdrawLock(7);
      expect(await state.getWithdrawLock(7)).toEqual({
        enabled: true,
        disableRequestedAt: null,
      });
    });
  });
});
