import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

    // Write 65 distinct keys, expire them, then write one more — the
    // 64th write triggers the periodic sweep, and the 65th lands after
    // expiry, so the post-sweep Map should hold just the fresh key.
    for (let i = 0; i < 64; i++) {
      await cache.getOrFetch(`k-${i}`, () => fetcher(`k-${i}`));
    }
    vi.advanceTimersByTime(1_001);
    // Trigger the sweep — the 65th write crosses the SWEEP_EVERY_WRITES
    // threshold mod count after the prior 64.
    await cache.getOrFetch("fresh", () => fetcher("fresh"));

    // Every expired key should now be cold; re-fetching any of them
    // calls the underlying fetcher again (entry was evicted, not
    // resurrected from the Map).
    fetcher.mockClear();
    await cache.getOrFetch("k-0", () => fetcher("k-0"));
    expect(fetcher).toHaveBeenCalledTimes(1);
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
