import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INFLIGHT_TIMEOUT_MS } from "../utils/inflight.js";
import { HEAVY_READ_TIMEOUT_MS } from "../utils/outbound-timeout.js";
import { createIsolateTtlCache } from "../utils/isolate-ttl-cache.js";

/**
 * Unit tests for `createIsolateTtlCache`. The cache wraps any async
 * fetcher with a per-isolate TTL memo and single-flight coalescing. The
 * tests below pin the behaviours that the hot single-token reads (issue
 * #1125, solution #3) rely on — anything regressing here would silently
 * change the burst-collapse properties of `/tokens/:addr`,
 * `/trades/:addr`, `/holders/:addr`, `/chart/:addr`.
 */
describe("createIsolateTtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the fetcher's value on a cold miss", async () => {
    const cache = createIsolateTtlCache<string>({ ttlMs: 1_000 });
    const fetcher = vi.fn().mockResolvedValue("v1");

    const result = await cache.getOrFetch("k", fetcher);

    expect(result).toBe("v1");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serves subsequent calls inside the TTL from the cache", async () => {
    const cache = createIsolateTtlCache<string>({ ttlMs: 1_000 });
    const fetcher = vi.fn().mockResolvedValue("v1");

    await cache.getOrFetch("k", fetcher);
    await cache.getOrFetch("k", fetcher);
    await cache.getOrFetch("k", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("falls through to the fetcher once the TTL has elapsed", async () => {
    const cache = createIsolateTtlCache<string>({ ttlMs: 1_000 });
    const fetcher = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");

    expect(await cache.getOrFetch("k", fetcher)).toBe("v1");
    vi.advanceTimersByTime(1_001);
    expect(await cache.getOrFetch("k", fetcher)).toBe("v2");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("scopes entries by key", async () => {
    const cache = createIsolateTtlCache<string>({ ttlMs: 1_000 });
    const fetcher = vi.fn(async (key: string) => `value-${key}`);

    expect(await cache.getOrFetch("a", () => fetcher("a"))).toBe("value-a");
    expect(await cache.getOrFetch("b", () => fetcher("b"))).toBe("value-b");
    expect(await cache.getOrFetch("a", () => fetcher("a"))).toBe("value-a");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent in-flight callers under one underlying fetch", async () => {
    const cache = createIsolateTtlCache<string>({ ttlMs: 1_000 });
    let resolveInner!: (value: string) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveInner = resolve;
        }),
    );

    const a = cache.getOrFetch("k", fetcher);
    const b = cache.getOrFetch("k", fetcher);
    const c = cache.getOrFetch("k", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveInner("shared");
    expect(await a).toBe("shared");
    expect(await b).toBe("shared");
    expect(await c).toBe("shared");
  });

  it("propagates fetcher rejections without pinning them in the cache", async () => {
    const cache = createIsolateTtlCache<string>({ ttlMs: 1_000 });
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("v1");

    await expect(cache.getOrFetch("k", fetcher)).rejects.toThrow("transient");
    // Immediately retrying must re-run the fetcher — a pinned error
    // would otherwise amplify a one-off Neon hiccup into TTL seconds of
    // forced failures.
    expect(await cache.getOrFetch("k", fetcher)).toBe("v1");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("skips caching when shouldCache returns false", async () => {
    const cache = createIsolateTtlCache<string | "unavailable">({
      ttlMs: 1_000,
      shouldCache: (value) => value !== "unavailable",
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce("unavailable")
      .mockResolvedValueOnce("v1")
      .mockResolvedValueOnce("v2");

    expect(await cache.getOrFetch("k", fetcher)).toBe("unavailable");
    // Error sentinel must not be pinned; next call re-runs the fetcher.
    expect(await cache.getOrFetch("k", fetcher)).toBe("v1");
    // The cacheable value is now pinned — third call must hit cache.
    expect(await cache.getOrFetch("k", fetcher)).toBe("v1");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("lazy-deletes a stale entry on read so the next write doesn't pile up", async () => {
    const cache = createIsolateTtlCache<string>({ ttlMs: 1_000 });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce("v1")
      .mockResolvedValueOnce("v2");

    expect(await cache.getOrFetch("k", fetcher)).toBe("v1");
    vi.advanceTimersByTime(1_001);
    expect(await cache.getOrFetch("k", fetcher)).toBe("v2");

    // The stale "v1" entry should have been evicted on the second
    // call's read path, replaced by the fresh "v2" — verified by the
    // fact that the next same-key read inside the new TTL window
    // hits cache without a third fetcher call.
    expect(await cache.getOrFetch("k", fetcher)).toBe("v2");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("periodically sweeps expired write-only keys so the Map stays bounded", async () => {
    const cache = createIsolateTtlCache<string>({ ttlMs: 1_000 });
    const fetcher = vi.fn(async (key: string) => `value-${key}`);

    // Write 64 distinct keys (one short of triggering a sweep), then
    // expire them all. The 65th write is the one that crosses the
    // SWEEP_EVERY_WRITES threshold (the counter increments before the
    // comparison, so the 64th-after-cache-construction write trips it).
    for (let i = 0; i < 63; i++) {
      await cache.getOrFetch(`k-${i}`, () => fetcher(`k-${i}`));
    }
    expect(cache.size).toBe(63);
    vi.advanceTimersByTime(1_001);
    // Pre-sweep: every key is expired but still occupies a slot in the
    // Map — `lazy-delete on read` hasn't fired because no one read them.
    expect(cache.size).toBe(63);

    // This 64th write triggers the sweep. The fresh entry is added,
    // then the sweep walks the Map and drops every `expiresAt <= now`
    // row — only the brand-new entry survives.
    await cache.getOrFetch("fresh", () => fetcher("fresh"));
    expect(cache.size).toBe(1);
  });

  it("enforces maxEntries by evicting the oldest-inserted key (FIFO)", async () => {
    const cache = createIsolateTtlCache<string>({
      ttlMs: 60_000,
      maxEntries: 3,
    });
    const fetcher = vi.fn(async (key: string) => `value-${key}`);

    await cache.getOrFetch("a", () => fetcher("a"));
    await cache.getOrFetch("b", () => fetcher("b"));
    await cache.getOrFetch("c", () => fetcher("c"));
    // Cap full. Adding "d" must evict "a" (oldest insert).
    await cache.getOrFetch("d", () => fetcher("d"));

    fetcher.mockClear();
    // "b", "c", "d" still live — those hit cache.
    await cache.getOrFetch("b", () => fetcher("b"));
    await cache.getOrFetch("c", () => fetcher("c"));
    await cache.getOrFetch("d", () => fetcher("d"));
    expect(fetcher).not.toHaveBeenCalled();
    // "a" was evicted — re-fetch hits the underlying fetcher.
    await cache.getOrFetch("a", () => fetcher("a"));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("evicts FIFO when filling past cap — keeps the most recently inserted keys", async () => {
    // Verifies the eviction order is insertion-order (oldest first), not
    // random or last-in. With cap=2 and inserts a→b→c, the live set must
    // be {b, c}: "a" goes out when "c" comes in.
    const cache = createIsolateTtlCache<string>({
      ttlMs: 60_000,
      maxEntries: 2,
    });
    const fetcher = vi.fn(async (key: string) => `value-${key}`);

    await cache.getOrFetch("a", () => fetcher("a"));
    await cache.getOrFetch("b", () => fetcher("b"));
    await cache.getOrFetch("c", () => fetcher("c"));

    fetcher.mockClear();
    await cache.getOrFetch("b", () => fetcher("b"));
    await cache.getOrFetch("c", () => fetcher("c"));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a non-positive-integer maxEntries", () => {
    expect(() =>
      createIsolateTtlCache<string>({ ttlMs: 1_000, maxEntries: 0 }),
    ).toThrow(/positive integer/);
    expect(() =>
      createIsolateTtlCache<string>({ ttlMs: 1_000, maxEntries: 1.5 }),
    ).toThrow(/positive integer/);
  });

  it("re-enters so N waiters on a dead promise share exactly one replacement fetch", async () => {
    const timeoutMs = 80;
    const cache = createIsolateTtlCache<string>({
      ttlMs: 60_000,
      inflightTimeoutMs: timeoutMs,
    });
    let calls = 0;
    const fetcher = vi.fn(() => {
      calls += 1;
      if (calls === 1) return new Promise<string>(() => {});
      return Promise.resolve("ok");
    });

    const waiters = Array.from({ length: 5 }, () =>
      cache.getOrFetch("k", fetcher),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(timeoutMs);
    const results = await Promise.all(waiters);
    expect(results).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not evict a newer owner when a late waiter times out", async () => {
    const timeoutMs = 80;
    const cache = createIsolateTtlCache<string>({
      ttlMs: 60_000,
      inflightTimeoutMs: timeoutMs,
    });
    let calls = 0;
    let resolveOwner2!: (value: string) => void;
    const fetcher = vi.fn(() => {
      calls += 1;
      if (calls === 1) return new Promise<string>(() => {});
      return new Promise<string>((resolve) => {
        resolveOwner2 = resolve;
      });
    });

    const owner1 = cache.getOrFetch("k", fetcher);
    await vi.advanceTimersByTimeAsync(timeoutMs / 2);
    const waiterA = cache.getOrFetch("k", fetcher);

    await vi.advanceTimersByTimeAsync(timeoutMs / 2);
    expect(fetcher).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(timeoutMs / 2);
    resolveOwner2("v2");
    expect(await owner1).toBe("v2");
    expect(await waiterA).toBe("v2");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not treat a ~5s fetch as dead under the production timeout", async () => {
    expect(INFLIGHT_TIMEOUT_MS).toBeGreaterThan(HEAVY_READ_TIMEOUT_MS);
    expect(INFLIGHT_TIMEOUT_MS).toBeLessThan(100_000);

    const cache = createIsolateTtlCache<string>({ ttlMs: 60_000 });
    let resolveInner!: (value: string) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveInner = resolve;
        }),
    );
    const pending = cache.getOrFetch("k", fetcher);
    await vi.advanceTimersByTimeAsync(5_000);
    resolveInner("ok");
    expect(await pending).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("logs an eviction with key and elapsed time", async () => {
    const timeoutMs = 80;
    const cache = createIsolateTtlCache<string>({
      ttlMs: 60_000,
      inflightTimeoutMs: timeoutMs,
    });
    const hanging = vi.fn(() => new Promise<string>(() => {}));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const pending = cache.getOrFetch("dead-key", hanging);
    hanging.mockImplementation(() => Promise.resolve("ok"));
    await vi.advanceTimersByTimeAsync(timeoutMs);
    expect(await pending).toBe("ok");

    const evictionLogs = logSpy.mock.calls
      .map((c) => c[0])
      .filter((s): s is string => typeof s === "string")
      .map((s) => {
        try {
          return JSON.parse(s) as { event?: string; key?: string; elapsedMs?: number };
        } catch {
          return null;
        }
      })
      .filter((o) => o?.event === "inflight_evicted");
    expect(evictionLogs.length).toBeGreaterThanOrEqual(1);
    expect(evictionLogs[0]?.key).toBe("dead-key");
    expect(evictionLogs[0]?.elapsedMs).toBeGreaterThanOrEqual(timeoutMs);
    logSpy.mockRestore();
  });

  it("surfaces a dead dependency after one retry instead of looping", async () => {
    const timeoutMs = 80;
    const cache = createIsolateTtlCache<string>({
      ttlMs: 60_000,
      inflightTimeoutMs: timeoutMs,
    });
    const hanging = vi.fn(() => new Promise<string>(() => {}));
    const pending = cache.getOrFetch("k", hanging);
    const assertion = expect(pending).rejects.toThrow(/in-flight wait timed out/);

    await vi.advanceTimersByTimeAsync(timeoutMs);
    await vi.advanceTimersByTimeAsync(timeoutMs);
    await assertion;
    expect(hanging).toHaveBeenCalledTimes(2);
  });

  it("does not let a timed-out fetch overwrite a newer cached value", async () => {
    const timeoutMs = 80;
    const cache = createIsolateTtlCache<string>({
      ttlMs: 60_000,
      inflightTimeoutMs: timeoutMs,
    });
    let resolveOriginal!: (value: string) => void;
    const fetcher = vi.fn(() => {
      if (fetcher.mock.calls.length === 1) {
        return new Promise<string>((resolve) => {
          resolveOriginal = resolve;
        });
      }
      return Promise.resolve("fresh");
    });

    const pending = cache.getOrFetch("k", fetcher);
    await vi.advanceTimersByTimeAsync(timeoutMs);
    expect(await pending).toBe("fresh");

    resolveOriginal("stale");
    await Promise.resolve();
    await Promise.resolve();

    const cached = await cache.getOrFetch("k", fetcher);
    expect(cached).toBe("fresh");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("hands the owner promise to waitUntil when an execution context is passed", async () => {
    const cache = createIsolateTtlCache<string>({ ttlMs: 1_000 });
    let resolveInner!: (value: string) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveInner = resolve;
        }),
    );
    const waitUntil = vi.fn();

    const p = cache.getOrFetch("k", fetcher, { waitUntil });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);

    void cache.getOrFetch("k", fetcher, { waitUntil });
    expect(waitUntil).toHaveBeenCalledTimes(1);

    resolveInner("ok");
    expect(await p).toBe("ok");
  });

  it("clears all entries on reset()", async () => {
    const cache = createIsolateTtlCache<string>({ ttlMs: 60_000 });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce("v1")
      .mockResolvedValueOnce("v2");

    expect(await cache.getOrFetch("k", fetcher)).toBe("v1");
    cache.reset();
    expect(await cache.getOrFetch("k", fetcher)).toBe("v2");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
