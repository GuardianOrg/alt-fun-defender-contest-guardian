import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import type { Address, Hex } from "viem";

export interface StoredWallet {
  address: Address;
  encryptedKey: string;
  label?: string;
  createdAt: number;
}

const IV_LEN = 12;
const MASTER_KEY_LEN = 32;

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

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};

const walletKey = (userId: number, walletId: string): string =>
  `wallet:${userId}:${walletId}`;

/**
 * Custodial key store. Private keys are encrypted with AES-256-GCM under
 * a per-user key derived from MASTER_KEY + userId via HKDF-SHA256 — same
 * master key never touches KV, and a single user's compromise cannot
 * decrypt another user's wallet because the derived key depends on userId.
 *
 * Rotating MASTER_KEY invalidates every stored wallet. There is no
 * re-encryption migration in v1; this is documented in
 * apps/telegram-bot/AGENTS.md.
 */
export class WalletManager {
  private readonly masterKey: Uint8Array;

  constructor(
    private readonly kv: KVNamespace,
    masterKeyB64: string,
  ) {
    const decoded = b64decode(masterKeyB64);
    if (decoded.length !== MASTER_KEY_LEN) {
      throw new Error(
        `MASTER_KEY must decode to ${MASTER_KEY_LEN} bytes, got ${decoded.length}`,
      );
    }
    this.masterKey = decoded;
  }

  generate(): { privateKey: Hex; address: Address } {
    const privateKey = generatePrivateKey();
    return { privateKey, address: privateKeyToAddress(privateKey) };
  }

  async encrypt(privateKey: Hex, userId: number): Promise<string> {
    const key = await this.deriveKey(userId);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const plaintext = new TextEncoder().encode(privateKey);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
    );
    return b64encode(concat(iv, ciphertext));
  }

  async decrypt(encryptedKey: string, userId: number): Promise<Hex> {
    const raw = b64decode(encryptedKey);
    if (raw.length <= IV_LEN) {
      throw new Error("ciphertext too short");
    }
    const iv = raw.slice(0, IV_LEN);
    const ciphertext = raw.slice(IV_LEN);
    const key = await this.deriveKey(userId);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(plaintext) as Hex;
  }

  async save(
    userId: number,
    walletId: string,
    wallet: StoredWallet,
  ): Promise<void> {
    await this.kv.put(walletKey(userId, walletId), JSON.stringify(wallet));
  }

  async load(
    userId: number,
    walletId: string,
  ): Promise<StoredWallet | null> {
    const raw = await this.kv.get(walletKey(userId, walletId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredWallet;
  }

  private async deriveKey(userId: number): Promise<CryptoKey> {
    const ikm = await crypto.subtle.importKey(
      "raw",
      this.masterKey,
      "HKDF",
      false,
      ["deriveKey"],
    );
    const info = new TextEncoder().encode(`wallet:${userId}`);
    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(0),
        info,
      },
      ikm,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
}
