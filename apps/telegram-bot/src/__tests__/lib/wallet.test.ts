import { describe, it, expect, beforeEach } from "vitest";
import { privateKeyToAddress } from "viem/accounts";

import {
  DuplicateWalletError,
  InvalidPrivateKeyError,
  MAX_WALLETS_PER_USER,
  TooManyWalletsError,
  WalletManager,
  WalletNotFoundError,
  generateWalletId,
  parsePrivateKey,
  type StoredWallet,
  type WalletIndex,
} from "../../lib/wallet.js";

/**
 * Minimal in-memory KVNamespace mock. Only `get` / `put` / `delete` are
 * used by WalletManager; the rest of the interface stays unimplemented
 * and would throw if accidentally called — preferred over a permissive
 * `any` cast.
 */
class MemoryKV {
  private readonly store = new Map<string, string>();
  failPut = false;
  failDelete = false;

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    if (this.failPut) throw new Error("kv put failed");
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    if (this.failDelete) throw new Error("kv delete failed");
    this.store.delete(key);
  }

  size(): number {
    return this.store.size;
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

const baseWallet = (overrides: Partial<StoredWallet> = {}): StoredWallet => ({
  id: "w_test01",
  address: "0x0000000000000000000000000000000000000001",
  encryptedKey: "AAAA",
  createdAt: 0,
  ...overrides,
});

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

  describe("generateWalletId", () => {
    it("returns an id matching the `w_` + 6 base32 char shape", () => {
      const id = generateWalletId();
      expect(id).toMatch(/^w_[0-9a-hjkmnpqrstvwxyz]{6}$/);
    });

    it("returns a unique id on each call (1000-sample collision check)", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) ids.add(generateWalletId());
      expect(ids.size).toBe(1000);
    });

    it("stays inside the 64-byte Telegram callback_data budget when combined with an action prefix", () => {
      // Worst-case shape: `s:<walletId>:100` (sell 100% of the active
      // wallet's holdings of some token). The walletId portion has to
      // leave headroom for the action and percentage.
      const id = generateWalletId();
      const payload = `s:${id}:100`;
      expect(new TextEncoder().encode(payload).length).toBeLessThanOrEqual(64);
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
      const tooShort = btoa("\x00\x01\x02\x03\x04\x05\x06\x07");
      await expect(wm.decrypt(tooShort, 42)).rejects.toThrow(/too short/);
    });
  });

  describe("save / getWallet (low-level primitives)", () => {
    it("persists and retrieves the StoredWallet record", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const wallet = baseWallet({ id: "w_primary", label: "primary", createdAt: 1700000000 });
      await wm.save(42, wallet);
      const loaded = await wm.getWallet(42, "w_primary");
      expect(loaded).toEqual(wallet);
    });

    it("returns null for an unknown walletId — never throws on miss", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      expect(await wm.getWallet(42, "w_nope")).toBeNull();
    });

    it("propagates KV put failures — never silently succeeds", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      store.failPut = true;
      await expect(wm.save(42, baseWallet())).rejects.toThrow(/kv put failed/);
    });

    it("keys different users' wallets independently", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const w1 = baseWallet({ id: "w_a", address: "0x0000000000000000000000000000000000000001" });
      const w2 = baseWallet({ id: "w_a", address: "0x0000000000000000000000000000000000000002" });
      await wm.save(1, w1);
      await wm.save(2, w2);
      expect(await wm.getWallet(1, "w_a")).toEqual(w1);
      expect(await wm.getWallet(2, "w_a")).toEqual(w2);
    });
  });

  describe("createWallet", () => {
    it("creates a wallet with a unique id and encrypted key, and lists it", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const wallet = await wm.createWallet(1, "primary");
      expect(wallet.id).toMatch(/^w_[0-9a-hjkmnpqrstvwxyz]{6}$/);
      expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(wallet.label).toBe("primary");
      expect(wallet.encryptedKey).not.toContain(wallet.address);

      const list = await wm.listWallets(1);
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe(wallet.id);
    });

    it("makes the first wallet active automatically", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const wallet = await wm.createWallet(1);
      const active = await wm.getActive(1);
      expect(active?.id).toBe(wallet.id);
    });

    it("does not overwrite an existing active when a second wallet is created", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const first = await wm.createWallet(1, "main");
      await wm.createWallet(1, "alt");
      const active = await wm.getActive(1);
      expect(active?.id).toBe(first.id);
    });

    it("rejects creation past the per-user cap with TooManyWalletsError", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      for (let i = 0; i < MAX_WALLETS_PER_USER; i++) {
        await wm.createWallet(1, `w${i}`);
      }
      await expect(wm.createWallet(1, "overflow")).rejects.toThrow(TooManyWalletsError);
      expect((await wm.listWallets(1)).length).toBe(MAX_WALLETS_PER_USER);
    });

    it("private keys round-trip through encrypt -> store -> decrypt for each created wallet", async () => {
      // Proves the high-level createWallet wires the same userId into
      // both encrypt and decrypt; a subtle bug here would make every
      // future signed tx fail at decrypt time.
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const wallet = await wm.createWallet(1);
      const pt = await wm.decrypt(wallet.encryptedKey, 1);
      expect(pt).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("keeps different users' indexes independent", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      await wm.createWallet(1, "a");
      await wm.createWallet(2, "b");
      const u1 = await wm.listWallets(1);
      const u2 = await wm.listWallets(2);
      expect(u1).toHaveLength(1);
      expect(u2).toHaveLength(1);
      expect(u1[0]?.id).not.toBe(u2[0]?.id);
    });
  });

  describe("parsePrivateKey", () => {
    it("accepts a 0x-prefixed 64 hex char string", () => {
      expect(parsePrivateKey(PRIVATE_KEY)).toBe(PRIVATE_KEY);
    });

    it("trims surrounding whitespace before validation", () => {
      expect(parsePrivateKey(`  ${PRIVATE_KEY}  \n`)).toBe(PRIVATE_KEY);
    });

    it("auto-prepends the 0x prefix when missing", () => {
      const bare = PRIVATE_KEY.slice(2);
      expect(parsePrivateKey(bare)).toBe(PRIVATE_KEY);
    });

    it("lowercases mixed-case hex so storage is canonical", () => {
      const mixed = `0x${"AbCdEf12".repeat(8)}`;
      expect(parsePrivateKey(mixed)).toBe(mixed.toLowerCase());
    });

    it("rejects shapes that are not 64 hex chars", () => {
      expect(parsePrivateKey("")).toBeNull();
      expect(parsePrivateKey("0x1234")).toBeNull();
      expect(parsePrivateKey(`0x${"z".repeat(64)}`)).toBeNull();
      expect(parsePrivateKey(`0x${"a".repeat(63)}`)).toBeNull();
      expect(parsePrivateKey(`0x${"a".repeat(65)}`)).toBeNull();
    });
  });

  describe("importWallet", () => {
    it("derives the address from the private key and lists the wallet", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const wallet = await wm.importWallet(1, PRIVATE_KEY, "imported");
      expect(wallet.address).toBe(privateKeyToAddress(PRIVATE_KEY));
      expect(wallet.label).toBe("imported");
      expect(wallet.encryptedKey).not.toContain(PRIVATE_KEY.slice(2));
      const list = await wm.listWallets(1);
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe(wallet.id);
    });

    it("round-trips the imported key through encrypt -> store -> decrypt", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const wallet = await wm.importWallet(1, PRIVATE_KEY);
      const pt = await wm.decrypt(wallet.encryptedKey, 1);
      expect(pt).toBe(PRIVATE_KEY);
    });

    it("makes the first imported wallet active automatically", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const wallet = await wm.importWallet(1, PRIVATE_KEY);
      expect((await wm.getActive(1))?.id).toBe(wallet.id);
    });

    it("rejects a duplicate import of the same key (DuplicateWalletError)", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      await wm.importWallet(1, PRIVATE_KEY);
      await expect(wm.importWallet(1, PRIVATE_KEY)).rejects.toThrow(
        DuplicateWalletError,
      );
      expect((await wm.listWallets(1))).toHaveLength(1);
    });

    it("rejects an import that would push the user past MAX_WALLETS_PER_USER", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      for (let i = 0; i < MAX_WALLETS_PER_USER; i++) {
        await wm.createWallet(1, `w${i}`);
      }
      await expect(wm.importWallet(1, PRIVATE_KEY)).rejects.toThrow(
        TooManyWalletsError,
      );
      expect((await wm.listWallets(1)).length).toBe(MAX_WALLETS_PER_USER);
    });

    it("rejects a malformed private key with InvalidPrivateKeyError", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      await expect(
        wm.importWallet(1, "0xnothex" as unknown as `0x${string}`),
      ).rejects.toThrow(InvalidPrivateKeyError);
      expect(await wm.listWallets(1)).toEqual([]);
    });

    it("allows the same key to be imported by two different users (per-user isolation)", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const a = await wm.importWallet(1, PRIVATE_KEY);
      const b = await wm.importWallet(2, PRIVATE_KEY);
      expect(a.address).toBe(b.address);
      // Ciphertexts must differ — per-user HKDF derivation guarantees
      // one user's leak cannot unlock the other's record.
      expect(a.encryptedKey).not.toBe(b.encryptedKey);
    });
  });

  describe("setActive / getActive", () => {
    it("getActive returns null when no wallets exist", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      expect(await wm.getActive(1)).toBeNull();
    });

    it("setActive switches between existing wallets", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const a = await wm.createWallet(1, "a");
      const b = await wm.createWallet(1, "b");
      await wm.setActive(1, b.id);
      expect((await wm.getActive(1))?.id).toBe(b.id);
      await wm.setActive(1, a.id);
      expect((await wm.getActive(1))?.id).toBe(a.id);
    });

    it("setActive on an unknown wallet throws WalletNotFoundError", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      await wm.createWallet(1, "a");
      await expect(wm.setActive(1, "w_nope")).rejects.toThrow(WalletNotFoundError);
    });

    it("setActive is a no-op when the target is already active (no spurious KV write)", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const wallet = await wm.createWallet(1, "a");
      store.failPut = true;
      // Would throw if writeIndex ran.
      await expect(wm.setActive(1, wallet.id)).resolves.toBeUndefined();
    });
  });

  describe("renameWallet", () => {
    it("updates only the label and leaves address + encrypted material untouched", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const wallet = await wm.createWallet(1, "old");
      const renamed = await wm.renameWallet(1, wallet.id, "new");
      expect(renamed.label).toBe("new");
      expect(renamed.address).toBe(wallet.address);
      expect(renamed.encryptedKey).toBe(wallet.encryptedKey);
      const reloaded = await wm.getWallet(1, wallet.id);
      expect(reloaded?.label).toBe("new");
    });

    it("throws WalletNotFoundError on an unknown wallet", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      await expect(wm.renameWallet(1, "w_nope", "x")).rejects.toThrow(WalletNotFoundError);
    });
  });

  describe("deleteWallet", () => {
    it("removes the wallet from the index and KV", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const a = await wm.createWallet(1, "a");
      const b = await wm.createWallet(1, "b");
      await wm.deleteWallet(1, a.id);
      const list = await wm.listWallets(1);
      expect(list.map((w) => w.id)).toEqual([b.id]);
      expect(await wm.getWallet(1, a.id)).toBeNull();
    });

    it("reassigns active when the active wallet is deleted", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const a = await wm.createWallet(1, "a"); // becomes active
      const b = await wm.createWallet(1, "b");
      await wm.deleteWallet(1, a.id);
      expect((await wm.getActive(1))?.id).toBe(b.id);
    });

    it("leaves active alone when a non-active wallet is deleted", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const a = await wm.createWallet(1, "a"); // active
      const b = await wm.createWallet(1, "b");
      await wm.deleteWallet(1, b.id);
      expect((await wm.getActive(1))?.id).toBe(a.id);
    });

    it("sets active to null when the last wallet is deleted", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const a = await wm.createWallet(1, "a");
      await wm.deleteWallet(1, a.id);
      expect(await wm.getActive(1)).toBeNull();
      expect(await wm.listWallets(1)).toEqual([]);
    });

    it("throws WalletNotFoundError on an unknown wallet", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      await expect(wm.deleteWallet(1, "w_nope")).rejects.toThrow(WalletNotFoundError);
    });
  });

  describe("listWallets", () => {
    it("returns wallets in creation order (matches Trojan UX expectation)", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      const a = await wm.createWallet(1, "a");
      const b = await wm.createWallet(1, "b");
      const c = await wm.createWallet(1, "c");
      expect((await wm.listWallets(1)).map((w) => w.id)).toEqual([a.id, b.id, c.id]);
    });

    it("returns [] for a user with no wallets — never throws", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      expect(await wm.listWallets(1)).toEqual([]);
    });

    it("drops orphan index entries instead of crashing the picker", async () => {
      const wm = new WalletManager(store as unknown as KVNamespace, b64key(1));
      // Hand-craft an index that points to a wallet that was never
      // persisted. `listWallets` must filter it out so a single bad
      // entry can't bring the whole `/wallet` screen down.
      const orphanIndex: WalletIndex = {
        wallets: ["w_orphan"],
        active: "w_orphan",
      };
      await store.put("wallet:1:index", JSON.stringify(orphanIndex));
      expect(await wm.listWallets(1)).toEqual([]);
    });
  });
});
