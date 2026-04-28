import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_GRADUATION_THRESHOLD_USD } from "@launchpad/shared";

import { computeCurveFilledBreakdown } from "../lib/token-enrich.js";
import {
  _resetGraduationThresholdCache,
  getGraduationThresholdUsd,
} from "../lib/protocol-config.js";

describe("computeCurveFilledBreakdown — graduation threshold argument", () => {
  // Pure-math sanity checks for the threshold parameter. The breakdown
  // routine has its own dedicated reserve-decoding tests elsewhere; this
  // file only asserts the threshold scales the percentages correctly.
  const baseArgs = {
    // Virtual reserve0 = TOTAL_SUPPLY - 750_000_000 sold so far (so curve is
    // ~50% full by supply). Sticking to the documented virtual-reserve math
    // — see lib/token-enrich.ts.
    curveSupply: (1_000_000_000n * 10n ** 18n).toString(), // virtual reserve0 == total supply (no real sold yet)
    ltReserve: (10_000n * 10n ** 18n).toString(), // 10K LT virtual
    k: ((1_000_000_000n * 10n ** 18n) * (4_000n * 10n ** 18n)).toString(), // virtualLtAtLaunch = 4K
    // → realLt = 10_000 - 4_000 = 6_000 LT
    organicUsdcRaisedRaw: (5_000n * 10n ** 6n).toString(), // $5K organic
    ltExchangeRate: 1, // $1/LT, so realUsd = 6_000
  };

  it("uses the supplied threshold as the denominator for usdFilled / organic", () => {
    const at12k = computeCurveFilledBreakdown(
      baseArgs.curveSupply,
      baseArgs.ltReserve,
      baseArgs.k,
      baseArgs.organicUsdcRaisedRaw,
      baseArgs.ltExchangeRate,
      false,
      12_000,
    );

    const at24k = computeCurveFilledBreakdown(
      baseArgs.curveSupply,
      baseArgs.ltReserve,
      baseArgs.k,
      baseArgs.organicUsdcRaisedRaw,
      baseArgs.ltExchangeRate,
      false,
      24_000,
    );

    // Threshold doubled → both buckets halve.
    expect(at24k.organic!).toBeCloseTo(at12k.organic! / 2, 6);
    expect(at24k.leverageBoost!).toBeCloseTo(at12k.leverageBoost! / 2, 6);
  });

  it("clamps organic to total at very low thresholds", () => {
    const tiny = computeCurveFilledBreakdown(
      baseArgs.curveSupply,
      baseArgs.ltReserve,
      baseArgs.k,
      baseArgs.organicUsdcRaisedRaw,
      baseArgs.ltExchangeRate,
      false,
      // Threshold lower than organic raised — would push organic past 100%
      // if unclamped. Implementation clamps to total so the UI bar stays
      // sensible.
      4_000,
    );

    expect(tiny.organic).toBeLessThanOrEqual(tiny.total!);
    expect(tiny.organic! + tiny.leverageBoost!).toBeLessThanOrEqual(
      tiny.total! + 1e-9,
    );
  });
});

describe("getGraduationThresholdUsd — fallback + caching", () => {
  beforeEach(() => {
    _resetGraduationThresholdCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetGraduationThresholdCache();
  });

  it("falls back to the compile-time default when the indexer is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const value = await getGraduationThresholdUsd("http://no-such-host:1");
    expect(value).toBe(DEFAULT_GRADUATION_THRESHOLD_USD);
  });

  it("falls back when the indexer responds with no row (fresh DB)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { protocolConfig: null } }), {
        status: 200,
      }),
    );

    const value = await getGraduationThresholdUsd("http://stub:1");
    expect(value).toBe(DEFAULT_GRADUATION_THRESHOLD_USD);
  });

  it("returns the live threshold when the indexer has a row", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            protocolConfig: {
              // 25_000 ether in 18-dp wei.
              graduationThresholdUsd: (25_000n * 10n ** 18n).toString(),
            },
          },
        }),
        { status: 200 },
      ),
    );

    const value = await getGraduationThresholdUsd("http://stub:1");
    expect(value).toBe(25_000);
  });

  it("caches the value across calls within the same isolate", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            protocolConfig: {
              graduationThresholdUsd: (12_000n * 10n ** 18n).toString(),
            },
          },
        }),
        { status: 200 },
      ),
    );

    await getGraduationThresholdUsd("http://stub:1");
    await getGraduationThresholdUsd("http://stub:1");
    await getGraduationThresholdUsd("http://stub:1");

    // Cache TTL is 60s; three back-to-back reads must hit the indexer once.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
