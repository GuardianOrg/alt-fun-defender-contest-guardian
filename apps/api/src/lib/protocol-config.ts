import { DEFAULT_GRADUATION_THRESHOLD_USD } from "@launchpad/shared";

import { createPonderQuery } from "./ponder-client.js";

/**
 * Owner-controlled `Bonding` parameters mirrored into the indexer. Currently
 * just the graduation threshold; structured to grow with additional tunables.
 *
 * The indexer maintains a singleton `protocolConfig` row keyed `"global"`,
 * upserted on every `Bonding:GraduationThresholdUpdated` event and
 * defensively bootstrapped on the first `Bonding:TokenLaunched`. We mirror it
 * into a per-Worker-isolate cache (default 60s TTL) to keep the curve-filled
 * progress bar off the indexer's hot path — threshold changes are extremely
 * rare so a minute of staleness is invisible to users.
 *
 * If the indexer is unreachable or the row is missing, callers see the
 * compile-time default (`DEFAULT_GRADUATION_THRESHOLD_USD`). This keeps the
 * curve-filled bar populated during indexer outages instead of degrading to
 * "unknown" — the value is correct for any token launched against the
 * unmodified default-deploy contract.
 */

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: number;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

/**
 * Returns the live graduation threshold in plain USD (e.g. `12000`). Falls
 * back to the compile-time default on indexer error / missing row.
 *
 * Cached per Worker isolate for `CACHE_TTL_MS`. The cache is intentionally
 * not invalidated on `setGraduationThresholdUsd` — we accept up to one TTL
 * of staleness in exchange for zero per-request indexer fan-out.
 */
export async function getGraduationThresholdUsd(
  ponderUrl: string | undefined,
): Promise<number> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  const fetched = await fetchFromIndexer(ponderUrl);
  const value = fetched ?? DEFAULT_GRADUATION_THRESHOLD_USD;
  cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/** Test-only hook to drop the per-isolate cache between cases. */
export function _resetGraduationThresholdCache(): void {
  cache = null;
}

async function fetchFromIndexer(
  ponderUrl: string | undefined,
): Promise<number | null> {
  const queryPonder = createPonderQuery(ponderUrl);
  const data = await queryPonder<{
    protocolConfig: { graduationThresholdUsd: string } | null;
  }>(
    `query {
      protocolConfig(id: "global") {
        graduationThresholdUsd
      }
    }`,
  );

  const raw = data?.protocolConfig?.graduationThresholdUsd;
  if (!raw) return null;

  // 18-dp wei → plain USD. Threshold ranges (e.g. $4K–$1M) fit comfortably
  // in `Number` so the cast is safe; the wei representation is just how the
  // contract stores it.
  return Number(BigInt(raw) / 10n ** 18n);
}
