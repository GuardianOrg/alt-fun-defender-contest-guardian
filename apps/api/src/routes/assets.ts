import { Hono } from "hono";
import {
  getHyperliquidDex,
  HYPERLIQUID_INFO_API,
  HYPERLIQUID_XYZ_DEX,
  SUPPORTED_UNDERLYING_ASSETS,
} from "@launchpad/shared";

import {
  readLtDirectory,
  readSupportedLtDirectory,
} from "../lib/lt-directory-reads.js";
import formatSuccess from "../utils/format-success.js";

import type { AppBindings } from "../lib/types.js";
import type { LiveLeveragedToken } from "@launchpad/shared";

let cachedMids: { data: Record<string, string>; ts: number } | null = null;
let cachedSupportedDirectory:
  | {
      lts: LiveLeveragedToken[];
      underlyings: string[];
      ts: number;
    }
  | null = null;

const CACHE_TTL_MS = 10_000;
const DIRECTORY_CACHE_TTL_MS = 15_000;
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
  cachedSupportedDirectory = null;
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

async function fetchMids(
  trackedAssets: readonly string[] = SUPPORTED_UNDERLYING_ASSETS,
): Promise<Record<string, string>> {
  if (cachedMids && Date.now() - cachedMids.ts < CACHE_TTL_MS) {
    return cachedMids.data;
  }
  try {
    const requests: Promise<Record<string, string>>[] = [
      fetchWithTimeout(
        HYPERLIQUID_INFO_API,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "allMids" }),
        },
        EXTERNAL_FETCH_TIMEOUT_MS,
      ).then((res) => res.json() as Promise<Record<string, string>>),
    ];
    if (trackedAssets.some((asset) => getHyperliquidDex(asset))) {
      requests.push(
        fetchWithTimeout(
          HYPERLIQUID_INFO_API,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "allMids",
              dex: HYPERLIQUID_XYZ_DEX,
            }),
          },
          EXTERNAL_FETCH_TIMEOUT_MS,
        )
          .then((res) => res.json() as Promise<Record<string, string>>)
          .catch(() => ({}) as Record<string, string>),
      );
    }
    const data = Object.assign({}, ...(await Promise.all(requests))) as Record<
      string,
      string
    >;
    cachedMids = { data, ts: Date.now() };
    return data;
  } catch {
    return cachedMids?.data ?? {};
  }
}

function detectedSupportedUnderlyings(
  lts: readonly { targetAsset: string }[],
): string[] {
  const detected = new Set(lts.map((lt) => lt.targetAsset));
  return SUPPORTED_UNDERLYING_ASSETS.filter((symbol) => detected.has(symbol));
}

async function readCachedSupportedDirectory(databaseUrl: string): Promise<{
  lts: LiveLeveragedToken[];
  underlyings: string[];
  degraded: boolean;
}> {
  if (
    cachedSupportedDirectory &&
    Date.now() - cachedSupportedDirectory.ts < DIRECTORY_CACHE_TTL_MS
  ) {
    return {
      lts: cachedSupportedDirectory.lts,
      underlyings: cachedSupportedDirectory.underlyings,
      degraded: false,
    };
  }

  const lts = await withDbTimeout(
    readSupportedLtDirectory(databaseUrl),
    null,
    DB_READ_TIMEOUT_MS,
    "readSupportedLtDirectory",
  );
  if (lts === null) {
    return {
      lts: cachedSupportedDirectory?.lts ?? [],
      underlyings: cachedSupportedDirectory?.underlyings ?? [],
      degraded: true,
    };
  }

  const underlyings = detectedSupportedUnderlyings(lts);
  cachedSupportedDirectory = { lts, underlyings, ts: Date.now() };
  return { lts, underlyings, degraded: false };
}

/**
 * DB-read budget for `/assets`. A cold Neon compute can keep the HTTPS
 * connection open for tens of seconds before either succeeding or
 * surfacing an error; without an explicit cap the route ends up
 * waiting the full per-request budget on the caller side (e.g. the 10 s
 * wall in `scripts/smoke-test.mjs`). 4 s is more than enough for a
 * warm read and short enough that a cold-DB user gets the "show
 * everything" fallback within their normal poll cadence. Matches the
 * `EXTERNAL_FETCH_TIMEOUT_MS` pattern above for budget symmetry.
 */
const DB_READ_TIMEOUT_MS = 4_000;

/**
 * Race a promise against a wall-clock timeout. On timeout the wrapped
 * call's settlement is ignored (Neon's HTTPS driver doesn't honour an
 * AbortSignal at the per-query level) — so the SQL eventually completes
 * server-side but the caller's bounded promise resolves with
 * `fallback`. Used to bound DB reads inside route handlers when the
 * underlying lib doesn't expose its own timeout knob.
 *
 * Critically, only the *timer* path resolves with `fallback`: a
 * genuine rejection from the wrapped promise propagates to the caller
 * so `app.onError` still gets a chance to log + surface a real
 * failure. CodeRabbit feedback on the original implementation: a
 * blanket `.catch(() => resolve(fallback))` would have silently
 * swallowed e.g. an auth error from `readSupportedLtDirectory` and
 * served a degraded empty market list on top of a permanent
 * misconfiguration. The `settled` latch covers the race where the
 * wrapped promise eventually rejects *after* the timer has already
 * fired — the rejection is still observed (no unhandled rejection in
 * Workers) but treated as a no-op.
 */
function withDbTimeout<T>(
  promise: Promise<T>,
  fallback: T,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Structured log on the timeout-fallback path so ops can spot
      // chronic degraded reads in Cloudflare logs / `wrangler tail`
      // without scraping for missing data. Matches the
      // `console.log(JSON.stringify(...))` convention used elsewhere
      // in `apps/api/src` (e.g. `lib/lt-directory-reads.ts`).
      console.log(
        JSON.stringify({
          level: "warn",
          event: "db_read_timeout_fallback",
          helper: label,
          timeoutMs,
          timestamp: new Date().toISOString(),
        }),
      );
      resolve(fallback);
    }, timeoutMs);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const assets = new Hono<{ Bindings: AppBindings }>();

assets.get("/", async (c) => {
  const directory = await readCachedSupportedDirectory(c.env.DATABASE_URL);
  const mids = await fetchMids(directory.underlyings);

  const leveragedTokens = directory.lts.map((lt) => ({
    address: lt.address,
    symbol: lt.symbol,
    name: lt.name,
    targetAsset: lt.targetAsset,
    targetLeverage: lt.targetLeverage,
    isLong: lt.isLong,
    exchangeRate: lt.exchangeRate,
    mintPaused: lt.mintPaused,
  }));

  const underlying = directory.underlyings.map((symbol) => ({
    symbol,
    price: mids[symbol] ?? null,
  }));

  return c.json(
    formatSuccess(
      { underlying, leveragedTokens },
      directory.degraded ? "degraded" : undefined,
    ),
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
