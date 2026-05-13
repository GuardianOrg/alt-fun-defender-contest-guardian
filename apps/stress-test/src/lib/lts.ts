import {
  BOUNCE_INDEXING_API,
  filterSupportedLTs,
  getBounceLtImageUrl,
  type LeveragedTokenInfo,
  type LiveLeveragedToken,
} from "@launchpad/shared";

import { errMessage, info, log, section, success } from "./logger.ts";

/**
 * Per-HEAD timeout for the BounceTech UI logo probe. Lifted from
 * `apps/api/src/lib/lt-availability.ts` — anything past 4s is a CDN
 * slowdown class we'd rather classify as live than block the whole
 * harness startup behind.
 */
const HEAD_REQUEST_TIMEOUT_MS = 4_000;

/**
 * Timeout for the upstream BounceTech indexing API directory fetch.
 * Generous compared to the HEAD probes — the directory call is one
 * shot at startup, so a 10s ceiling is a fail-fast threshold rather
 * than a tight latency budget.
 */
const DIRECTORY_FETCH_TIMEOUT_MS = 10_000;

/**
 * Concurrent HEADs at startup. The supported directory sits in the low
 * tens of LTs, so a 5-wide pool finishes the sweep in 4-5 batches —
 * matches the API's own cron-driven sweep budget.
 */
const HEAD_CONCURRENCY = 5;

/**
 * Fetch the live BounceTech LT directory and narrow to LTs that are:
 *
 *   1. In Alt Fun's supported asset / leverage universe (`filterSupportedLTs`
 *      already drops `EXCLUDED_UNDERLYING_ASSETS` like PAXG and any asset
 *      tuple we haven't whitelisted).
 *   2. Not currently mint-paused on BounceTech — the seed buy that every
 *      `createToken` iteration runs would revert otherwise, silently
 *      degrading the harness to "100% failures".
 *   3. **Published on BounceTech's public UI** (HEAD-checked logo per
 *      `getBounceLtImageUrl`). Same oracle the API uses for the markets
 *      sidebar / pair selector — see `apps/api/src/lib/lt-availability.ts`
 *      for the full rationale. We mirror its quirks: 404 means "not
 *      published", any other non-2xx is fail-open, and we have to read
 *      `Content-Type` to distinguish a real PNG from bounce.tech's SPA
 *      HTML fallback (which also returns 200).
 */
export async function loadTradableLTs(): Promise<LeveragedTokenInfo[]> {
  section("📋", "LT pool");
  info("Fetching BounceTech directory…");

  const res = await fetch(`${BOUNCE_INDEXING_API}/leveraged-tokens`, {
    signal: AbortSignal.timeout(DIRECTORY_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      `BounceTech indexing API error: ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as { data: LiveLeveragedToken[] };
  const supported = filterSupportedLTs(body.data).filter((lt) => !lt.mintPaused);

  info(`Probing bounce.tech UI for ${supported.length} supported LTs…`);
  const live = await filterLiveOnBounceUi(supported);
  const dropped = supported.length - live.length;
  success(
    `${live.length} live` + (dropped > 0 ? `, ${dropped} dropped (not on bounce.tech UI)` : ""),
  );

  if (live.length === 0) {
    throw new Error(
      "No tradable BounceTech LTs are live on the public UI — bounce.tech may be unreachable, " +
        "or every supported pair is unpublished. Re-run when the BounceTech CDN is reachable.",
    );
  }

  return live.map((lt) => ({
    address: lt.address,
    symbol: lt.symbol,
    name: lt.name,
    targetAsset: lt.targetAsset,
    targetLeverage: lt.targetLeverage,
    isLong: lt.isLong,
    decimals: lt.decimals,
  }));
}

export function pickRandomLT(
  lts: readonly LeveragedTokenInfo[],
): LeveragedTokenInfo {
  if (lts.length === 0) throw new Error("LT pool is empty");
  return lts[Math.floor(Math.random() * lts.length)]!;
}

/**
 * Bounded-parallel HEAD sweep over `getBounceLtImageUrl(symbol)`. Mirrors
 * `defaultSymbolChecker` in `apps/api/src/lib/lt-availability.ts` —
 * including the two failure modes that aren't obvious from the URL alone:
 *
 *   - bounce.tech is a Next.js SPA: ANY unknown path returns HTTP 200
 *     with the HTML shell body. Without checking `Content-Type`, every
 *     symbol probes as "live" and the filter is a no-op.
 *   - bounce.tech's Fastly CDN caches the SPA fallback per-POP for up
 *     to 4 hours. We force-revalidate with `Cache-Control: no-cache`
 *     so a freshly-published LT doesn't stay hidden behind a stale
 *     edge cache.
 *
 * Failure policy is **fail-open**: any non-404 non-200 (403, 429, 5xx,
 * timeout, network) classifies the LT as live. That matches the API's
 * own fail-open default — losing a few LTs to a CDN hiccup is a worse
 * harness experience than running against an unpublished LT (which
 * just bumps the per-iteration error count, not the whole run).
 */
async function filterLiveOnBounceUi(
  lts: readonly LiveLeveragedToken[],
): Promise<LiveLeveragedToken[]> {
  const live: LiveLeveragedToken[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < lts.length) {
      const idx = cursor++;
      const lt = lts[idx]!;
      let isLive: boolean;
      try {
        isLive = await isPublishedOnBounceUi(lt.symbol);
      } catch (err) {
        // Fail-open. See function docstring.
        log("warn", "bounce_ui_head_threw_fail_open", {
          symbol: lt.symbol,
          error: errMessage(err),
        });
        isLive = true;
      }
      if (isLive) {
        live.push(lt);
      } else {
        log("info", "lt_dropped_not_on_bounce_ui", {
          symbol: lt.symbol,
          targetAsset: lt.targetAsset,
        });
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(HEAD_CONCURRENCY, lts.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return live;
}

async function isPublishedOnBounceUi(symbol: string): Promise<boolean> {
  const url = getBounceLtImageUrl(symbol);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    if (!res.ok) {
      // 404 is the one definitive "not published" signal. Every other
      // non-2xx is a transient / CDN class — fail open.
      if (res.status === 404) return false;
      return true;
    }
    // `res.ok` alone is NOT enough — the SPA shell also returns 200.
    // Only a real PNG comes back with an `image/*` Content-Type.
    const contentType = res.headers.get("content-type") ?? "";
    return contentType.toLowerCase().startsWith("image/");
  } finally {
    clearTimeout(timer);
  }
}
