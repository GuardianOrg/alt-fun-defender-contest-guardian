/**
 * Per-isolate TTL cache with single-flight coalescing.
 *
 * Sits inside a Worker isolate (not at the edge) and memoises a single
 * fetcher's results by string key for a short TTL. The intended use is in
 * front of the hot single-token indexer reads (`fetchTokenOnchain`,
 * `fetchRouterTrades(token=…)`, `fetchHolders`, `fetchTokenChartSnapshots`) —
 * see issue #1125, solution #3.
 *
 * Why this layer exists separately from `serveFromEdgeCache`:
 *   - The edge cache keys on the full request URL; it absorbs identical
 *     URLs but not the burst of *distinct* hot-token routes (`/tokens/:a`,
 *     `/trades/:a`, `/holders/:a`, `/chart/:a`) that all fan out to the
 *     same Postgres rows. A 3s memo on the read functions collapses that
 *     fan-out inside the isolate even when the edge cache misses.
 *   - On a fresh edge miss, every concurrent in-isolate request races to
 *     the same Postgres rows. Without single-flight coalescing that's
 *     ~N redundant Neon HTTP calls per cold window per PoP. The Promise
 *     lock here cuts that to one.
 *
 * Mirrors the bespoke `fetchLiveLtRates` cache in `lib/market-data.ts` so
 * the operational behaviour is familiar — same TTL semantics, same
 * inflight coalescing, same module-level state. Generalised here because
 * we now have several call sites that want the same pattern.
 *
 * Negative-result handling: the indexer-reads contract returns `null` on
 * caught error and `"unavailable"` for transient transport failures.
 * Callers pass a `shouldCache` predicate so error sentinels never get
 * pinned for the TTL window — a one-off Neon hiccup would otherwise turn
 * into 3 seconds of forced 503s.
 */
interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export interface IsolateTtlCache<V> {
  /** Resolve `key` from cache, otherwise call `fetcher` (single-flight). */
  getOrFetch(key: string, fetcher: () => Promise<V>): Promise<V>;
  /** Test-only: drop all entries between cases. */
  reset(): void;
}

export interface CreateIsolateTtlCacheOptions<V> {
  /**
   * TTL applied to cacheable results, in milliseconds. Pick a value short
   * enough that stale rows don't out-live the user's expectation of
   * "fresh" — 1-5s is the band solution #3 calls out.
   */
  ttlMs: number;
  /**
   * Optional predicate. Returning `false` skips the cache write for a
   * given resolved value — the entry is returned to the caller but not
   * stored. Defaults to "cache everything", which is wrong for any
   * fetcher that returns an error sentinel; pass an explicit predicate
   * for those.
   */
  shouldCache?: (value: V) => boolean;
}

/**
 * Process-wide registry of every cache instance ever created. Lets the
 * vitest setup file flush them all between cases without having to know
 * which downstream modules built caches.
 */
const registry = new Set<IsolateTtlCache<unknown>>();

export function createIsolateTtlCache<V>(
  options: CreateIsolateTtlCacheOptions<V>,
): IsolateTtlCache<V> {
  const { ttlMs, shouldCache = () => true } = options;
  const entries = new Map<string, CacheEntry<V>>();
  const inflight = new Map<string, Promise<V>>();

  const cache: IsolateTtlCache<V> = {
    async getOrFetch(key, fetcher) {
      const now = Date.now();
      const hit = entries.get(key);
      if (hit && hit.expiresAt > now) {
        return hit.value;
      }
      const racing = inflight.get(key);
      if (racing) return racing;

      const promise = (async () => {
        try {
          const value = await fetcher();
          if (shouldCache(value)) {
            entries.set(key, { value, expiresAt: Date.now() + ttlMs });
          }
          return value;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, promise);
      return promise;
    },
    reset() {
      entries.clear();
      inflight.clear();
    },
  };
  registry.add(cache as IsolateTtlCache<unknown>);
  return cache;
}

/**
 * Flush every cache built by {@link createIsolateTtlCache} so far. Used
 * exclusively by the vitest setup file — see
 * `apps/api/src/__tests__/setup.ts`. Pulling this through the registry
 * lets the setup avoid importing any module that itself imports
 * `indexer-reads.js`, which would defeat the per-file `vi.mock` of that
 * module in downstream tests.
 */
export function _resetAllIsolateTtlCaches(): void {
  for (const cache of registry) cache.reset();
}
