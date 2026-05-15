/**
 * Diagnostics-only instrumentation. Goal: produce signals that let us
 * isolate which side of the stack caused the indexer to fall over (issue
 * around Railway CPU-drop / SIGTERM cycles). Strictly metrics — no
 * behavior change to the indexer itself.
 *
 * Each signal is mapped to a hypothesis it tests:
 *
 * - `heartbeat.loop_lag_*` — event-loop lag. If lag spikes during an
 *   incident, app-side sync work (DB writes, JSON parse) is blocking I/O
 *   and that explains transport-layer RPC timeouts. If lag stays low,
 *   the upstream RPC was the actual culprit.
 *
 * - `heartbeat.rss_mb` / `heap_used_mb` — memory pressure. A climb that
 *   precedes a drop in the Railway metrics confirms whether the spike
 *   to ~1.5GB was app-side accumulation vs. transient buffer.
 *
 * - `gc` events — long GC pauses (>100ms) often masquerade as network
 *   timeouts because every timer fires late while the runtime stops.
 *
 * - `signal` — confirms whether the process exit was external (Railway
 *   sent SIGTERM = healthcheck or redeploy) or an internal crash (no
 *   signal log preceding exit).
 *
 * - `boot` — first line on startup. Pair with `signal` across log
 *   sessions to confirm full container restart (new PID) vs in-process
 *   recovery.
 *
 * The healthz route in `api/index.ts` reads {@link getDiagnosticsSnapshot}
 * so Railway's healthcheck can flip to 503 once the event loop is wedged
 * — turning "Railway killed us for an unknown reason" into "Railway
 * killed us because lag_p99 was 4200ms".
 */
import { monitorEventLoopDelay, PerformanceObserver } from "node:perf_hooks";

const HEARTBEAT_INTERVAL_MS = Number(process.env.INDEXER_DIAG_HEARTBEAT_MS ?? 5_000);
const GC_LOG_THRESHOLD_MS = Number(process.env.INDEXER_DIAG_GC_THRESHOLD_MS ?? 100);
const LOOP_LAG_UNHEALTHY_MS = Number(process.env.INDEXER_DIAG_LAG_UNHEALTHY_MS ?? 1_000);

type SignalListener = { signal: NodeJS.Signals; handler: () => void };

type DiagState = {
  loopHist: ReturnType<typeof monitorEventLoopDelay>;
  heartbeatTimer: NodeJS.Timeout | null;
  gcObserver: PerformanceObserver | null;
  signalListeners: SignalListener[];
  installed: boolean;
};

const state: DiagState = {
  loopHist: monitorEventLoopDelay({ resolution: 20 }),
  heartbeatTimer: null,
  gcObserver: null,
  signalListeners: [],
  installed: false,
};

export type DiagnosticsSnapshot = {
  pid: number;
  uptime_s: number;
  rss_mb: number;
  heap_used_mb: number;
  heap_total_mb: number;
  external_mb: number;
  loop_lag_p50_ms: number;
  loop_lag_p99_ms: number;
  loop_lag_max_ms: number;
  unhealthy_lag_threshold_ms: number;
};

function nsToMs(ns: number): number {
  return Math.round(ns / 1e6);
}

export function getDiagnosticsSnapshot(): DiagnosticsSnapshot {
  const mem = process.memoryUsage();
  return {
    pid: process.pid,
    uptime_s: Math.round(process.uptime()),
    rss_mb: Math.round(mem.rss / 1e6),
    heap_used_mb: Math.round(mem.heapUsed / 1e6),
    heap_total_mb: Math.round(mem.heapTotal / 1e6),
    external_mb: Math.round(mem.external / 1e6),
    loop_lag_p50_ms: nsToMs(state.loopHist.percentile(50)),
    loop_lag_p99_ms: nsToMs(state.loopHist.percentile(99)),
    loop_lag_max_ms: nsToMs(state.loopHist.max),
    unhealthy_lag_threshold_ms: LOOP_LAG_UNHEALTHY_MS,
  };
}

export function isHealthy(snapshot: DiagnosticsSnapshot = getDiagnosticsSnapshot()): boolean {
  return snapshot.loop_lag_p99_ms < snapshot.unhealthy_lag_threshold_ms;
}

function emitJson(payload: Record<string, unknown>): void {
  // Single-line JSON so Railway's log search can grep by `tag` field.
  console.log(JSON.stringify(payload));
}

function emitHeartbeat(): void {
  const snapshot = getDiagnosticsSnapshot();
  emitJson({ tag: "diag.heartbeat", ...snapshot });
  // Reset so each interval reflects only the last window — otherwise
  // a single early spike dominates the percentiles forever.
  state.loopHist.reset();
}

function installGcObserver(): PerformanceObserver {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration < GC_LOG_THRESHOLD_MS) continue;
      const detail = (entry as unknown as { detail?: { kind?: number } }).detail;
      emitJson({
        tag: "diag.gc",
        duration_ms: Math.round(entry.duration),
        kind: detail?.kind ?? null,
      });
    }
  });
  observer.observe({ entryTypes: ["gc"] });
  return observer;
}

function installSignalHandlers(): void {
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    const handler = () => {
      emitJson({
        tag: "diag.signal",
        signal: sig,
        pid: process.pid,
        uptime_s: Math.round(process.uptime()),
      });
    };
    process.on(sig, handler);
    state.signalListeners.push({ signal: sig, handler });
  }
}

export function installInstrumentation(): void {
  if (state.installed) return;
  state.installed = true;
  state.loopHist.enable();
  state.gcObserver = installGcObserver();
  installSignalHandlers();
  state.heartbeatTimer = setInterval(emitHeartbeat, HEARTBEAT_INTERVAL_MS);
  // Don't keep the process alive for diagnostics alone.
  state.heartbeatTimer.unref();
  emitJson({
    tag: "diag.boot",
    pid: process.pid,
    node: process.version,
    heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
    gc_log_threshold_ms: GC_LOG_THRESHOLD_MS,
    unhealthy_lag_threshold_ms: LOOP_LAG_UNHEALTHY_MS,
  });
}

export function _resetForTesting(): void {
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
  if (state.gcObserver) state.gcObserver.disconnect();
  for (const { signal, handler } of state.signalListeners) {
    process.off(signal, handler);
  }
  state.signalListeners = [];
  state.loopHist.disable();
  state.loopHist = monitorEventLoopDelay({ resolution: 20 });
  state.heartbeatTimer = null;
  state.gcObserver = null;
  state.installed = false;
}

installInstrumentation();
