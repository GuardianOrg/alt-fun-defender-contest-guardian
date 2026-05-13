/**
 * Logging surface for the stress test harness.
 *
 * Two streams:
 *   - stdout: human-readable progress (banners, kv pairs, per-iteration
 *     lines, summary). This is "what the operator wants to see" — coloured
 *     when attached to a TTY, plain text when piped.
 *   - stderr: structured JSON debug log. ONLY emitted when `--debug` is
 *     passed. Useful for post-mortem on a failed run; ignored by default
 *     so concurrent runs don't fire-hose the terminal.
 *
 * Per-iteration concurrency is the constraint that shaped the API. With
 * `--concurrency 5` we don't want a 4-line preamble per iteration — just
 * one self-contained, index-prefixed line printed on completion so
 * interleaved output stays scannable.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

let debugEnabled = false;

export function setDebug(on: boolean): void {
  debugEnabled = on;
}

/**
 * Structured debug log. Gated entirely behind `--debug`. Routes to stderr
 * so a `2>debug.log` redirect cleanly separates verbose state from the
 * human-readable stdout stream.
 */
export function log(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (!debugEnabled) return;
  process.stderr.write(
    `${JSON.stringify({
      level,
      event,
      ...fields,
      timestamp: new Date().toISOString(),
    })}\n`,
  );
}

// ─── Human stream (stdout) ──────────────────────────────────────────────

function writeLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Backwards-compat shim. Old call sites that emitted plain status lines
 * via `report()` keep working without touching them; new code prefers
 * the typed helpers below for consistent visual treatment.
 */
export function report(message: string): void {
  writeLine(message);
}

// ─── Colour helpers ─────────────────────────────────────────────────────

// `npm run` pipes child stdout through its own stream, which makes
// `process.stdout.isTTY` come back `false` even when the operator is
// sitting at a real terminal. Honour `FORCE_COLOR` as the explicit
// opt-in for that case (and as the explicit opt-out via `NO_COLOR`).
// Matches the de-facto cross-tool convention (npm, chalk, vite all
// honour both vars).
const SUPPORTS_COLOR =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb" &&
  (process.env.FORCE_COLOR !== undefined || process.stdout.isTTY === true);

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
} as const;

type AnsiCode = keyof typeof ANSI;

function paint(codes: AnsiCode | readonly AnsiCode[], text: string): string {
  if (!SUPPORTS_COLOR) return text;
  const list: readonly AnsiCode[] = typeof codes === "string" ? [codes] : codes;
  return `${list.map((c) => ANSI[c]).join("")}${text}${ANSI.reset}`;
}

// ─── Human-stream helpers ──────────────────────────────────────────────

/** Top-of-run banner with an emoji + bold cyan title. */
export function banner(title: string): void {
  writeLine("");
  writeLine(paint(["bold", "cyan"], `🚀 ${title}`));
}

/** Section header. Compact (one line, blank line above). */
export function section(emoji: string, title: string): void {
  writeLine("");
  writeLine(paint("bold", `${emoji} ${title}`));
}

/** Two-column key/value row beneath a `section`. */
export function kv(key: string, value: string): void {
  writeLine(`  ${paint("dim", key.padEnd(10))}  ${value}`);
}

/** Green check + message. */
export function success(message: string): void {
  writeLine(`  ${paint("green", "✓")} ${message}`);
}

/** Red cross + message. */
export function failure(message: string): void {
  writeLine(`  ${paint("red", "✗")} ${message}`);
}

/** Neutral status (dim dot). */
export function info(message: string): void {
  writeLine(`  ${paint("dim", "·")} ${message}`);
}

/** Horizontal divider — used to bracket the final summary. */
export function divider(): void {
  writeLine(paint("dim", "─".repeat(60)));
}

/**
 * The per-iteration line printed on completion. Designed to stay
 * single-line + scannable when concurrency interleaves output:
 *
 *   `[03/20] ✓  HYPE-3L     Brave Tiger A9F2          (4.2s)`
 *
 * `primary` (16-wide, cyan) and `secondary` (34-wide, default) are
 * scenario-defined columns. `create-tokens` uses them for pair label
 * and token name; `trade-token` uses them for direction and amount.
 * Padding happens BEFORE colour escapes are applied so ANSI sequences
 * never get counted as visible width.
 */
export function iterationLine(opts: {
  index: number;
  total: number;
  ok: boolean;
  primary: string;
  secondary: string;
  durationMs: number;
  error?: string;
}): void {
  const idxPrefix = paint("dim", formatIndexPrefix(opts.index, opts.total));
  const marker = opts.ok ? paint("green", "✓") : paint("red", "✗");
  const primaryCol = paint("cyan", opts.primary.padEnd(16));
  const secondaryCol = truncate(opts.secondary, 34).padEnd(34);
  const duration = paint("dim", `(${(opts.durationMs / 1000).toFixed(1)}s)`);

  let line = `${idxPrefix} ${marker}  ${primaryCol}  ${secondaryCol}  ${duration}`;
  if (!opts.ok && opts.error) {
    // viem's revert messages embed real newlines (multi-line stack
    // context, "Contract Call:" blocks, etc.). Collapsing them keeps
    // the iteration line on ONE physical row so the per-iteration
    // tracking columns above don't get visually broken by a long
    // error wrapping into them. Full unredacted text still lands in
    // the grouped failures section of the summary.
    const flat = opts.error.replace(/\s+/g, " ").trim();
    line += `  ${paint("red", truncate(flat, 100))}`;
  }
  writeLine(line);
}

/**
 * "In flight" line printed when an iteration begins. Mirrors the
 * column layout of `iterationLine` so the eye can pair started and
 * completed lines visually, but uses a dim yellow `…` marker + dimmed
 * text so completion lines stand out against the noisier in-flight
 * stream.
 *
 * Without this, a `--concurrency 10` run sits silent for the first
 * 20+ seconds while the first batch of mines runs in parallel — the
 * harness looks frozen even though it's busy. With this, you see all
 * K in-flight iterations appear immediately and watch them transition
 * to ✓ / ✗ as each one resolves.
 */
export function iterationStart(opts: {
  index: number;
  total: number;
  primary: string;
  secondary: string;
}): void {
  const idxPrefix = paint("dim", formatIndexPrefix(opts.index, opts.total));
  const marker = paint("yellow", "…");
  const primaryCol = paint(["dim", "cyan"], opts.primary.padEnd(16));
  const secondaryCol = paint("dim", truncate(opts.secondary, 34).padEnd(34));
  writeLine(`${idxPrefix} ${marker}  ${primaryCol}  ${secondaryCol}`);
}

function formatIndexPrefix(index: number, total: number): string {
  const totalWidth = String(total).length;
  return `[${String(index).padStart(totalWidth, " ")}/${total}]`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
