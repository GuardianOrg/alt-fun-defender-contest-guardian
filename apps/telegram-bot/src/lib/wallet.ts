import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import type { Address, Hex } from "viem";

export interface StoredWallet {
  id: string;
  address: Address;
  encryptedKey: string;
  label?: string;
  createdAt: number;
}

/**
 * Single index record per user, holding the ordered list of walletIds
 * the user owns plus a pointer to the active one. Lets `/wallet` render
 * the full picker in one KV read instead of a `list({prefix})` scan
 * (which is unordered, paginated, and slower).
 */
export interface WalletIndex {
  wallets: string[];
  active: string | null;
}

export const MAX_WALLETS_PER_USER = 10;

const IV_LEN = 12;
const MASTER_KEY_LEN = 32;
const WALLET_ID_PREFIX = "w_";
const WALLET_ID_BODY_LEN = 6;
// Crockford base32 — no 0/O, 1/I, L confusion. 32^6 ≈ 1.07e9 ids; with
// the 10-wallet cap, collision risk inside a single user is negligible.
const WALLET_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export class TooManyWalletsError extends Error {
  constructor() {
    super(`wallet cap reached (${MAX_WALLETS_PER_USER} per user)`);
    this.name = "TooManyWalletsError";
  }
}

export class WalletNotFoundError extends Error {
  constructor(walletId: string) {
    super(`wallet not found: ${walletId}`);
    this.name = "WalletNotFoundError";
  }
}

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

const indexKey = (userId: number): string => `wallet:${userId}:index`;

const EMPTY_INDEX: WalletIndex = { wallets: [], active: null };

/**
 * Generate a short opaque walletId. The 6-char body keeps the full id
 * (`w_xxxxxx` = 8 chars) inside the 64-byte `callback_data` budget when
 * combined with action codes like `s:w_xxxxxx:50` — UUIDs would not fit.
 * Exported for tests; production code goes through `createWallet`.
 */
export const generateWalletId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(WALLET_ID_BODY_LEN));
  let body = "";
  for (const b of bytes) body += WALLET_ID_ALPHABET[b % 32];
  return `${WALLET_ID_PREFIX}${body}`;
};

/**
 * Custodial key store + Trojan-style multi-wallet manager.
 *
 * Crypto: private keys are encrypted with AES-256-GCM under a per-user
 * key derived from `MASTER_KEY` + userId via HKDF-SHA256 — the master
 * key never touches KV, and one user's ciphertext leak cannot be
 * decrypted under another user's derivation. Rotating `MASTER_KEY`
 * invalidates every stored wallet; there is no re-encryption migration
 * in v1.
 *
 * Multi-wallet model (matches Trojan):
 *   - Up to MAX_WALLETS_PER_USER (10) wallets per Telegram user
 *   - One active wallet at a time, used as the implicit signer for buy /
 *     sell / withdraw
 *   - Wallet records keyed independently in KV so renaming /
 *     reordering is O(1) and never moves the encrypted material
 *   - Single index record per user tracks order + active pointer
 *
 * Concurrency: v1 assumes a user does not run parallel `/wallet`
 * mutations from two clients. Cloudflare KV provides strong
 * per-key consistency on the index but no cross-key transactions, so
 * a true race could partially update. If this becomes a problem,
 * promote to an `OnboardingDO`-style Durable Object.
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

  async save(userId: number, wallet: StoredWallet): Promise<void> {
    await this.kv.put(walletKey(userId, wallet.id), JSON.stringify(wallet));
  }

  async getWallet(
    userId: number,
    walletId: string,
  ): Promise<StoredWallet | null> {
    const raw = await this.kv.get(walletKey(userId, walletId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredWallet;
  }

  async listWallets(userId: number): Promise<StoredWallet[]> {
    const index = await this.readIndex(userId);
    const records = await Promise.all(
      index.wallets.map((id) => this.getWallet(userId, id)),
    );
    // Drop any nulls — would mean the index references a record that
    // failed to persist or was deleted out-of-band. Surfacing it as a
    // crash would block `/wallet` from rendering for that user.
    return records.filter((w): w is StoredWallet => w !== null);
  }

  async getActive(userId: number): Promise<StoredWallet | null> {
    const index = await this.readIndex(userId);
    if (!index.active) return null;
    return this.getWallet(userId, index.active);
  }

  async setActive(userId: number, walletId: string): Promise<void> {
    const index = await this.readIndex(userId);
    if (!index.wallets.includes(walletId)) {
      throw new WalletNotFoundError(walletId);
    }
    if (index.active === walletId) return;
    await this.writeIndex(userId, { ...index, active: walletId });
  }

  async createWallet(
    userId: number,
    label?: string,
  ): Promise<StoredWallet> {
    const index = await this.readIndex(userId);
    if (index.wallets.length >= MAX_WALLETS_PER_USER) {
      throw new TooManyWalletsError();
    }
    const { privateKey, address } = this.generate();
    const encryptedKey = await this.encrypt(privateKey, userId);
    // Collision-safe walletId. The base32-6 space (~1B ids) makes a
    // collision astronomically unlikely under the 10-per-user cap, but
    // a single overwrite would corrupt that user's wallet state, so
    // the cost of guarding is negligible vs the cost of being wrong.
    // Cap retries at 10 — past that the entropy source is suspect and
    // failing loudly beats spinning forever.
    const existingIds = new Set(index.wallets);
    let id = generateWalletId();
    for (let i = 0; existingIds.has(id) && i < 10; i++) {
      id = generateWalletId();
    }
    if (existingIds.has(id)) {
      throw new Error("walletId collision after 10 retries");
    }
    const wallet: StoredWallet = {
      id,
      address,
      encryptedKey,
      label,
      createdAt: Date.now(),
    };
    // Persist the wallet record before the index — if the index write
    // fails, the orphan record is harmless (listWallets won't surface
    // it). The reverse ordering would leave the index pointing at a
    // record that was never written.
    await this.save(userId, wallet);
    await this.writeIndex(userId, {
      wallets: [...index.wallets, wallet.id],
      active: index.active ?? wallet.id,
    });
    return wallet;
  }

  async renameWallet(
    userId: number,
    walletId: string,
    label: string,
  ): Promise<StoredWallet> {
    const wallet = await this.getWallet(userId, walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);
    const updated: StoredWallet = { ...wallet, label };
    await this.save(userId, updated);
    return updated;
  }

  async deleteWallet(userId: number, walletId: string): Promise<void> {
    const index = await this.readIndex(userId);
    const pos = index.wallets.indexOf(walletId);
    if (pos === -1) throw new WalletNotFoundError(walletId);
    const wallets = [...index.wallets.slice(0, pos), ...index.wallets.slice(pos + 1)];
    const active =
      index.active === walletId ? (wallets[0] ?? null) : index.active;
    // Index write first, then the record — if the record delete fails
    // the index is already consistent, and the orphan record will be
    // ignored by listWallets.
    await this.writeIndex(userId, { wallets, active });
    await this.kv.delete(walletKey(userId, walletId));
  }

  private async readIndex(userId: number): Promise<WalletIndex> {
    const raw = await this.kv.get(indexKey(userId));
    if (!raw) return { ...EMPTY_INDEX };
    return JSON.parse(raw) as WalletIndex;
  }

  private async writeIndex(
    userId: number,
    index: WalletIndex,
  ): Promise<void> {
    await this.kv.put(indexKey(userId), JSON.stringify(index));
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
