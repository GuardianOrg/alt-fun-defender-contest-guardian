import { fetchTokenMeta } from "./api";

// Token names are immutable after launch, so this cache lives for the page lifetime.
const tokenNameMap = new Map<string, string>();

// Dedupes concurrent name lookups per address.
const inflightPrefetches = new Map<string, Promise<void>>();

/** Notified when a token name first lands in the cache. */
type TokenNameListener = (lowercasedAddress: string, name: string) => void;
const listeners = new Set<TokenNameListener>();

/** Subscribe to first-time name-resolution events. */
export function subscribeTokenName(listener: TokenNameListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyTokenNameResolved(
  lowercasedAddress: string,
  name: string,
): void {
  for (const listener of listeners) {
    try {
      listener(lowercasedAddress, name);
    } catch (err) {
      // One listener should not poison the cache notification fan-out.
      console.warn("[tokenNames] subscriber threw:", err);
    }
  }
}

/** Synchronous lookup with truncated-address fallback. */
export function resolveTokenName(tokenAddress: string): string {
  return tokenNameMap.get(tokenAddress.toLowerCase())
    || `${tokenAddress.slice(0, 6)}…${tokenAddress.slice(-4)}`;
}

/** Whether this address has a resolved real name in cache. */
export function hasResolvedTokenName(tokenAddress: string): boolean {
  return tokenNameMap.has(tokenAddress.toLowerCase());
}

/** Seed the name cache from API/WS-enriched labels without another fetch. */
export function ingestResolvedTokenName(
  tokenAddress: string,
  name: string | undefined | null,
): void {
  if (!name) return;
  const trimmed = name.trim();
  if (trimmed === "") return;
  const key = tokenAddress.toLowerCase();
  if (tokenNameMap.has(key)) return;
  tokenNameMap.set(key, trimmed);
  notifyTokenNameResolved(key, trimmed);
}

/** Best-effort token-name fetch with inflight dedupe and listener notification. */
export async function prefetchTokenName(tokenAddress: string): Promise<void> {
  const key = tokenAddress.toLowerCase();
  if (tokenNameMap.has(key)) return;

  const inflight = inflightPrefetches.get(key);
  if (inflight) return inflight;

  const promise = fetchTokenMeta(tokenAddress)
    .then((token) => {
      if (!token) return;
      // Blank labels are unresolved, not cacheable.
      const name =
        token.symbol?.trim() || token.name?.trim() || "";
      if (!name) return;
      // A concurrent WS/API ingest may have won while this fetch was in flight.
      if (tokenNameMap.has(key)) return;
      tokenNameMap.set(key, name);
      notifyTokenNameResolved(key, name);
    })
    .finally(() => {
      inflightPrefetches.delete(key);
    });

  inflightPrefetches.set(key, promise);
  return promise;
}
