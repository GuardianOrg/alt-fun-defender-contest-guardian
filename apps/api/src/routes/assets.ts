import { Hono } from "hono";
import {
  BOUNCE_INDEXING_API,
  HYPERLIQUID_INFO_API,
  SUPPORTED_UNDERLYING_ASSETS,
  filterSupportedLTs,
} from "@launchpad/shared";

import { getLiveLtAvailability } from "../lib/lt-availability.js";
import { readLtDirectory } from "../lib/lt-directory-reads.js";
import formatSuccess from "../utils/format-success.js";

import type { AppBindings } from "../lib/types.js";
import type { LiveLeveragedToken } from "@launchpad/shared";

let cachedMids: { data: Record<string, string>; ts: number } | null = null;
let cachedLTs: { data: LiveLeveragedToken[]; ts: number } | null = null;

const CACHE_TTL_MS = 10_000;

/**
 * Test-only hook: drop the per-isolate `mids` + `LTs` caches between
 * vitest cases. The mocked `fetch` queues per-test responses, but the
 * caches above would otherwise survive across cases and silently serve
 * stale data into the next test.
 */
export function _resetAssetsRouteCache(): void {
  cachedMids = null;
  cachedLTs = null;
}

async function fetchMids(): Promise<Record<string, string>> {
  if (cachedMids && Date.now() - cachedMids.ts < CACHE_TTL_MS) {
    return cachedMids.data;
  }
  try {
    const res = await fetch(HYPERLIQUID_INFO_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
    });
    const data = (await res.json()) as Record<string, string>;
    cachedMids = { data, ts: Date.now() };
    return data;
  } catch {
    return cachedMids?.data ?? {};
  }
}

async function fetchLTs(): Promise<LiveLeveragedToken[]> {
  if (cachedLTs && Date.now() - cachedLTs.ts < CACHE_TTL_MS) {
    return cachedLTs.data;
  }
  try {
    const res = await fetch(`${BOUNCE_INDEXING_API}/leveraged-tokens`);
    const json = (await res.json()) as { data?: LiveLeveragedToken[] };
    const lts = filterSupportedLTs(json.data ?? []);
    cachedLTs = { data: lts, ts: Date.now() };
    return lts;
  } catch {
    return cachedLTs?.data ?? [];
  }
}

const assets = new Hono<{ Bindings: AppBindings }>();

assets.get("/", async (c) => {
  // Run the BounceTech / Hyperliquid fans-out in parallel with the live-LT
  // availability lookup. `getLiveLtAvailability` warms the per-isolate cache
  // on first access; subsequent requests within `CACHE_TTL_MS` are O(1).
  const [mids, lts, availability] = await Promise.all([
    fetchMids(),
    fetchLTs(),
    // Don't let a stuck BounceTech CDN take down `/assets` — fall back to
    // the cached snapshot (or "unknown, don't filter") on failure. See
    // `lt-availability.ts` for the fail-open rationale.
    getLiveLtAvailability().catch(() => null),
  ]);

  // When availability is `null` (initial cold start raced with a failing
  // BounceTech) we surface every supported LT, the same shape we had
  // pre-#621 — degrading to "show everything" is the right call when the
  // filter signal is unavailable. Otherwise we filter to only LTs whose
  // logo BounceTech has actually published.
  const liveAddresses = availability?.liveAddresses ?? null;
  const liveUnderlyings = availability?.liveUnderlyings ?? null;

  const leveragedTokens = lts
    .filter((lt) =>
      liveAddresses === null
        ? true
        : liveAddresses.has(lt.address.toLowerCase()),
    )
    .map((lt) => ({
      address: lt.address,
      symbol: lt.symbol,
      name: lt.name,
      targetAsset: lt.targetAsset,
      targetLeverage: lt.targetLeverage,
      isLong: lt.isLong,
      exchangeRate: lt.exchangeRate,
      mintPaused: lt.mintPaused,
    }));

  const underlying = SUPPORTED_UNDERLYING_ASSETS
    .filter((symbol) =>
      liveUnderlyings === null ? true : liveUnderlyings.has(symbol),
    )
    .map((symbol) => ({
      symbol,
      price: mids[symbol] ?? null,
    }));

  return c.json(
    formatSuccess({
      underlying,
      leveragedTokens,
      /**
       * The set of underlying-asset names with ≥1 live LT, surfaced for
       * lightweight clients (markets sidebar, asset tape, pair selector)
       * that only need the filter set and don't want the per-LT payload.
       * Mirrors `liveUnderlyings` on the availability snapshot. When the
       * signal is unavailable (BounceTech CDN down during cold start)
       * this falls back to the full supported list so the UI degrades to
       * "show everything" rather than blanking out.
       */
      liveUnderlyings:
        liveUnderlyings === null
          ? [...SUPPORTED_UNDERLYING_ASSETS]
          : SUPPORTED_UNDERLYING_ASSETS.filter((s) => liveUnderlyings.has(s)),
    }),
  );
});

/**
 * Full BounceTech LT directory, sourced from the `lt_directory`
 * Postgres mirror kept fresh by `LtDirectoryPoller`. Returns every row
 * the poller has ever seen — no `filterSupportedLTs`, no live-on-UI
 * filter. Mirrors the shape of the legacy
 * `GET ${BOUNCE_INDEXING_API}/leveraged-tokens` upstream payload
 * (`{ data: [...] }` envelope wrapped in `formatSuccess`) so a future
 * client cutover is a pure source swap.
 *
 * Provided additively for end-to-end verification ahead of switching
 * existing consumers (frontend `useLeveragedTokens`, API `fetchLiveLtRates`,
 * etc.) off the upstream HTTP fan-out. See the follow-up GitHub issue
 * tracking the parity check.
 *
 * Edge-cacheable: the underlying directory rarely changes and the
 * mirror is itself a cache, so a 15s `s-maxage` plus `stale-while-
 * revalidate` is safe and absorbs concurrent users at the CF edge.
 */
assets.get("/leveraged-tokens", async (c) => {
  const directory = await readLtDirectory(c.env.DATABASE_URL);
  if (directory === null) {
    // DB unavailable. Surface an empty list rather than failing the
    // request: the verification flow that wraps this endpoint needs
    // to distinguish "mirror is degraded" from "mirror is wired up but
    // empty", which it does by reading the response envelope's status
    // field (`degraded` vs `success`).
    return c.json(formatSuccess({ data: [] }, "degraded"));
  }
  const response = c.json(formatSuccess({ data: directory }));
  response.headers.set(
    "Cache-Control",
    "public, s-maxage=15, stale-while-revalidate=60",
  );
  return response;
});

export default assets;
