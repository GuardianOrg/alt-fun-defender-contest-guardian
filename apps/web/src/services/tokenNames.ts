import { fetchPonderToken } from "./ponder";

/**
 * In-memory cache of token address → display name (symbol with name
 * fallback). Populated lazily by `prefetchTokenName`; read by
 * `resolveTokenName`. Lives for the lifetime of the page — names don't
 * change after launch, so cache invalidation isn't a concern.
 */
const tokenNameMap = new Map<string, string>();

/**
 * Inflight `prefetchTokenName` promises keyed by lowercased address.
 * Dedupes concurrent fetches so a burst of trades for the same token
 * doesn't fan out into N parallel `fetchPonderToken` calls.
 */
const inflightPrefetches = new Map<string, Promise<void>>();

/**
 * Synchronous lookup. Returns the cached display name if `prefetchTokenName`
 * has resolved for this address, otherwise a truncated address fallback so
 * UI rows always render something legible.
 */
export function resolveTokenName(tokenAddress: string): string {
  return tokenNameMap.get(tokenAddress.toLowerCase())
    || `${tokenAddress.slice(0, 6)}…${tokenAddress.slice(-4)}`;
}

/**
 * Best-effort fetch of a token's display name into `tokenNameMap`.
 * Idempotent and dedupes inflight requests, so callers can fire it for
 * every observed trade without hammering the API.
 *
 * The trade-feed warms the cache by calling this for every address in the
 * REST poll batch (parallelised) before mapping the trades — that way the
 * initial page render shows real symbols instead of truncated addresses.
 * It also fires the prefetch on each WS event so subsequent trades for
 * a brand-new token pick up its name once the first fetch lands.
 */
export async function prefetchTokenName(tokenAddress: string): Promise<void> {
  const key = tokenAddress.toLowerCase();
  if (tokenNameMap.has(key)) return;

  const inflight = inflightPrefetches.get(key);
  if (inflight) return inflight;

  const promise = fetchPonderToken(tokenAddress)
    .then((token) => {
      if (token) tokenNameMap.set(key, token.symbol || token.name);
    })
    .catch(() => {
      // Best effort — leave cache empty so the next call retries. The
      // truncated-address fallback in `resolveTokenName` keeps the UI
      // rendering meanwhile.
    })
    .finally(() => {
      inflightPrefetches.delete(key);
    });

  inflightPrefetches.set(key, promise);
  return promise;
}
