import { Hono } from "hono";
import {
  HYPERLIQUID_INFO_API,
  SUPPORTED_UNDERLYING_ASSETS,
} from "@launchpad/shared";

import { getLiveLtAvailability } from "../lib/lt-availability.js";
import {
  readLtDirectory,
  readSupportedLtDirectory,
} from "../lib/lt-directory-reads.js";
import formatSuccess from "../utils/format-success.js";

import type { AppBindings } from "../lib/types.js";

let cachedMids: { data: Record<string, string>; ts: number } | null = null;

const CACHE_TTL_MS = 10_000;
// Bound the Hyperliquid `/info` fan-out so a stalled CDN can't pin the
// request indefinitely. The endpoint is p99 ≪ 1 s under normal load;
// the 5 s cap absorbs transient latency spikes while still failing
// fast enough to fall through to the per-isolate cache within a
// single client-side poll cycle. Mirrors the budget pattern used by
// `fetchWithTimeout` in the API smoke-test harness — without it a
// hung external CDN silently consumes the Worker's 30 s subrequest
// budget, which is what surfaced as a 10 s smoke-test timeout on
// `/api/v1/assets` during a CI run.
const EXTERNAL_FETCH_TIMEOUT_MS = 5_000;

/**
 * Test-only hook: drop the per-isolate `mids` cache between vitest cases.
 * The mocked `fetch` queues per-test responses, but the cache above would
 * otherwise survive across cases and silently serve stale data into the
 * next test.
 */
export function _resetAssetsRouteCache(): void {
  cachedMids = null;
}

/**
 * Wrap a `fetch` in an `AbortController` so a stuck remote can't hang
 * the route past `timeoutMs`. Returns the response on success; throws
 * (and lets the caller fall through to its catch + cache fallback) on
 * timeout or network failure. Extracted instead of inlining so both
 * fan-outs share the exact same abort semantics — divergence between
 * them would otherwise let one external dep dominate the other's
 * latency budget.
 */
async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMids(): Promise<Record<string, string>> {
  if (cachedMids && Date.now() - cachedMids.ts < CACHE_TTL_MS) {
    return cachedMids.data;
  }
  try {
    const res = await fetchWithTimeout(
      HYPERLIQUID_INFO_API,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "allMids" }),
      },
      EXTERNAL_FETCH_TIMEOUT_MS,
    );
    const data = (await res.json()) as Record<string, string>;
    cachedMids = { data, ts: Date.now() };
    return data;
  } catch {
    return cachedMids?.data ?? {};
  }
}

const assets = new Hono<{ Bindings: AppBindings }>();

assets.get("/", async (c) => {
  // Run the Hyperliquid mids fan-out in parallel with the LT directory
  // mirror read and the live-LT availability lookup.
  const [mids, lts, availability] = await Promise.all([
    fetchMids(),
    // `null` from the DB read means the `lt_directory` mirror is degraded
    // (poller hasn't backfilled yet or the DB read failed) — fall back to
    // an empty supported list. The availability snapshot below carries
    // the "show everything when degraded" semantics for the response.
    readSupportedLtDirectory(c.env.DATABASE_URL).then((d) => d ?? []),
    // Don't let a stuck availability lookup take down `/assets` — fall
    // back to the cached snapshot (or "unknown, don't filter") on
    // failure. See `lt-availability.ts` for the fail-open rationale.
    getLiveLtAvailability({ databaseUrl: c.env.DATABASE_URL }).catch(() => null),
  ]);

  // When availability is `null` (initial cold start raced with a failing
  // mirror read) we surface every supported LT — degrading to "show
  // everything" is the right call when the filter signal is unavailable.
  // Otherwise we filter to only LTs whose logo BounceTech has published.
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
