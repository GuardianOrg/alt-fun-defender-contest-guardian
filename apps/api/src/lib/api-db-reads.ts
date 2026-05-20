import { describeError } from "./log-error.js";

/**
 * Try-catch wrapper for direct reads against the API's own `public.*`
 * tables (`tokens`, `user_profiles`, …). Mirrors the convention
 * `indexer-reads.ts` already uses for the indexer-side reads: caught
 * errors land as `null` so route handlers can fan a single null check
 * into a documented 503, instead of letting the failure bubble through
 * to `app.onError` in `apps/api/src/index.ts` as a generic 500.
 *
 * Background: when Neon's HTTP proxy intermittently returns
 * `HTTP 403 / error code: 1006` (Cloudflare per-IP ban — see issue
 * #1111 for root cause), the indexer-side reads already return `null`
 * and route handlers emit 503. The same `NeonDbError` thrown from the
 * API-DB callsites used to land at `app.onError` as a 500. This wrapper
 * collapses both shapes onto the same 503 the frontend already knows
 * how to handle (`dataSource: "degraded"` banner, retry-after-N-seconds
 * path). Issue #1110.
 *
 * The frontend treats 503 as a transient outage and retries; a 500 is
 * surfaced to the user as an actionable error. We never want a Neon
 * HTTP hiccup to surface as the latter, so every direct `public.*` read
 * inside `routes/**` should go through this wrapper.
 *
 * The wrapper does NOT retry — that would amplify the rate-limit inside
 * the same isolate and is deferred until the WebSocket / Hyperdrive
 * transport work lands (issue #1112).
 */

/**
 * Strip Drizzle's `Failed query: <SQL>\nparams: <values>` decoration so
 * the `error.message` log field stays grep-able. The SQL itself is
 * already in the source (and the surrounding `event` name pinpoints the
 * call site), so we don't need to ship 1 KB+ of inlined SQL on every
 * log line — the underlying *cause* (Neon HTTP status / response body)
 * is the thing we actually need to triage and that's surfaced
 * separately under `cause` by `describeError`. Mirrors the equivalent
 * sanitiser in `indexer-reads.ts`. Issue #974.
 */
function stripQueryBloat(message: string): string {
  return message.split("\n", 1)[0];
}

/**
 * Structured-logging shim for the catch block. Every failure inside
 * `tryApiDbRead` follows the legacy `return null on error` contract so
 * the route handlers' 503 branches trip — but the failure must not be
 * silent, or production 503s become unactionable. Logs the event name +
 * sanitized context as JSON so Cloudflare's tail / Logpush can pivot on
 * it. Walks the `cause` chain via `describeError` so the underlying
 * Neon HTTP status (1006 / 5xx / timeout) surfaces at the top level of
 * the log payload. Mirrors `logIndexerReadFailure` in `indexer-reads.ts`.
 */
function logApiDbReadFailure(
  event: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({
      level: "error",
      event,
      ...context,
      error: describeError(error, stripQueryBloat),
      timestamp: new Date().toISOString(),
    }),
  );
}

/**
 * Wraps a `public.*` read so a Neon HTTP failure (1006, 5xx, timeout)
 * lands as a clean `null` and the caller route emits a documented 503
 * instead of bubbling to `app.onError` as a 500.
 *
 * The callback is invoked synchronously and its result awaited inside
 * the wrapper's try block, so even synchronous throws during SQL
 * construction (e.g. a checksum / `getAddress` failure inside the
 * predicate) are caught and logged. Callers should treat a `null`
 * return as "DB unreachable / read failed" — distinct from an empty
 * result, which is `[]` (or `undefined` for `[firstRow] = ...`
 * destructuring of an empty array).
 *
 * Usage:
 *
 *     const rows = await tryApiDbRead(
 *       "api_db.tokens_detail_lookup",
 *       () => db.select().from(tokens).where(...).limit(1),
 *       { address },
 *     );
 *     if (rows === null) {
 *       return c.json(formatError("Token metadata unavailable"), 503);
 *     }
 *     const [dbToken] = rows;
 *
 * The 503 response MUST NOT carry a positive `s-maxage` (leave
 * `Cache-Control` unset, or set `no-store`) — pinning a transient
 * outage at the edge for the TTL window would turn a 30-second Neon
 * hiccup into a multi-minute outage for any POP that cached it.
 *
 * The `event` argument is a free-form dotted string surfaced on the
 * structured log line; pick a name that uniquely identifies the call
 * site (`api_db.<table>_<purpose>` by convention — see
 * `indexer-reads.ts` for the pattern).
 */
export async function tryApiDbRead<T>(
  event: string,
  fn: () => Promise<T> | PromiseLike<T>,
  context: Record<string, unknown> = {},
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    logApiDbReadFailure(event, error, context);
    return null;
  }
}
