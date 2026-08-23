/**
 * Per-isolate TTL caches in front of the hot single-token reads (issue
 * #1125, solution #3). The set of cached fetchers is exactly the four
 * endpoints the issue identifies as fanning out to the same Postgres
 * rows for a hot token: `/tokens/:addr`, `/trades/:addr`,
 * `/holders/:addr`, `/chart/:addr`. A short TTL collapses bursts inside
 * the isolate without depending on the edge cache rule landing first —
 * when a viral token's page is opened by 100 users in a single PoP, the
 * four reads run *once* per `HOT_TOKEN_READ_TTL_MS` per (fetcher, args)
 * combo, not 400 times.
 *
 * TTL of 3s is the middle of the 1-5s band solution #3 calls out:
 *   - Below the user-perceptible drift window for live token data (the
 *     `/ws` `trade` channel pushes the actually-real-time updates).
 *   - Comfortably above the typical handler wall-time, so coalescing
 *     wins compound across the burst.
 *
 * Error sentinels (`null` from caught errors, `"unavailable"` from
 * `fetchTokenOnchain`) are NOT pinned in the cache — see `shouldCache`
 * on each cache. A one-off Neon hiccup must recover on the next
 * request, not be amplified into 3s of forced 503s.
 *
 * Lives in a sibling module to `indexer-reads.ts` rather than alongside
 * the raw fetchers so existing test files that `vi.mock` the entire
 * `indexer-reads.js` module keep working — the cached variants are
 * picked up from this file (which is not mocked), and they in turn call
 * the mocked underlying fetcher.
 */
import {
  fetchHolders,
  fetchRouterTrades,
  fetchTokenChartSnapshots,
  fetchTokenOnchain,
  type ChartTokenSnapshotRow,
  type HolderRow,
  type IndexerRouterTradeRow,
  type PonderTokenOnchain,
} from "./indexer-reads.js";

import { createIsolateTtlCache } from "../utils/isolate-ttl-cache.js";
import {
  fallbackOnInflightTimeout,
  type WaitUntilHost,
} from "../utils/inflight.js";

import type { Database } from "../db/client.js";

const HOT_TOKEN_READ_TTL_MS = 3_000;

const fetchTokenOnchainCache = createIsolateTtlCache<
  PonderTokenOnchain | null | "unavailable"
>({
  ttlMs: HOT_TOKEN_READ_TTL_MS,
  shouldCache: (value) => value !== "unavailable",
});

const fetchRouterTradesCache = createIsolateTtlCache<
  IndexerRouterTradeRow[] | null
>({
  ttlMs: HOT_TOKEN_READ_TTL_MS,
  shouldCache: (value) => value !== null,
});

const fetchHoldersCache = createIsolateTtlCache<{
  holders: HolderRow[];
  totalHolders: number;
} | null>({
  ttlMs: HOT_TOKEN_READ_TTL_MS,
  shouldCache: (value) => value !== null,
});

const fetchTokenChartSnapshotsCache = createIsolateTtlCache<
  ChartTokenSnapshotRow[] | null
>({
  ttlMs: HOT_TOKEN_READ_TTL_MS,
  shouldCache: (value) => value !== null,
});

/**
 * Test-only hook: drop every per-isolate read cache between vitest cases
 * so a prior test's cached row doesn't leak into the next case's mock
 * setup. Mirrors `_resetLiveLtRatesCache` in `market-data.ts`.
 */
export function _resetIndexerReadCaches(): void {
  fetchTokenOnchainCache.reset();
  fetchRouterTradesCache.reset();
  fetchHoldersCache.reset();
  fetchTokenChartSnapshotsCache.reset();
}

/**
 * Cached variant of {@link fetchTokenOnchain}. Memoises the single-token
 * read for {@link HOT_TOKEN_READ_TTL_MS} per address. `"unavailable"`
 * (transient transport failure) is returned to the caller but not
 * stored.
 */
export function fetchTokenOnchainCached(
  db: Database,
  address: string,
  executionCtx?: WaitUntilHost,
): Promise<PonderTokenOnchain | null | "unavailable"> {
  const key = address.toLowerCase();
  return fallbackOnInflightTimeout(
    fetchTokenOnchainCache.getOrFetch(
      key,
      () => fetchTokenOnchain(db, address),
      executionCtx,
    ),
    "unavailable",
  );
}

/**
 * Cached variant of {@link fetchRouterTrades} scoped to a single token.
 * Untokened (global feed) calls bypass the cache because the global feed
 * mutates on every block and the cache key would need to invalidate on
 * every Zap trade across the entire catalogue — not the burst pattern
 * solution #3 targets.
 *
 * `null` (caught error) is returned but not cached so a transient Neon
 * failure recovers on the next request.
 */
export function fetchRouterTradesCached(
  db: Database,
  opts: {
    tokenAddress: string;
    limit: number;
    offset: number;
    direction?: "asc" | "desc";
  },
  executionCtx?: WaitUntilHost,
): Promise<IndexerRouterTradeRow[] | null> {
  const direction = opts.direction ?? "desc";
  const key = `${opts.tokenAddress.toLowerCase()}|${opts.limit}|${opts.offset}|${direction}`;
  return fallbackOnInflightTimeout(
    fetchRouterTradesCache.getOrFetch(
      key,
      () => fetchRouterTrades(db, opts),
      executionCtx,
    ),
    null,
  );
}

/**
 * Cached variant of {@link fetchHolders}. The cache key includes the
 * exclusion list (sorted, lowercased) so a caller passing a different
 * set of protocol wallets doesn't accidentally read another caller's
 * exclusion. `null` (caught error) is not pinned.
 */
export function fetchHoldersCached(
  db: Database,
  opts: {
    tokenAddress: string;
    limit: number;
    excludedWallets: string[];
  },
  executionCtx?: WaitUntilHost,
): Promise<{ holders: HolderRow[]; totalHolders: number } | null> {
  const excluded = opts.excludedWallets
    .map((w) => w.toLowerCase())
    .sort()
    .join(",");
  const key = `${opts.tokenAddress.toLowerCase()}|${opts.limit}|${excluded}`;
  return fallbackOnInflightTimeout(
    fetchHoldersCache.getOrFetch(
      key,
      () => fetchHolders(db, opts),
      executionCtx,
    ),
    null,
  );
}

/**
 * Cached variant of {@link fetchTokenChartSnapshots}. The `fromSec`
 * cutoff is part of the key — chart routes thread their own quantised
 * window through, so the same `(address, fromSec)` pair from concurrent
 * callers coalesces while a request with a different window still pays
 * the cold path. `null` (caught error) is not pinned.
 */
export function fetchTokenChartSnapshotsCached(
  db: Database,
  tokenAddress: string,
  fromSec: number,
  executionCtx?: WaitUntilHost,
): Promise<ChartTokenSnapshotRow[] | null> {
  const key = `${tokenAddress.toLowerCase()}|${fromSec}`;
  return fallbackOnInflightTimeout(
    fetchTokenChartSnapshotsCache.getOrFetch(
      key,
      () => fetchTokenChartSnapshots(db, tokenAddress, fromSec),
      executionCtx,
    ),
    null,
  );
}
