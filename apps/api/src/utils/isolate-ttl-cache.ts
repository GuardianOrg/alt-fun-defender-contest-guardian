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
  /**
   * Current entries-Map size, including not-yet-evicted-but-expired
   * rows. Exposed for tests that need to verify the periodic-sweep and
   * FIFO-eviction paths actually fired (a value alone can't distinguish
   * "sweep ran" from "lazy-delete ran on read"). Cheap to read — backed
   * by the underlying Map's native `size` getter.
   */
  readonly size: number;
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
  /**
   * Hard ceiling on the entries Map. When a write would push past this,
   * the oldest-inserted entry is evicted (FIFO) to make room. Independent
   * of the TTL sweep — defends against pathological inputs (high-cardinality
   * abuse, or a future TTL bump that breaks the sweep cadence assumption).
   *
   * Insertion-order eviction (FIFO) rather than recency-tracked LRU is
   * deliberate: JS `Map` already iterates insertion order, and for a TTL
   * cache the oldest-inserted entry is also the closest-to-expiry one, so
   * FIFO ≈ "drop the entry that was about to expire anyway".
   *
   * Defaults to `1024`, picked so a 4-cache fleet (the production
   * `indexer-cached-reads.ts` setup) is bounded at ~2 MB of cached values
   * regardless of TTL behaviour — three orders of magnitude under the
   * Worker isolate's 128 MB ceiling.
   */
  maxEntries?: number;
}

/**
 * Process-wide registry of every cache instance ever created. Lets the
 * vitest setup file flush them all between cases without having to know
 * which downstream modules built caches.
 */
const registry = new Set<IsolateTtlCache<unknown>>();

/**
 * Number of writes between full sweeps of the entries Map for expired
 * rows. `getOrFetch` already lazy-deletes the specific key it touches
 * when it finds it expired, so the sweep is purely a backstop for keys
 * that were written once and never read again — the long tail under
 * a high-cardinality workload (every distinct token ever requested,
 * never re-touched after its TTL).
 *
 * 64 keeps amortised cost low (one full scan per 64 inserts) while
 * bounding the Map at ~`64 × concurrent-distinct-keys` worst case,
 * which is comfortably under the Worker's 128MB isolate ceiling for
 * any realistic catalogue size.
 */
const SWEEP_EVERY_WRITES = 64;

export function createIsolateTtlCache<V>(
  options: CreateIsolateTtlCacheOptions<V>,
): IsolateTtlCache<V> {
  const { ttlMs, shouldCache = () => true, maxEntries = 1024 } = options;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error(`createIsolateTtlCache: maxEntries must be a positive integer (got ${maxEntries})`);
  }
  const entries = new Map<string, CacheEntry<V>>();
  const inflight = new Map<string, Promise<V>>();
  let writesSinceSweep = 0;

  const sweepExpired = (now: number): void => {
    for (const [k, v] of entries) {
      if (v.expiresAt <= now) entries.delete(k);
    }
  };

  const cache: IsolateTtlCache<V> = {
    get size() {
      return entries.size;
    },
    async getOrFetch(key, fetcher) {
      const now = Date.now();
      const hit = entries.get(key);
      if (hit) {
        if (hit.expiresAt > now) return hit.value;
        // Lazy delete — a stale read of a known key gets cleaned up
        // here instead of waiting for the next periodic sweep.
        entries.delete(key);
      }
      const racing = inflight.get(key);
      if (racing) return racing;

      const promise = (async () => {
        try {
          const value = await fetcher();
          if (shouldCache(value)) {
            // FIFO cap: when the Map is at capacity, drop the
            // oldest-inserted key before the new write. `Map.keys()`
            // iterates in insertion order, so the first key is the
            // oldest. Only fires when adding a new key — overwriting
            // an existing key keeps `size` stable.
            if (!entries.has(key) && entries.size >= maxEntries) {
              const oldest = entries.keys().next().value;
              if (oldest !== undefined) entries.delete(oldest);
            }
            entries.set(key, { value, expiresAt: Date.now() + ttlMs });
            if (++writesSinceSweep >= SWEEP_EVERY_WRITES) {
              writesSinceSweep = 0;
              sweepExpired(Date.now());
            }
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
      writesSinceSweep = 0;
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
