/**
 * Structured JSON logger for the Cloudflare Worker. Every log line is a
 * single JSON object written to `console.{log,warn,error}` so Wrangler
 * tail and Logpush can index by `level`, `msg`, and any context fields
 * without regex-parsing free-form text.
 *
 * Two non-obvious responsibilities:
 *
 * 1. **Redact sensitive fields.** AGENTS.md "Never log private keys or
 *    PIN values" — Worker logs are visible to anyone with Cloudflare
 *    dashboard access. The redactor matches keys named (in any of
 *    snake_case / camelCase / kebab-case): token, secret, password,
 *    mnemonic, private, pin, apikey, masterkey. False positives are
 *    cheaper than false negatives here.
 *
 * 2. **Serialize Error instances.** `JSON.stringify(new Error("x"))`
 *    returns `"{}"`, so a raw `err` field would silently drop the
 *    stack. The redactor lifts `name` / `message` / `stack` out before
 *    handing the value to JSON.stringify.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

const SENSITIVE_TOKENS = new Set<string>([
  "token",
  "secret",
  "password",
  "mnemonic",
  "private",
  "pin",
  "apikey",
  "masterkey",
]);

const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular]";

const normalizeKey = (key: string): string =>
  key
    // camelCase boundary → snake
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    // unify kebab-case + dots
    .replace(/[-.]/g, "_")
    .toLowerCase();

/**
 * Sensitivity test that handles snake_case, camelCase, kebab-case,
 * and compound names like `api_key` / `master_key` / `private_key`.
 * Bare-substring would false-positive ("pinned", "keyboard"), so we
 * split on separators and match whole word-parts.
 */
export const isSensitiveKey = (key: string): boolean => {
  const parts = normalizeKey(key).split("_").filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.some((p) => SENSITIVE_TOKENS.has(p))) return true;
  // Compound names: `api_key`, `master_key`, `private_key`, `bot_token`…
  for (let i = 0; i < parts.length - 1; i++) {
    if (SENSITIVE_TOKENS.has(`${parts[i]}${parts[i + 1]}`)) return true;
  }
  return false;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

const redact = (value: unknown, seen: WeakSet<object>): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return CIRCULAR;
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  if (!isPlainObject(value)) {
    // Class instances, Maps, Sets — coerce to string to avoid leaking
    // internal slots into the log line.
    return String(value);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveKey(k) ? REDACTED : redact(v, seen);
  }
  return out;
};

const emit = (
  level: LogLevel,
  message: string,
  context: LogContext | undefined,
  now: () => Date,
): void => {
  const payload: Record<string, unknown> = {
    level,
    ts: now().toISOString(),
    msg: message,
  };
  if (context) {
    const safe = redact(context, new WeakSet()) as Record<string, unknown>;
    for (const [k, v] of Object.entries(safe)) payload[k] = v;
  }
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
};

export interface Logger {
  debug: (msg: string, ctx?: LogContext) => void;
  info: (msg: string, ctx?: LogContext) => void;
  warn: (msg: string, ctx?: LogContext) => void;
  error: (msg: string, ctx?: LogContext) => void;
}

/**
 * Factory exposed for tests that need a deterministic timestamp.
 * Production code imports the default `logger` singleton below.
 */
export const createLogger = (now: () => Date = () => new Date()): Logger => ({
  debug: (msg, ctx) => emit("debug", msg, ctx, now),
  info: (msg, ctx) => emit("info", msg, ctx, now),
  warn: (msg, ctx) => emit("warn", msg, ctx, now),
  error: (msg, ctx) => emit("error", msg, ctx, now),
});

export const logger: Logger = createLogger();
