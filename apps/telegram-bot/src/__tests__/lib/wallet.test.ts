import { describe, it, expect, beforeEach } from "vitest";

import { WalletManager, type StoredWallet } from "../../lib/wallet.js";

/**
 * Minimal in-memory KVNamespace mock. Only `get` / `put` are needed by
 * WalletManager; the rest of the interface stays unimplemented and would
 * throw if accidentally called — preferred over a permissive `any` cast.
 */
class MemoryKV {
  private readonly store = new Map<string, string>();
  failPut = false;

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    if (this.failPut) throw new Error("kv put failed");
    this.store.set(key, value);
  }
}

const kv = (): MemoryKV => new MemoryKV();

const b64key = (seed: number): string => {
  const bytes = new Uint8Array(32);
  // Deterministic non-zero pattern so two different seeds produce
  // genuinely different keys (not just shifted by 1 byte).
  for (let i = 0; i < 32; i++) bytes[i] = (seed * 31 + i * 7 + 1) & 0xff;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

const PRIVATE_KEY =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as const;

describe("WalletManager", () => {
  let store: MemoryKV;

  beforeEach(() => {
    store = kv();
  });

  describe("constructor", () => {
    it("rejects a MASTER_KEY that is not 32 bytes after base64 decode", () => {
      expect(() => new WalletManager(store as unknown as KVNamespace, "AAAA"))
        .toThrow(/MASTER_KEY/);
    });
  });

  describe("generate", () => {
    it("returns a 0x-prefixed 64-hex-char private key and a checksum address", () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const { privateKey, address } = wm.generate();
      expect(privateKey).toMatch(/^0x[0-9a-f]{64}$/);
      expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it("returns a different key every call", () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const a = wm.generate();
      const b = wm.generate();
      expect(a.privateKey).not.toBe(b.privateKey);
      expect(a.address).not.toBe(b.address);
    });
  });

  describe("encrypt / decrypt", () => {
    it("round-trips the original private key", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const ct = await wm.encrypt(PRIVATE_KEY, 42);
      const pt = await wm.decrypt(ct, 42);
      expect(pt).toBe(PRIVATE_KEY);
    });

    it("produces different ciphertexts on every call (random IV)", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const a = await wm.encrypt(PRIVATE_KEY, 42);
      const b = await wm.encrypt(PRIVATE_KEY, 42);
      expect(a).not.toBe(b);
    });

    it("produces different ciphertexts for the same key + plaintext under different userIds", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const a = await wm.encrypt(PRIVATE_KEY, 1);
      const b = await wm.encrypt(PRIVATE_KEY, 2);
      // IV alone would make these differ; what we actually care about is
      // that user 1's ciphertext cannot be decrypted under user 2's
      // derived key — the next test enforces that.
      expect(a).not.toBe(b);
    });

    it("decrypting another user's ciphertext throws (per-user key isolation)", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const ct = await wm.encrypt(PRIVATE_KEY, 1);
      await expect(wm.decrypt(ct, 2)).rejects.toThrow();
    });

    it("decrypting under a different MASTER_KEY throws (GCM tag fails)", async () => {
      const a = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const b = new WalletManager(store as unknown as KVNamespace, b64key(2));
      const ct = await a.encrypt(PRIVATE_KEY, 42);
      await expect(b.decrypt(ct, 42)).rejects.toThrow();
    });

    it("rejects ciphertext shorter than the IV", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      // 8 random bytes < 12-byte IV
      const tooShort = btoa("\x00\x01\x02\x03\x04\x05\x06\x07");
      await expect(wm.decrypt(tooShort, 42)).rejects.toThrow(/too short/);
    });
  });

  describe("save / load", () => {
    it("persists and retrieves the StoredWallet record", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const wallet: StoredWallet = {
        address: "0x0000000000000000000000000000000000000001",
        encryptedKey: "AAAA",
        label: "primary",
        createdAt: 1700000000,
      };
      await wm.save(42, "w1", wallet);
      const loaded = await wm.load(42, "w1");
      expect(loaded).toEqual(wallet);
    });

    it("returns null for an unknown walletId — never throws on miss", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      expect(await wm.load(42, "nope")).toBeNull();
    });

    it("propagates KV put failures — never silently succeeds", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      store.failPut = true;
      await expect(
        wm.save(42, "w1", {
          address: "0x0000000000000000000000000000000000000001",
          encryptedKey: "AAAA",
          createdAt: 0,
        }),
      ).rejects.toThrow(/kv put failed/);
    });

    it("keys different users' wallets independently", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const w1: StoredWallet = {
        address: "0x0000000000000000000000000000000000000001",
        encryptedKey: "AAAA",
        createdAt: 0,
      };
      const w2: StoredWallet = {
        address: "0x0000000000000000000000000000000000000002",
        encryptedKey: "BBBB",
        createdAt: 0,
      };
      await wm.save(1, "primary", w1);
      await wm.save(2, "primary", w2);
      expect(await wm.load(1, "primary")).toEqual(w1);
      expect(await wm.load(2, "primary")).toEqual(w2);
    });
  });
});
