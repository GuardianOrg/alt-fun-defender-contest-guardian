import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_GRADUATION_THRESHOLD_USD } from "@launchpad/shared";

import { computeCurveFilledBreakdown } from "../lib/token-enrich.js";
import {
  _resetGraduationThresholdCache,
  getGraduationThresholdUsd,
} from "../lib/protocol-config.js";

import type { AppBindings } from "../lib/types.js";

// Stub `env` shape passed to `getGraduationThresholdUsd`. The function only
// reads `HYPEREVM_RPC_URL`; everything else is irrelevant for these tests
// but TS still wants the full shape to compile.
const stubEnv = {
  HYPEREVM_RPC_URL: "http://stub-rpc:1",
} as unknown as AppBindings;

// --- Viem mock ---
//
// `getGraduationThresholdUsd` calls `client.readContract({ ..., functionName:
// "graduationThresholdUsd" })`. Mocking at the viem boundary keeps the cache
// + fallback logic exercised without depending on viem's JSON-RPC wire
// format (which can include `eth_chainId` probes alongside the `eth_call`,
// making raw-fetch mocks brittle across viem versions).
const mockReadContract = vi.fn();
vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: () => ({ readContract: mockReadContract }),
  };
});

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
    mockReadContract.mockReset();
  });

  afterEach(() => {
    _resetGraduationThresholdCache();
  });

  it("falls back to the compile-time default when the RPC is unreachable", async () => {
    mockReadContract.mockRejectedValue(new Error("ECONNREFUSED"));

    const value = await getGraduationThresholdUsd(stubEnv);
    expect(value).toBe(DEFAULT_GRADUATION_THRESHOLD_USD);
  });

  it("returns the live threshold when the RPC responds", async () => {
    // `readContract` returns the decoded `uint256` (18-dp wei), not raw
    // calldata. `getGraduationThresholdUsd` divides by 10^18.
    mockReadContract.mockResolvedValue(25_000n * 10n ** 18n);

    const value = await getGraduationThresholdUsd(stubEnv);
    expect(value).toBe(25_000);
  });

  it("caches the value across calls within the same isolate", async () => {
    mockReadContract.mockResolvedValue(12_000n * 10n ** 18n);

    await getGraduationThresholdUsd(stubEnv);
    await getGraduationThresholdUsd(stubEnv);
    await getGraduationThresholdUsd(stubEnv);

    // Cache TTL is 60s; three back-to-back reads must hit the contract
    // exactly once.
    expect(mockReadContract).toHaveBeenCalledTimes(1);
  });
});
