/**
 * Build the `Cache-Control` directive used by edge-cacheable list /
 * detail JSON responses on this API.
 *
 * Combines four signals so the response is cheap at the CDN tier
 * without ever feeling stale to a user who hits ⌘R / F5:
 *
 *   - `public`: any cache (Cloudflare edge or browser) may store the
 *     body. Required for the response to be admitted to Cloudflare's
 *     edge cache under the project's default rules.
 *
 *   - `max-age=0`: the BROWSER's private cache must revalidate on
 *     every request — no heuristic freshness, no held-over response
 *     after a normal reload. Without this, a response that carries
 *     only `s-maxage` has undefined freshness for the browser, which
 *     RFC 9111 §4.2.2 lets the browser heuristically cache (often
 *     for minutes / hours). That's the exact mechanism that produced
 *     the "only `Delete browsing data` shows new tokens" bug on the
 *     home-page `/tokens` list — `s-maxage` is shared-cache only and
 *     never reaches the browser tier.
 *
 *   - `s-maxage=${ttlSeconds}`: Cloudflare's edge cache (and the
 *     Worker's `caches.default` binding, which honours the same
 *     header) holds the response for `ttlSeconds` of fresh service —
 *     cheap burst absorption that keeps thundering-herd reloads off
 *     Postgres + Ponder + BounceTech without leaking staleness
 *     past the browser tier.
 *
 *   - `stale-while-revalidate=${ttlSeconds * 2}`: edge keeps serving
 *     the stale body for another `2 * ttl` seconds while it
 *     revalidates in the background, so the request that lands the
 *     instant the entry expires doesn't pay the full origin
 *     round-trip. Length matches the project convention used by
 *     `creators` / `holders` / `portfolio` / `stats` / `security`
 *     (see `apps/api/AGENTS.md`).
 *
 * Use on every list / detail / aggregate JSON response that's safe
 * to share across clients. Wallet- or session-aware responses MUST
 * NOT use this — they need `private, no-store, max-age=0, s-maxage=0`
 * so the edge can't re-serve one user's body to another (see
 * `apps/api/src/routes/tokens/detail.ts` for the wallet-aware
 * branch's directive).
 */
export function edgeCacheableJsonHeader(ttlSeconds: number): string {
  return `public, max-age=0, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 2}`;
}
