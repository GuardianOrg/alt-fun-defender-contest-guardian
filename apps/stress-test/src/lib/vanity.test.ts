import { hasVanitySuffix, predictTokenAddress } from "@launchpad/shared";
import { describe, expect, it } from "vitest";

import { mineVanitySalt, mineVanitySaltSync } from "./vanity.ts";

/**
 * The miner ships its own constant-folded inner loop instead of calling
 * `predictTokenAddress` per attempt — the loop body must match
 * `Bonding._mixSalt` byte-for-byte. This test is the canary: it mines a
 * salt, then verifies the produced address matches what the canonical
 * `predictTokenAddress` would compute for the same `(creator, name,
 * ticker, salt)` quartet AND ends in the requested vanity suffix.
 *
 * Uses `suffixOverride: "ff"` (2 hex chars) instead of the production
 * 5-char suffix. The 5-char suffix has a mean of ~1M attempts (~22s
 * wall-clock) and a long tail (p99 ~60s) — way too slow for CI. The
 * 2-char override is deterministic-fast (~256 attempts, sub-10ms) and
 * tests the same hash-construction agreement — drift in either side
 * reveals itself regardless of suffix length.
 *
 * Uses the sync variant (`mineVanitySaltSync`) so the test doesn't pay
 * the ~50ms worker-spawn overhead on every run, AND so a future change
 * to the worker plumbing can't silently break the test by making it
 * pass through a different code path than the one being tested
 * (`runMiningLoop`).
 */
describe("mineVanitySaltSync", () => {
  it("produces a salt whose predicted address matches the canonical helper and ends in the requested suffix", () => {
    const implementation = "0xe6A0C9D82471219C3520Cc8ec309A4b222c28cA3" as const;
    const bondingProxy = "0x1E75bB0570e4d1c4490417C0948A37e8d6809638" as const;
    const creator = "0x000000000000000000000000000000000000beef" as const;
    const name = "Test Token";
    const ticker = "TEST";
    const suffix = "ff";

    const mined = mineVanitySaltSync({
      implementation,
      bondingProxy,
      creator,
      name,
      ticker,
      suffixOverride: suffix,
    });

    expect(hasVanitySuffix(mined.address, suffix)).toBe(true);

    const canonical = predictTokenAddress(
      implementation,
      bondingProxy,
      creator,
      name,
      ticker,
      mined.salt,
    );
    expect(canonical).toBe(mined.address);
  });
});

/**
 * Smoke test for the production worker-thread path. We don't bother
 * re-asserting the hash agreement (the sync test above covers it
 * exhaustively) — this exists purely to catch breakage in the
 * `node:worker_threads` plumbing: worker spawn, `workerData` round-
 * trip, `parentPort.postMessage` shape, exit/error handling.
 *
 * Worker spawn is ~50ms so this test runs in ~100ms — fine for CI.
 */
describe("mineVanitySalt (worker thread)", () => {
  it("resolves the mine via a Worker without hanging or losing the result", async () => {
    const mined = await mineVanitySalt({
      implementation: "0xe6A0C9D82471219C3520Cc8ec309A4b222c28cA3" as const,
      bondingProxy: "0x1E75bB0570e4d1c4490417C0948A37e8d6809638" as const,
      creator: "0x000000000000000000000000000000000000beef" as const,
      name: "Worker Smoke",
      ticker: "WORK",
      suffixOverride: "ff",
    });
    expect(hasVanitySuffix(mined.address, "ff")).toBe(true);
    expect(mined.attempts).toBeGreaterThan(0);
  });
});
