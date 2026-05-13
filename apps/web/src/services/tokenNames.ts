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
 * Subscribers notified whenever a token name lands in `tokenNameMap`.
 * Lets consumers (e.g. `useTradeFeed`) heal rows that were rendered with
 * the truncated-address fallback before the Ponder fetch resolved. The
 * callback receives the lowercased address (the canonical map key) and
 * the resolved display name so listeners can match without re-lowering.
 */
type TokenNameListener = (lowercasedAddress: string, name: string) => void;
const listeners = new Set<TokenNameListener>();

/**
 * Subscribe to name-resolution events. Fires once per address the first
 * time a name is added to the cache; never fires again for that address
 * because names don't change after launch. Returns an unsubscribe.
 */
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
      // A misbehaving listener shouldn't poison the rest. Mirrors the
      // best-effort posture of the surrounding cache code.
      console.warn("[tokenNames] subscriber threw:", err);
    }
  }
}

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
 * True iff `prefetchTokenName` has resolved a real name for this address.
 * Lets consumers distinguish "rendered with truncated-address fallback"
 * from "rendered with the resolved symbol" without restringifying — used
 * by the trade-feed retry loop to decide which rows still need warming.
 */
export function hasResolvedTokenName(tokenAddress: string): boolean {
  return tokenNameMap.has(tokenAddress.toLowerCase());
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
 *
 * When a name is added to the cache for the first time, all
 * `subscribeTokenName` listeners are notified so already-rendered rows
 * can swap their truncated-address fallback for the resolved symbol.
 */
export async function prefetchTokenName(tokenAddress: string): Promise<void> {
  const key = tokenAddress.toLowerCase();
  if (tokenNameMap.has(key)) return;

  const inflight = inflightPrefetches.get(key);
  if (inflight) return inflight;

  const promise = fetchPonderToken(tokenAddress)
    .then((token) => {
      if (!token) return;
      // Guard against an indexer payload with both fields blank: caching
      // an empty string would flip `hasResolvedTokenName` to true and
      // freeze the row on a blank label (the fallback in `resolveTokenName`
      // only fires when the cache misses). Treat that as "not yet
      // resolved" so the next prefetch retries.
      //
      // Each field is trimmed independently before the `||` fallback so a
      // whitespace-only `symbol` still defers to a real `name` — `"   "`
      // is otherwise truthy and would short-circuit `name` away.
      const name =
        token.symbol?.trim() || token.name?.trim() || "";
      if (!name) return;
      tokenNameMap.set(key, name);
      notifyTokenNameResolved(key, name);
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
