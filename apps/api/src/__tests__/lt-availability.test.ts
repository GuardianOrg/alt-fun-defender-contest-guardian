import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveLeveragedToken } from "@launchpad/shared";

// Mock the `lt_directory` mirror reader so the default-fetcher tests
// below can pin the DB-backed code path without standing up Drizzle.
const mockReadSupportedLtDirectory = vi.fn<
  (databaseUrl: string) => Promise<LiveLeveragedToken[] | null>
>();
vi.mock("../lib/lt-directory-reads.js", () => ({
  readLtDirectory: vi.fn(),
  readSupportedLtDirectory: mockReadSupportedLtDirectory,
  readLiveLtRates: vi.fn(),
  readLtByAddress: vi.fn(),
  readDirectoryLastUpdatedAt: vi.fn(),
}));

const {
  _resetLtAvailabilityCache,
  getCachedLtAvailability,
  getLiveLtAvailability,
  refreshLiveLtAvailability,
} = await import("../lib/lt-availability.js");

function makeLT(overrides: Partial<LiveLeveragedToken>): LiveLeveragedToken {
  return {
    address: "0x0000000000000000000000000000000000000000",
    symbol: "HYPE2L",
    name: "HYPE 2x Long",
    targetAsset: "HYPE",
    targetLeverage: 2,
    isLong: true,
    decimals: 18,
    mintPaused: false,
    exchangeRate: "1000000000000000000",
    totalSupply: "0",
    totalAssets: "0",
    baseAssetBalance: "0",
    ...overrides,
  };
}

beforeEach(() => {
  mockReadSupportedLtDirectory.mockReset();
});

afterEach(() => {
  _resetLtAvailabilityCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("getLiveLtAvailability", () => {
  it("filters to LTs whose BounceTech UI logo HEAD-check succeeds", async () => {
    const directory: LiveLeveragedToken[] = [
      makeLT({
        address: "0xaaaa000000000000000000000000000000000001",
        symbol: "HYPE5L",
        targetAsset: "HYPE",
        targetLeverage: 5,
        isLong: true,
      }),
      makeLT({
        address: "0xbbbb000000000000000000000000000000000002",
        symbol: "DOGE3L",
        targetAsset: "DOGE",
        targetLeverage: 3,
        isLong: true,
      }),
    ];

    const result = await getLiveLtAvailability({
      fetchSupportedLts: async () => directory,
      checkSymbolLive: async (symbol) => symbol === "HYPE5L",
    });

    // Only HYPE5L's HEAD returned ok — DOGE3L is filtered out.
    expect(result.liveSymbols.has("HYPE5L")).toBe(true);
    expect(result.liveSymbols.has("DOGE3L")).toBe(false);
    expect(
      result.liveAddresses.has(
        "0xaaaa000000000000000000000000000000000001",
      ),
    ).toBe(true);
    expect(
      result.liveAddresses.has(
        "0xbbbb000000000000000000000000000000000002",
      ),
    ).toBe(false);
    expect(result.liveUnderlyings.has("HYPE")).toBe(true);
    expect(result.liveUnderlyings.has("DOGE")).toBe(false);
    expect(result.fresh).toBe(true);
  });

  it("treats non-2xx (except clean 404) HEAD responses as live (fail-open)", async () => {
    // Pins the real-HTTP fail-open path in `defaultSymbolChecker`: a 503
    // (CDN edge wobble), a 429 (rate limit), or a 403 (auth misconfig)
    // should never hide an LT. Only a clean 404 — BounceTech truly hasn't
    // published the logo — flips the LT to hidden.
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() === "HEAD") {
        return new Response(null, { status: 503 });
      }
      throw new Error("Unexpected fetch path");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLiveLtAvailability({
      fetchSupportedLts: async () => [
        makeLT({
          address: "0xaaaa0000000000000000000000000000000000aa",
          symbol: "HYPE5L",
          targetAsset: "HYPE",
          targetLeverage: 5,
          isLong: true,
        }),
      ],
    });

    expect(result.liveSymbols.has("HYPE5L")).toBe(true);
    expect(result.liveUnderlyings.has("HYPE")).toBe(true);
  });

  it("treats a clean 404 HEAD response as not-live", async () => {
    // The one definitive "BounceTech hasn't published this LT yet"
    // signal — every other non-2xx is fail-open (see the test above).
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() === "HEAD") {
        return new Response(null, { status: 404 });
      }
      throw new Error("Unexpected fetch path");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLiveLtAvailability({
      fetchSupportedLts: async () => [
        makeLT({
          address: "0xbbbb0000000000000000000000000000000000bb",
          symbol: "INTERNAL2L",
          targetAsset: "HYPE",
          targetLeverage: 2,
          isLong: true,
        }),
      ],
    });

    expect(result.liveSymbols.has("INTERNAL2L")).toBe(false);
    // The LT is still in BounceTech's directory — the listing path keys
    // off `directoryAddresses`, NOT `liveAddresses`, so the missing logo
    // can't hide a creator-launched token from /tokens. See
    // `CacheSnapshot.directoryAddresses` JSDoc.
    expect(
      result.directoryAddresses.has(
        "0xbbbb0000000000000000000000000000000000bb",
      ),
    ).toBe(true);
  });

  it("treats a 200 with `text/html` (SPA shell fallback) as not-live", async () => {
    // bounce.tech is a SPA that returns its HTML shell with HTTP 200
    // for every URL that doesn't match a real static asset, including
    // `/leveraged-tokens/<not-yet-published>.png`. Without inspecting
    // the response `Content-Type`, the live filter is permanently
    // no-op'd because every HEAD comes back 200. This test pins the
    // SPA-shell rejection so a regression here can't silently re-open
    // the filter to every unsupported LT.
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      throw new Error("Unexpected fetch path");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLiveLtAvailability({
      fetchSupportedLts: async () => [
        makeLT({
          address: "0xcccc0000000000000000000000000000000000cc",
          symbol: "BRENTOIL2L",
          targetAsset: "xyz:BRENTOIL",
          targetLeverage: 2,
          isLong: true,
        }),
      ],
    });

    expect(result.liveSymbols.has("BRENTOIL2L")).toBe(false);
    expect(result.liveUnderlyings.has("xyz:BRENTOIL")).toBe(false);
    // Same regression pin as the 404 case: a SPA-shell fallback means the
    // logo PNG isn't published yet, but BounceTech still has the LT in
    // their directory — so it stays in `directoryAddresses`, and the
    // token listing path keeps the creator-launched token visible.
    expect(
      result.directoryAddresses.has(
        "0xcccc0000000000000000000000000000000000cc",
      ),
    ).toBe(true);
  });

  it("treats a 200 with an `image/*` Content-Type as live", async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      throw new Error("Unexpected fetch path");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLiveLtAvailability({
      fetchSupportedLts: async () => [
        makeLT({
          address: "0xdddd0000000000000000000000000000000000dd",
          symbol: "HYPE2L",
          targetAsset: "HYPE",
          targetLeverage: 2,
          isLong: true,
        }),
      ],
    });

    expect(result.liveSymbols.has("HYPE2L")).toBe(true);
    expect(result.liveUnderlyings.has("HYPE")).toBe(true);
  });

  it("sends `Cache-Control: no-cache` on every HEAD probe to bypass Fastly", async () => {
    // bounce.tech is fronted by Fastly with `cache-control: max-age=14400`
    // on `/leveraged-tokens/<symbol>.png`. A POP that cached the SPA HTML
    // shell *before* an upload will keep serving it for ~4h, and because
    // Cloudflare Worker egress isn't sticky to one Fastly POP, this would
    // hide a token for an indeterminate window after BounceTech publishes
    // the real logo. We pin `Cache-Control: no-cache` (and `Pragma` for
    // older intermediaries that still honour it) on every probe so the
    // cron's 1-minute cadence is the upper bound on staleness instead of
    // Fastly's TTL. If a regression strips these headers, the live filter
    // silently grows hours of stickiness — pin it here so that change has
    // to be explicit.
    const seenHeaders: Headers[] = [];
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() === "HEAD") {
        seenHeaders.push(new Headers(init?.headers));
        return new Response(null, {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      throw new Error("Unexpected fetch path");
    });
    vi.stubGlobal("fetch", fetchMock);

    await getLiveLtAvailability({
      fetchSupportedLts: async () => [
        makeLT({
          address: "0xeeee0000000000000000000000000000000000ee",
          symbol: "HYPE2L",
          targetAsset: "HYPE",
          targetLeverage: 2,
          isLong: true,
        }),
      ],
    });

    expect(seenHeaders.length).toBe(1);
    const headers = seenHeaders[0]!;
    expect(headers.get("cache-control")?.toLowerCase()).toContain("no-cache");
    expect(headers.get("pragma")?.toLowerCase()).toContain("no-cache");
  });

  it("treats LTs as live when the HEAD checker throws (fail-open)", async () => {
    // Failure-mode rationale lives on the module — a transient CDN error
    // should never flip a previously-live LT to hidden, so the checker
    // throwing is treated as "live".
    const directory: LiveLeveragedToken[] = [
      makeLT({
        address: "0xaaaa000000000000000000000000000000000003",
        symbol: "BTC5L",
        targetAsset: "BTC",
        targetLeverage: 5,
        isLong: true,
      }),
    ];
    const result = await getLiveLtAvailability({
      fetchSupportedLts: async () => directory,
      checkSymbolLive: async () => {
        throw new Error("ECONNRESET");
      },
    });

    expect(result.liveSymbols.has("BTC5L")).toBe(true);
    expect(result.liveUnderlyings.has("BTC")).toBe(true);
  });

  it("dedupes concurrent refreshes via the in-flight lock", async () => {
    let directoryCalls = 0;
    let resolveDirectory!: (lts: LiveLeveragedToken[]) => void;
    const directoryPromise = new Promise<LiveLeveragedToken[]>((resolve) => {
      resolveDirectory = resolve;
    });

    const fetchSupportedLts = vi.fn(async () => {
      directoryCalls++;
      return directoryPromise;
    });
    const checkSymbolLive = vi.fn(async () => true);

    // Three concurrent callers (e.g. three handlers in one isolate racing
    // to populate the cache on cold start) should share one underlying
    // directory fetch + HEAD-check sweep.
    const inFlightA = getLiveLtAvailability({ fetchSupportedLts, checkSymbolLive });
    const inFlightB = getLiveLtAvailability({ fetchSupportedLts, checkSymbolLive });
    const inFlightC = getLiveLtAvailability({ fetchSupportedLts, checkSymbolLive });

    // Resolve the directory fetch and wait for everyone.
    resolveDirectory([
      makeLT({
        address: "0xcccc000000000000000000000000000000000004",
        symbol: "ETH3L",
        targetAsset: "ETH",
        targetLeverage: 3,
        isLong: true,
      }),
    ]);
    const results = await Promise.all([inFlightA, inFlightB, inFlightC]);

    expect(directoryCalls).toBe(1);
    expect(checkSymbolLive).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r.liveSymbols.has("ETH3L")).toBe(true);
    }
  });

  it("returns the previous cache after a failed refresh (no clobber)", async () => {
    // Seed the cache with a successful first sweep.
    await getLiveLtAvailability({
      fetchSupportedLts: async () => [
        makeLT({
          address: "0xeeee000000000000000000000000000000000005",
          symbol: "SOL2L",
          targetAsset: "SOL",
          targetLeverage: 2,
          isLong: true,
        }),
      ],
      checkSymbolLive: async () => true,
    });
    const before = getCachedLtAvailability();
    expect(before.liveSymbols.has("SOL2L")).toBe(true);

    // A subsequent refresh with an empty directory (BounceTech indexing API
    // down / returning `data: undefined`) must NOT clobber the cache.
    const after = await refreshLiveLtAvailability({
      fetchSupportedLts: async () => [],
      checkSymbolLive: async () => true,
    });
    expect(after.liveSymbols.has("SOL2L")).toBe(true);
    expect(after.liveAddresses.size).toBe(1);
  });

  it("rebuilds when forced past the TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    const directoryV1 = [
      makeLT({
        address: "0x1111000000000000000000000000000000000006",
        symbol: "BTC2L",
        targetAsset: "BTC",
        targetLeverage: 2,
        isLong: true,
      }),
    ];
    const r1 = await getLiveLtAvailability({
      fetchSupportedLts: async () => directoryV1,
      checkSymbolLive: async () => true,
    });
    expect(r1.liveSymbols.has("BTC2L")).toBe(true);

    // Move past TTL — next call should rebuild from a fresh directory.
    vi.setSystemTime(new Date("2024-01-01T00:10:00Z"));

    const directoryV2 = [
      makeLT({
        address: "0x2222000000000000000000000000000000000007",
        symbol: "ETH5L",
        targetAsset: "ETH",
        targetLeverage: 5,
        isLong: true,
      }),
    ];
    const r2 = await getLiveLtAvailability({
      fetchSupportedLts: async () => directoryV2,
      checkSymbolLive: async () => true,
    });
    expect(r2.liveSymbols.has("ETH5L")).toBe(true);
    expect(r2.liveSymbols.has("BTC2L")).toBe(false);
  });
});

describe("getCachedLtAvailability", () => {
  it("returns an empty, non-fresh snapshot when no refresh has run yet", () => {
    const snap = getCachedLtAvailability();
    expect(snap.fresh).toBe(false);
    expect(snap.liveSymbols.size).toBe(0);
    expect(snap.liveAddresses.size).toBe(0);
    expect(snap.liveUnderlyings.size).toBe(0);
    expect(snap.directoryAddresses.size).toBe(0);
  });

  it("returns a stale snapshot (fresh: false) once the TTL elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    await getLiveLtAvailability({
      fetchSupportedLts: async () => [
        makeLT({
          address: "0x3333000000000000000000000000000000000008",
          symbol: "DOGE5L",
          targetAsset: "DOGE",
          targetLeverage: 5,
          isLong: true,
        }),
      ],
      checkSymbolLive: async () => true,
    });
    expect(getCachedLtAvailability().fresh).toBe(true);

    vi.setSystemTime(new Date("2024-01-01T00:10:00Z"));
    const stale = getCachedLtAvailability();
    expect(stale.fresh).toBe(false);
    // ...but the data we have is still surfaced so callers can keep
    // filtering rather than degrading to "show everything".
    expect(stale.liveSymbols.has("DOGE5L")).toBe(true);
  });
});

describe("refreshLiveLtAvailability", () => {
  it("never throws, even when the directory fetch rejects", async () => {
    const result = await refreshLiveLtAvailability({
      fetchSupportedLts: async () => {
        throw new Error("BounceTech indexing API down");
      },
    });
    // Falls back to the empty cache snapshot — fresh: false signals to
    // route handlers that they should fail-open (not filter).
    expect(result.fresh).toBe(false);
    expect(result.liveSymbols.size).toBe(0);
  });
});

describe("default directory fetcher (lt_directory mirror)", () => {
  it("reads from `readSupportedLtDirectory` when no override is supplied", async () => {
    mockReadSupportedLtDirectory.mockResolvedValueOnce([
      makeLT({
        address: "0xffff000000000000000000000000000000000010",
        symbol: "MIRROR2L",
        targetAsset: "HYPE",
        targetLeverage: 2,
        isLong: true,
      }),
    ]);

    const result = await getLiveLtAvailability({
      databaseUrl: "postgres://test",
      checkSymbolLive: async () => true,
    });

    expect(mockReadSupportedLtDirectory).toHaveBeenCalledTimes(1);
    expect(mockReadSupportedLtDirectory).toHaveBeenCalledWith("postgres://test");
    expect(result.liveSymbols.has("MIRROR2L")).toBe(true);
  });

  it("throws when the mirror is degraded (read returns null) so caller fails open", async () => {
    mockReadSupportedLtDirectory.mockResolvedValueOnce(null);

    // `refreshLiveLtAvailability` swallows the throw and falls back to
    // the cached snapshot (empty here) — `fresh: false` is the signal
    // route handlers use to fail open.
    const result = await refreshLiveLtAvailability({
      databaseUrl: "postgres://test",
    });
    expect(result.fresh).toBe(false);
    expect(result.liveSymbols.size).toBe(0);
  });

  it("throws when neither `databaseUrl` nor `fetchSupportedLts` is provided", async () => {
    // Programmer error — every production call site has
    // `c.env.DATABASE_URL` available; tests either pass it explicitly
    // or override `fetchSupportedLts`.
    await expect(getLiveLtAvailability()).rejects.toThrow(/databaseUrl/);
  });

  it("does NOT cache an empty mirror snapshot as fresh on first boot", async () => {
    // Regression pin: an empty `lt_directory` mirror (cold start, poller
    // hasn't backfilled yet) used to be stored in the module cache with
    // `expiresAt: Date.now() + CACHE_TTL_MS` and served as "fresh: true"
    // for the next 5 minutes — masking the poller backfill. The fix
    // returns a transient empty snapshot WITHOUT writing it to the
    // module cache so the very next call re-attempts the refresh.
    const fetchSupportedLts = vi
      .fn<() => Promise<LiveLeveragedToken[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeLT({
          address: "0xffff000000000000000000000000000000000020",
          symbol: "LATE2L",
          targetAsset: "HYPE",
          targetLeverage: 2,
          isLong: true,
        }),
      ]);

    const first = await getLiveLtAvailability({
      fetchSupportedLts,
      checkSymbolLive: async () => true,
    });
    expect(first.liveSymbols.size).toBe(0);
    // The cached view must also reflect "no fresh snapshot yet" so
    // route handlers fail open instead of filtering everything out.
    expect(getCachedLtAvailability().fresh).toBe(false);

    // Second call (e.g. ~30s later when the poller has backfilled) must
    // re-attempt the refresh, not serve the stored empty snapshot.
    const second = await getLiveLtAvailability({
      fetchSupportedLts,
      checkSymbolLive: async () => true,
    });
    expect(fetchSupportedLts).toHaveBeenCalledTimes(2);
    expect(second.liveSymbols.has("LATE2L")).toBe(true);
  });
});
