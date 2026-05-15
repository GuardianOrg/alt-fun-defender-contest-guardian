import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";

import {
  _resetForTesting,
  getDiagnosticsSnapshot,
  installInstrumentation,
  isHealthy,
} from "../src/instrumentation";

describe("instrumentation", () => {
  let consoleSpy: MockInstance<(...args: unknown[]) => void>;

  beforeEach(() => {
    _resetForTesting();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    _resetForTesting();
    consoleSpy.mockRestore();
  });

  it("emits a boot log on install", () => {
    installInstrumentation();
    const lines: string[] = consoleSpy.mock.calls.map((call) => String(call[0]));
    const boot = lines.find((line: string) => line.includes('"tag":"diag.boot"'));
    expect(boot).toBeDefined();
    const parsed = JSON.parse(boot!);
    expect(parsed.tag).toBe("diag.boot");
    expect(parsed.pid).toBe(process.pid);
    expect(typeof parsed.heartbeat_interval_ms).toBe("number");
    expect(typeof parsed.unhealthy_lag_threshold_ms).toBe("number");
  });

  it("install is idempotent — calling twice does not re-emit boot", () => {
    installInstrumentation();
    const callsAfterFirst = consoleSpy.mock.calls.length;
    installInstrumentation();
    expect(consoleSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("snapshot exposes the fields the /healthz route relies on", () => {
    installInstrumentation();
    const snap = getDiagnosticsSnapshot();
    expect(snap).toMatchObject({
      pid: expect.any(Number),
      uptime_s: expect.any(Number),
      rss_mb: expect.any(Number),
      heap_used_mb: expect.any(Number),
      heap_total_mb: expect.any(Number),
      external_mb: expect.any(Number),
      loop_lag_p50_ms: expect.any(Number),
      loop_lag_p99_ms: expect.any(Number),
      loop_lag_max_ms: expect.any(Number),
      unhealthy_lag_threshold_ms: expect.any(Number),
    });
    expect(snap.pid).toBe(process.pid);
    expect(snap.rss_mb).toBeGreaterThan(0);
    expect(snap.unhealthy_lag_threshold_ms).toBeGreaterThan(0);
  });

  it("isHealthy is true when lag is below threshold and false when above", () => {
    installInstrumentation();
    const okSnap = {
      ...getDiagnosticsSnapshot(),
      loop_lag_p99_ms: 0,
      unhealthy_lag_threshold_ms: 1000,
    };
    expect(isHealthy(okSnap)).toBe(true);

    const badSnap = {
      ...okSnap,
      loop_lag_p99_ms: 2000,
    };
    expect(isHealthy(badSnap)).toBe(false);
  });

  it("registers a SIGTERM listener so we can prove the kill came from Railway", () => {
    const before = process.listenerCount("SIGTERM");
    installInstrumentation();
    const after = process.listenerCount("SIGTERM");
    expect(after).toBe(before + 1);
  });
});
