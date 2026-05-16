/**
 * Shared error-shaping helpers for the API's structured `console.log`
 * failure shims (`logIndexerReadFailure`, `logPonderFailure`, …). The
 * goal of every helper here is the same: take an arbitrary thrown value
 * — including the deeply-nested wrappers Drizzle's `neon-http` driver
 * produces and the GraphQL fetch failures the Ponder client swallows —
 * and turn it into a JSON-safe payload that Cloudflare log search can
 * pivot on, without dropping the log line on circular structures and
 * without leaking credential-shaped fields on a future driver upgrade.
 *
 * Both `apps/api/src/lib/indexer-reads.ts` and
 * `apps/api/src/lib/ponder-client.ts` use these helpers so the two
 * swallow paths produce structurally-identical error payloads. Issue
 * #974, CodeRabbit feedback on PR #983.
 */

/**
 * Maximum number of stack-trace lines to retain on the unwrapped
 * `cause`. Five is enough to identify the originating frame inside the
 * Neon HTTP driver / fetch shim without bloating each log line by
 * ~2 KB of noise.
 */
const CAUSE_STACK_LINES = 5;

/**
 * Defence-in-depth redaction list for error-sidecar logging. The Neon
 * HTTP / Ponder fetch paths do NOT attach credentials to errors today
 * (the wrappers carry SQL + params or HTTP body, no `Authorization`
 * header / connection string), but a future driver upgrade or a
 * hand-thrown error could. Redacting any key whose name looks
 * credential-shaped before the value lands in Cloudflare logs is cheap
 * insurance.
 */
const SENSITIVE_ERROR_KEY_PATTERN =
  /authorization|cookie|token|secret|password|passwd|api[-_]?key|database[-_]?url|connection[-_]?string|dsn/i;

/**
 * Walk a JSON-safe value and replace any field whose key looks
 * credential-shaped with `"[REDACTED]"`. Operates on the post-`JSON
 * .parse(JSON.stringify(...))` clone produced by `sanitizeErrorSidecar`,
 * so we never see functions, prototypes, or circular refs by the time
 * the recursion reaches here.
 */
function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([key, fieldValue]) => [
          key,
          SENSITIVE_ERROR_KEY_PATTERN.test(key)
            ? "[REDACTED]"
            : redactSensitive(fieldValue),
        ],
      ),
    );
  }
  return value;
}

/**
 * `JSON.stringify` replacer that coerces `bigint` values to strings.
 * `JSON.stringify(10n)` throws a `TypeError`; an `Error` carrying a
 * bigint inside its `cause` / `code` would otherwise drop the entire
 * outer log line. (`symbol` and `function` are silently elided by
 * `JSON.stringify` already, so they don't need explicit handling
 * inside nested structures.)
 */
function jsonSafeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}

/**
 * Best-effort shallow clone for arbitrary error sidecars (`cause` /
 * `sourceError` / unstructured `code`). Drivers attach plain-object
 * response payloads (status, body, headers) on these fields; `JSON
 * .parse(JSON.stringify(...))` strips functions, prototype chains, and
 * circular refs, but it can also throw on circular structures — which
 * would silently swallow the entire log line in production. Falling
 * back to `String(...)` keeps the log line valid even in that
 * pathological case. The clone is then walked through
 * `redactSensitive` so a future driver upgrade can't leak a credential
 * even if it stuffs one onto the error object.
 *
 * Top-level non-serializable primitives (`bigint`, `symbol`,
 * `function`) are explicitly coerced to strings — `JSON.stringify`
 * throws on a top-level bigint and returns `undefined` for top-level
 * symbols/functions, both of which would corrupt the caller's outer
 * log payload. Nested bigints survive via `jsonSafeReplacer`. CodeRabbit
 * feedback on PR #983.
 */
export function sanitizeErrorSidecar(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (
    typeof value === "bigint" ||
    typeof value === "symbol" ||
    typeof value === "function"
  ) {
    return String(value);
  }
  if (typeof value !== "object") return value;
  try {
    return redactSensitive(
      JSON.parse(JSON.stringify(value, jsonSafeReplacer)),
    );
  } catch {
    return String(value);
  }
}

/**
 * Defensive serializer for `error.code`. Drivers ship
 * `string | number` codes today, but the field is untyped on `Error`
 * proper — a future thrown value could carry an object or a circular
 * structure here, and an unguarded `JSON.stringify` of the outer log
 * payload would throw and lose the *entire* failure log. Pass
 * strings/numbers through and route everything else through the safe
 * sidecar serializer.
 */
function safeErrorCode(code: unknown): unknown {
  if (code === undefined) return undefined;
  if (typeof code === "string" || typeof code === "number") return code;
  return sanitizeErrorSidecar(code);
}

/**
 * Optional message transform — used by callers whose driver wraps the
 * underlying error in noise we'd rather strip from the log line (e.g.
 * Drizzle's `Failed query: <SQL>\nparams: <values>` decoration). Pure
 * function so the rest of `describeError` stays driver-agnostic.
 */
export type MessageTransform = (message: string) => string;

/**
 * Build the structured `error` payload for a JSON log line. Pulls
 * `error.cause` / `error.code` / `error.sourceError` to the top level
 * so Cloudflare log search can pivot on the underlying transport
 * failure instead of the useless wrapper message.
 *
 * Behavioural quirks worth knowing:
 *
 *   - Non-`Error` throws (`throw "boom"` / `throw 42`) round-trip
 *     through `String(...)` so the legacy contract is preserved.
 *   - A nested `Error` `cause` is shape-walked (name + message + first
 *     `CAUSE_STACK_LINES` of the stack); a non-`Error` `cause` (the
 *     plain-object response payload Neon HTTP attaches on certain
 *     failures) is shallow-cloned + redacted via `sanitizeErrorSidecar`.
 *   - `code` goes through `safeErrorCode` so an object/circular `code`
 *     can never explode the outer `JSON.stringify`.
 *   - `transformMessage` lets a caller strip driver-specific bloat from
 *     `error.message` (`stripQueryBloat` for Drizzle) without changing
 *     the rest of the shape.
 */
export function describeError(
  error: unknown,
  transformMessage: MessageTransform = (m) => m,
): unknown {
  if (!(error instanceof Error)) {
    return error === undefined ? undefined : String(error);
  }
  const err = error as Error & {
    cause?: unknown;
    code?: unknown;
    sourceError?: unknown;
  };
  const cause = err.cause;
  const causeShape =
    cause instanceof Error
      ? {
          name: cause.name,
          message: cause.message,
          stack: cause.stack
            ?.split("\n")
            .slice(0, CAUSE_STACK_LINES)
            .join("\n"),
        }
      : sanitizeErrorSidecar(cause);
  return {
    name: error.name,
    message: transformMessage(error.message),
    code: safeErrorCode(err.code),
    cause: causeShape,
    sourceError: sanitizeErrorSidecar(err.sourceError),
  };
}
