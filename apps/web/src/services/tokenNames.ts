import { fetchTokenMeta } from "./api";

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
 * doesn't fan out into N parallel `fetchTokenMeta` calls.
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
 * Synchronously seed `tokenNameMap` with a name resolved by some other
 * source (currently the indexer-enriched `tokenSymbol` / `tokenName`
 * fields on the `Zap:Buy` / `Zap:Sell` trade broadcasts — see
 * `services/tradeFeed.ts`).
 *
 * Why this exists: the truncated-address fallback is only fine as a
 * transient placeholder; if the indexer already knows the symbol at
 * broadcast time, the client should display it on the very first row
 * instead of round-tripping through `prefetchTokenName` + the API
 * `/tokens/:address/meta` endpoint (which races the indexer's
 * checkpoint and was the root cause of issue #703). This helper
 * short-circuits that path.
 *
 * Semantics mirror `prefetchTokenName`:
 *   - Idempotent: a no-op once the cache is already populated.
 *   - Trims and rejects blank labels so a placeholder row from the
 *     `Factory:PairCreated` write doesn't poison the cache before
 *     `Bonding:TokenLaunched` lands.
 *   - Notifies `subscribeTokenName` listeners exactly once per address
 *     so already-rendered fallback rows heal in place.
 */
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

  const promise = fetchTokenMeta(tokenAddress)
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
      // Re-check the cache before writing so a concurrent
      // `ingestResolvedTokenName` (e.g. a WS broadcast arriving while
      // a REST-poll prefetch is in flight) wins-first and the listener
      // fires exactly once per address. Without this guard the inflight
      // `.then` would overwrite the ingest entry and double-notify
      // subscribers — a subtle source of redundant React renders and,
      // worse, a UI flicker if the two sources ever disagree.
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
