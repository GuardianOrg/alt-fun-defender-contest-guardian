import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Unit tests for the in-isolate cache around `fetchLiveLtRates`. Pins the
// behaviour the route relies on: cold call hits the mirror, warm call
// hits the cache, concurrent cold callers fan in to a single read, and
// failures degrade gracefully (return stale when we have it, null when
// we don't). See the JSDoc on `fetchLiveLtRates` for the rationale.

const LT_A = "0xAaaa000000000000000000000000000000000001";
const LT_B = "0xBbbb000000000000000000000000000000000002";

const mockReadLiveLtRates = vi.fn<
  (databaseUrl: string) => Promise<Map<string, number> | null>
>();
vi.mock("../lib/lt-directory-reads.js", () => ({
  readLtDirectory: vi.fn(),
  readSupportedLtDirectory: vi.fn(),
  readLiveLtRates: mockReadLiveLtRates,
  readLtByAddress: vi.fn(),
  readDirectoryLastUpdatedAt: vi.fn(),
}));

const { INFLIGHT_TIMEOUT_MS } = await import("../utils/inflight.js");
const {
  _resetLiveLtRatesCache,
  fetchLiveLtRates,
  fetchLiveLtRatesWithProvenance,
} = await import("../lib/market-data.js");

const DB_URL = "postgres://test";

function rateMap(entries: Record<string, number>): Map<string, number> {
  const m = new Map<string, number>();
  for (const [k, v] of Object.entries(entries)) m.set(k.toLowerCase(), v);
  return m;
}

beforeEach(() => {
  _resetLiveLtRatesCache();
  mockReadLiveLtRates.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchLiveLtRates — caching", () => {
  it("hits the mirror on a cold call and returns the parsed rates", async () => {
    mockReadLiveLtRates.mockResolvedValueOnce(rateMap({ [LT_A]: 2 }));

    const result = await fetchLiveLtRates(DB_URL);

    expect(mockReadLiveLtRates).toHaveBeenCalledTimes(1);
    expect(mockReadLiveLtRates).toHaveBeenCalledWith(DB_URL);
    expect(result).not.toBeNull();
    expect(result!.get(LT_A.toLowerCase())).toBeCloseTo(2);
  });

  it("returns the cached map on a warm call without re-reading the mirror", async () => {
    mockReadLiveLtRates.mockResolvedValueOnce(rateMap({ [LT_A]: 1 }));

    const first = await fetchLiveLtRates(DB_URL);
    const second = await fetchLiveLtRates(DB_URL);
    const third = await fetchLiveLtRates(DB_URL);

    expect(mockReadLiveLtRates).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(first!.get(LT_A.toLowerCase())).toBeCloseTo(1);
  });

  it("re-reads once the TTL elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    mockReadLiveLtRates.mockResolvedValueOnce(rateMap({ [LT_A]: 1 }));
    const first = await fetchLiveLtRates(DB_URL);
    expect(first!.get(LT_A.toLowerCase())).toBeCloseTo(1);

    // Advance well past the 5s TTL — the next call must rebuild from a
    // fresh read, not serve stale cached rates.
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    mockReadLiveLtRates.mockResolvedValueOnce(rateMap({ [LT_B]: 3 }));
    const second = await fetchLiveLtRates(DB_URL);

    expect(mockReadLiveLtRates).toHaveBeenCalledTimes(2);
    expect(second!.get(LT_B.toLowerCase())).toBeCloseTo(3);
    expect(second!.has(LT_A.toLowerCase())).toBe(false);
  });

  it("fans concurrent cold callers in to a single in-flight read", async () => {
    // Pins the Promise-lock behaviour: a cold isolate getting hit by
    // multiple parallel handlers (the production tail averages ~22
    // /market-data req/s, all touching the same cache) must not fan
    // out N parallel mirror reads.
    let resolveRead!: (value: Map<string, number>) => void;
    const readPromise = new Promise<Map<string, number>>((resolve) => {
      resolveRead = resolve;
    });
    mockReadLiveLtRates.mockReturnValueOnce(readPromise);

    const callA = fetchLiveLtRates(DB_URL);
    const callB = fetchLiveLtRates(DB_URL);
    const callC = fetchLiveLtRates(DB_URL);

    expect(mockReadLiveLtRates).toHaveBeenCalledTimes(1);

    resolveRead(rateMap({ [LT_A]: 2 }));
    const [a, b, c] = await Promise.all([callA, callB, callC]);

    expect(mockReadLiveLtRates).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a!.get(LT_A.toLowerCase())).toBeCloseTo(2);
  });

  it("returns null when the mirror read fails and there is no cached entry", async () => {
    // Cold-start outage — we have nothing to fall back to, so the route
    // gets a chance to surface 503 honestly instead of silently degrading.
    mockReadLiveLtRates.mockResolvedValueOnce(null);

    const result = await fetchLiveLtRates(DB_URL);

    expect(mockReadLiveLtRates).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it("returns null when the mirror read throws and there is no cached entry", async () => {
    mockReadLiveLtRates.mockRejectedValueOnce(new Error("ECONNRESET"));

    const result = await fetchLiveLtRates(DB_URL);

    expect(result).toBeNull();
  });

  it("returns the stale cached map when a refresh fails (fail-open)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    // Seed the cache with a successful first read.
    mockReadLiveLtRates.mockResolvedValueOnce(rateMap({ [LT_A]: 2 }));
    const seeded = await fetchLiveLtRates(DB_URL);
    expect(seeded!.get(LT_A.toLowerCase())).toBeCloseTo(2);

    // Move past TTL so the next call attempts a refresh.
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));

    // Mirror returns null (DB read failed). We must not collapse to
    // null; serving the stale rate is strictly better than 503'ing the
    // entire /market-data surface for every connected client.
    mockReadLiveLtRates.mockResolvedValueOnce(null);
    const afterNull = await fetchLiveLtRates(DB_URL);
    expect(afterNull).not.toBeNull();
    expect(afterNull!.get(LT_A.toLowerCase())).toBeCloseTo(2);

    // Same fail-open behaviour for a thrown read (transient pool error).
    mockReadLiveLtRates.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    const afterThrow = await fetchLiveLtRates(DB_URL);
    expect(afterThrow).not.toBeNull();
    expect(afterThrow!.get(LT_A.toLowerCase())).toBeCloseTo(2);

    expect(mockReadLiveLtRates).toHaveBeenCalledTimes(3);
  });

  it("reports whether the map it returned came from the expired cache", async () => {
    // The fail-open above is right, but it was invisible to callers. A
    // caller that edge-caches its response has to know, or it publishes
    // an arbitrarily old rate under a fresh TTL. Codex review on PR #1235.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    mockReadLiveLtRates.mockResolvedValueOnce(rateMap({ [LT_A]: 2 }));
    const fresh = await fetchLiveLtRatesWithProvenance(DB_URL);
    expect(fresh.rates!.get(LT_A.toLowerCase())).toBeCloseTo(2);
    expect(fresh.stale).toBe(false);

    // Inside the TTL — still fresh, no refresh attempted.
    const warm = await fetchLiveLtRatesWithProvenance(DB_URL);
    expect(warm.stale).toBe(false);

    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    mockReadLiveLtRates.mockResolvedValueOnce(null);
    const afterNull = await fetchLiveLtRatesWithProvenance(DB_URL);
    expect(afterNull.rates!.get(LT_A.toLowerCase())).toBeCloseTo(2);
    expect(afterNull.stale).toBe(true);

    mockReadLiveLtRates.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    const afterThrow = await fetchLiveLtRatesWithProvenance(DB_URL);
    expect(afterThrow.stale).toBe(true);

    // Recovery clears the flag.
    mockReadLiveLtRates.mockResolvedValueOnce(rateMap({ [LT_A]: 3 }));
    const recovered = await fetchLiveLtRatesWithProvenance(DB_URL);
    expect(recovered.rates!.get(LT_A.toLowerCase())).toBeCloseTo(3);
    expect(recovered.stale).toBe(false);
  });

  it("gives every coalesced caller the same provenance", async () => {
    // Provenance travels inside the in-flight promise rather than in a
    // module-level flag, so callers that fan into one read can't observe
    // a later read's outcome.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    mockReadLiveLtRates.mockResolvedValueOnce(rateMap({ [LT_A]: 2 }));
    await fetchLiveLtRatesWithProvenance(DB_URL);

    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    mockReadLiveLtRates.mockResolvedValueOnce(null);

    const [a, b, c] = await Promise.all([
      fetchLiveLtRatesWithProvenance(DB_URL),
      fetchLiveLtRatesWithProvenance(DB_URL),
      fetchLiveLtRatesWithProvenance(DB_URL),
    ]);

    // One read served all three, and all three know it was stale.
    expect(mockReadLiveLtRates).toHaveBeenCalledTimes(2);
    expect([a.stale, b.stale, c.stale]).toEqual([true, true, true]);
  });

  it("reports a cold failure with no cache as not-stale, since there is no body", async () => {
    // `stale` means "this map is older than it looks". A null map isn't
    // stale, it's absent — the caller already treats null as degraded.
    mockReadLiveLtRates.mockResolvedValueOnce(null);
    const result = await fetchLiveLtRatesWithProvenance(DB_URL);
    expect(result.rates).toBeNull();
    expect(result.stale).toBe(false);
  });

  it("does not let a timed-out read overwrite a newer cached map", async () => {
    vi.useFakeTimers();
    let resolveOriginal!: (value: Map<string, number>) => void;
    mockReadLiveLtRates
      .mockReturnValueOnce(
        new Promise<Map<string, number>>((resolve) => {
          resolveOriginal = resolve;
        }),
      )
      .mockResolvedValueOnce(rateMap({ [LT_A]: 2 }));

    const pending = fetchLiveLtRates(DB_URL);
    await vi.advanceTimersByTimeAsync(INFLIGHT_TIMEOUT_MS);
    expect(await pending).toEqual(rateMap({ [LT_A]: 2 }));

    resolveOriginal(rateMap({ [LT_A]: 1 }));
    await Promise.resolve();
    await Promise.resolve();

    const cached = await fetchLiveLtRates(DB_URL);
    expect(cached!.get(LT_A.toLowerCase())).toBeCloseTo(2);
    expect(mockReadLiveLtRates).toHaveBeenCalledTimes(2);
  });

  it("does not pin later callers on a never-settling mirror read", async () => {
    vi.useFakeTimers();
    mockReadLiveLtRates
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce(rateMap({ [LT_A]: 2 }));

    const first = fetchLiveLtRates(DB_URL);
    const waiter = fetchLiveLtRates(DB_URL);
    expect(mockReadLiveLtRates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INFLIGHT_TIMEOUT_MS);
    const [a, b] = await Promise.all([first, waiter]);
    expect(a).not.toBeNull();
    expect(a!.get(LT_A.toLowerCase())).toBeCloseTo(2);
    expect(b).toBe(a);
    expect(mockReadLiveLtRates).toHaveBeenCalledTimes(2);
  });

  it("hands the owner promise to waitUntil when an execution context is passed", async () => {
    let resolveRead!: (value: Map<string, number>) => void;
    mockReadLiveLtRates.mockReturnValueOnce(
      new Promise<Map<string, number>>((resolve) => {
        resolveRead = resolve;
      }),
    );
    const waitUntil = vi.fn();
    const pending = fetchLiveLtRatesWithProvenance(DB_URL, { waitUntil });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    resolveRead(rateMap({ [LT_A]: 1 }));
    const result = await pending;
    expect(result.rates!.get(LT_A.toLowerCase())).toBeCloseTo(1);
  });

  it("clears the in-flight lock when the read rejects so the next caller can retry", async () => {
    // Regression pin: if the `finally` that nulls `liveLtRatesInflight`
    // ever stops running on the throw path, every subsequent call would
    // forever resolve to the same failed Promise — a single mirror blip
    // would wedge the cache for the lifetime of the isolate.
    mockReadLiveLtRates.mockRejectedValueOnce(new Error("ECONNRESET"));
    const first = await fetchLiveLtRates(DB_URL);
    expect(first).toBeNull();

    mockReadLiveLtRates.mockResolvedValueOnce(rateMap({ [LT_A]: 1 }));
    const second = await fetchLiveLtRates(DB_URL);
    expect(second).not.toBeNull();
    expect(second!.get(LT_A.toLowerCase())).toBeCloseTo(1);
  });
});

describe("_resetLiveLtRatesCache", () => {
  it("clears the cache so the next call hits the mirror again", async () => {
    mockReadLiveLtRates.mockResolvedValue(rateMap({ [LT_A]: 1 }));

    await fetchLiveLtRates(DB_URL);
    await fetchLiveLtRates(DB_URL);
    expect(mockReadLiveLtRates).toHaveBeenCalledTimes(1);

    _resetLiveLtRatesCache();
    await fetchLiveLtRates(DB_URL);
    expect(mockReadLiveLtRates).toHaveBeenCalledTimes(2);
  });
});
