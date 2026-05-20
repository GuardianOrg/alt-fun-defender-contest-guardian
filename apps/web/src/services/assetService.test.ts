import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeChange24h, formatPrice } from "./assetService";

describe("computeChange24h", () => {
  it("computes positive change", () => {
    expect(computeChange24h(100, 105)).toBe(5);
  });

  it("computes negative change", () => {
    expect(computeChange24h(100, 92)).toBe(-8);
  });

  it("returns 0 for no change", () => {
    expect(computeChange24h(100, 100)).toBe(0);
  });

  it("rounds to two decimals", () => {
    expect(computeChange24h(3, 3.1)).toBe(3.33);
  });

  it("returns undefined when open price is zero", () => {
    expect(computeChange24h(0, 100)).toBeUndefined();
  });

  it("returns undefined when open price is negative", () => {
    expect(computeChange24h(-5, 100)).toBeUndefined();
  });

  it("handles real Hyperliquid-style values", () => {
    const open = 40.848;
    const current = 43.092;
    const result = computeChange24h(open, current);
    expect(result).toBeTypeOf("number");
    expect(result).toBeGreaterThan(0);
    expect(result).toBeCloseTo(5.49, 1);
  });
});

describe("formatPrice", () => {
  it("formats large prices with comma separator", () => {
    expect(formatPrice(74105.5)).toBe("$74,106");
  });

  it("formats mid-range prices as whole numbers", () => {
    expect(formatPrice(321.5)).toBe("$322");
  });

  it("formats small prices with 2 decimals", () => {
    expect(formatPrice(43.09)).toBe("$43.09");
  });

  it("formats sub-dollar prices with 4 decimals", () => {
    expect(formatPrice(0.0042)).toBe("$0.0042");
  });
});

describe("liveAssetService.getAssets", () => {
  type FetchMock = ReturnType<typeof vi.fn>;
  let fetchMock: FetchMock;
  let originalFetch: typeof globalThis.fetch;

  function mockMidsResponse(): Response {
    return new Response(
      JSON.stringify({
        HYPE: "42",
        ETH: "3000",
        BTC: "60000",
        SOL: "150",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  function mockCandleResponse(): Response {
    return new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubEnv("VITE_API_URL", "https://api.test");
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the supported asset list with Hyperliquid mids", async () => {
    fetchMock.mockImplementation((url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("hyperliquid")) {
        return Promise.resolve(mockMidsResponse());
      }
      return Promise.resolve(mockCandleResponse());
    });

    const { assetService } = await import("./assetService");
    const assets = await assetService.getAssets();

    expect(assets.length).toBeGreaterThan(1);
    expect(assets.find((a) => a.name === "HYPE")?.priceUsd).toBe("$42.00");
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/api/v1/assets")),
    ).toBe(false);
  });

  it("returns the supported set with dash prices when Hyperliquid fails", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("network down")));

    const { assetService } = await import("./assetService");
    const assets = await assetService.getAssets();

    expect(assets.length).toBeGreaterThan(1);
    expect(assets.every((a) => a.priceUsd === "—")).toBe(true);
  });
});
