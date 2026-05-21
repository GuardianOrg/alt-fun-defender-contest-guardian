import type { Token } from "../services/types";

// Sticky graduated registry: graduation is one-way, degraded API responses are not.
const STORAGE_KEY = "altfun.graduatedRatchet.v1";

function getSessionStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function loadInitial(): Set<string> {
  const storage = getSessionStorage();
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((v): v is string => typeof v === "string" && v.length > 0),
    );
  } catch {
    return new Set();
  }
}

const graduatedAddresses = loadInitial();

function persist(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify(Array.from(graduatedAddresses)),
    );
  } catch {
    // In-memory set still protects this page lifecycle.
  }
}

function normalize(address: string): string {
  return address.toLowerCase();
}

/** Mark `address` as graduated; repeat calls skip storage writes. */
export function markGraduated(address: string): void {
  const key = normalize(address);
  if (graduatedAddresses.has(key)) return;
  graduatedAddresses.add(key);
  persist();
}

/** Whether this tab has seen `address` as graduated. */
export function isKnownGraduated(address: string | undefined): boolean {
  if (!address) return false;
  return graduatedAddresses.has(normalize(address));
}

/** Test-only reset; production never clears the ratchet. */
export function _resetGraduationRatchetForTesting(): void {
  graduatedAddresses.clear();
  const storage = getSessionStorage();
  if (storage) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Match the swallow-on-failure policy of the persist path.
    }
  }
}

/** Pin status to graduated after this tab has observed the one-way transition. */
export function applyGraduationRatchet(token: Token): Token {
  if (token.status === "graduated") {
    markGraduated(token.address);
    return token;
  }
  if (!isKnownGraduated(token.address)) return token;
  return { ...token, status: "graduated" };
}
