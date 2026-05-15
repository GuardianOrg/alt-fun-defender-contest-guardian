import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetLiveLtRatesCache,
  fetchLiveLtRates,
} from "../lib/market-data.js";

// Unit tests for the in-isolate cache around `fetchLiveLtRates`. Pins the
// behaviour the route relies on: cold call hits the network, warm call
// hits the cache, concurrent cold callers fan in to a single fetch, and
// failures degrade gracefully (return stale when we have it, null when
// we don't). See the JSDoc on `fetchLiveLtRates` for the rationale.

const LT_A = "0xAaaa000000000000000000000000000000000001";
const LT_B = "0xBbbb000000000000000000000000000000000002";

function bounceLtResponseBody(rates: Record<string, string>) {
  return {
    data: Object.entries(rates).map(([address, exchangeRate]) => ({
      address,
      exchangeRate,
    })),
  };
}

function okJsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as unknown as Response;
}

function notOkResponse(status = 503) {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response;
}

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  _resetLiveLtRatesCache();
  mockFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchLiveLtRates — caching", () => {
  it("hits the network on a cold call and returns the parsed rates", async () => {
    mockFetch.mockResolvedValueOnce(
      okJsonResponse(bounceLtResponseBody({ [LT_A]: "2000000000000000000" })),
    );

    const result = await fetchLiveLtRates();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://indexing.bounce.tech/leveraged-tokens",
    );
    expect(result).not.toBeNull();
    expect(result!.get(LT_A.toLowerCase())).toBeCloseTo(2);
  });

  it("returns the cached map on a warm call without hitting the network", async () => {
    mockFetch.mockResolvedValueOnce(
      okJsonResponse(bounceLtResponseBody({ [LT_A]: "1000000000000000000" })),
    );

    const first = await fetchLiveLtRates();
    const second = await fetchLiveLtRates();
    const third = await fetchLiveLtRates();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(first!.get(LT_A.toLowerCase())).toBeCloseTo(1);
  });

  it("re-fetches once the TTL elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    mockFetch.mockResolvedValueOnce(
      okJsonResponse(bounceLtResponseBody({ [LT_A]: "1000000000000000000" })),
    );
    const first = await fetchLiveLtRates();
    expect(first!.get(LT_A.toLowerCase())).toBeCloseTo(1);

    // Advance well past the 5s TTL — the next call must rebuild from a
    // fresh fetch, not serve stale cached rates.
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    mockFetch.mockResolvedValueOnce(
      okJsonResponse(bounceLtResponseBody({ [LT_B]: "3000000000000000000" })),
    );
    const second = await fetchLiveLtRates();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(second!.get(LT_B.toLowerCase())).toBeCloseTo(3);
    expect(second!.has(LT_A.toLowerCase())).toBe(false);
  });

  it("fans concurrent cold callers in to a single in-flight fetch", async () => {
    // Pins the Promise-lock behaviour: a cold isolate getting hit by
    // multiple parallel handlers (the production tail averages ~22
    // /market-data req/s, all touching the same cache) must not fan
    // out N parallel BounceTech directory fetches.
    let resolveFetch!: (response: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    mockFetch.mockReturnValueOnce(fetchPromise);

    const callA = fetchLiveLtRates();
    const callB = fetchLiveLtRates();
    const callC = fetchLiveLtRates();

    expect(mockFetch).toHaveBeenCalledTimes(1);

    resolveFetch(
      okJsonResponse(bounceLtResponseBody({ [LT_A]: "2000000000000000000" })),
    );
    const [a, b, c] = await Promise.all([callA, callB, callC]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a!.get(LT_A.toLowerCase())).toBeCloseTo(2);
  });

  it("returns null when BounceTech fails and there is no cached entry", async () => {
    // Cold-start outage — we have nothing to fall back to, so the route
    // gets a chance to surface 503 honestly instead of silently degrading.
    mockFetch.mockResolvedValueOnce(notOkResponse(503));

    const result = await fetchLiveLtRates();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it("returns null when BounceTech throws and there is no cached entry", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNRESET"));

    const result = await fetchLiveLtRates();

    expect(result).toBeNull();
  });

  it("returns the stale cached map when a refresh fails (fail-open)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    // Seed the cache with a successful first fetch.
    mockFetch.mockResolvedValueOnce(
      okJsonResponse(bounceLtResponseBody({ [LT_A]: "2000000000000000000" })),
    );
    const seeded = await fetchLiveLtRates();
    expect(seeded!.get(LT_A.toLowerCase())).toBeCloseTo(2);

    // Move past TTL so the next call attempts a refresh.
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));

    // BounceTech is down — non-2xx response. We must not collapse to
    // null; serving the stale rate is strictly better than 503'ing the
    // entire /market-data surface for every connected client.
    mockFetch.mockResolvedValueOnce(notOkResponse(503));
    const afterNonOk = await fetchLiveLtRates();
    expect(afterNonOk).not.toBeNull();
    expect(afterNonOk!.get(LT_A.toLowerCase())).toBeCloseTo(2);

    // Same fail-open behaviour for a thrown fetch (network blip / abort).
    mockFetch.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    const afterThrow = await fetchLiveLtRates();
    expect(afterThrow).not.toBeNull();
    expect(afterThrow!.get(LT_A.toLowerCase())).toBeCloseTo(2);

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("clears the in-flight lock when the fetch rejects so the next caller can retry", async () => {
    // Regression pin: if the `finally` that nulls `liveLtRatesInflight`
    // ever stops running on the throw path, every subsequent call would
    // forever resolve to the same failed Promise — a single network
    // blip would wedge the cache for the lifetime of the isolate.
    mockFetch.mockRejectedValueOnce(new Error("ECONNRESET"));
    const first = await fetchLiveLtRates();
    expect(first).toBeNull();

    mockFetch.mockResolvedValueOnce(
      okJsonResponse(bounceLtResponseBody({ [LT_A]: "1000000000000000000" })),
    );
    const second = await fetchLiveLtRates();
    expect(second).not.toBeNull();
    expect(second!.get(LT_A.toLowerCase())).toBeCloseTo(1);
  });
});

describe("_resetLiveLtRatesCache", () => {
  it("clears the cache so the next call hits the network again", async () => {
    mockFetch.mockResolvedValue(
      okJsonResponse(bounceLtResponseBody({ [LT_A]: "1000000000000000000" })),
    );

    await fetchLiveLtRates();
    await fetchLiveLtRates();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    _resetLiveLtRatesCache();
    await fetchLiveLtRates();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
