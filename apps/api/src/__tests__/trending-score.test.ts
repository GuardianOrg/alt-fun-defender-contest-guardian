import { describe, expect, it } from "vitest";

import { computeTrendingScore } from "../lib/token-enrich.js";

const NOW_SEC = 1_700_000_000;
const HOUR = 3600;
const DAY = 86_400;

/** Base inputs: 1-hour-old token, $1M mcap, $1k 24h volume, +10% change,
 *  traded 30 minutes ago. A "healthy trending candidate" we perturb around. */
function baseInputs() {
  return {
    change24h: 10,
    volume24hUsd: 1_000,
    mcapUsd: 1_000_000,
    createdAtSec: NOW_SEC - HOUR,
    lastTradeAtSec: NOW_SEC - 30 * 60,
    nowSec: NOW_SEC,
  };
}

describe("computeTrendingScore", () => {
  it("rewards tokens with higher 24h change when other signals are equal", () => {
    const low = computeTrendingScore({ ...baseInputs(), change24h: 5 });
    const high = computeTrendingScore({ ...baseInputs(), change24h: 50 });
    expect(high).toBeGreaterThan(low);
    // `change24h` is the primary signal so the delta should roughly match
    // the percent spread (other terms are held constant here).
    expect(high - low).toBeCloseTo(45, 5);
  });

  it("penalises negative 24h change", () => {
    const up = computeTrendingScore({ ...baseInputs(), change24h: 10 });
    const down = computeTrendingScore({ ...baseInputs(), change24h: -10 });
    expect(up).toBeGreaterThan(down);
  });

  it("rewards higher volume but log-dampens so whales don't dominate", () => {
    const small = computeTrendingScore({ ...baseInputs(), volume24hUsd: 1_000 });
    const medium = computeTrendingScore({ ...baseInputs(), volume24hUsd: 10_000 });
    const whale = computeTrendingScore({ ...baseInputs(), volume24hUsd: 1_000_000 });
    expect(medium).toBeGreaterThan(small);
    expect(whale).toBeGreaterThan(medium);
    // Each 10× volume jump adds ~15 points. A 1000× jump must not
    // add a 1000× spread.
    expect(whale - small).toBeLessThan(50);
  });

  it("gives a freshness bonus that decays linearly over the first 24h", () => {
    const newBorn = computeTrendingScore({
      ...baseInputs(),
      createdAtSec: NOW_SEC,
      lastTradeAtSec: NOW_SEC,
    });
    const twelveHours = computeTrendingScore({
      ...baseInputs(),
      createdAtSec: NOW_SEC - 12 * HOUR,
      lastTradeAtSec: NOW_SEC - 30 * 60,
    });
    const oneDay = computeTrendingScore({
      ...baseInputs(),
      createdAtSec: NOW_SEC - 24 * HOUR,
      lastTradeAtSec: NOW_SEC - 30 * 60,
    });
    // newBorn gets full +20 freshness + recency bonus; past 24h both are gone.
    expect(newBorn).toBeGreaterThan(twelveHours);
    expect(twelveHours).toBeGreaterThan(oneDay);
  });

  it("gives a recency bonus for trades within the last hour", () => {
    const justTraded = computeTrendingScore({
      ...baseInputs(),
      lastTradeAtSec: NOW_SEC - 10 * 60,
    });
    const fourHoursAgo = computeTrendingScore({
      ...baseInputs(),
      lastTradeAtSec: NOW_SEC - 4 * HOUR,
    });
    const yesterday = computeTrendingScore({
      ...baseInputs(),
      lastTradeAtSec: NOW_SEC - 23 * HOUR,
    });
    expect(justTraded - fourHoursAgo).toBeCloseTo(5, 5);
    expect(fourHoursAgo - yesterday).toBeCloseTo(5, 5);
  });

  it("applies a dead-token penalty to ancient quiet tokens", () => {
    const dead = computeTrendingScore({
      ...baseInputs(),
      createdAtSec: NOW_SEC - 30 * DAY,
      lastTradeAtSec: null,
    });
    const alive = computeTrendingScore({
      ...baseInputs(),
      createdAtSec: NOW_SEC - 30 * DAY,
      lastTradeAtSec: NOW_SEC - 2 * HOUR,
    });
    // Dead token should be demoted by ~1000 points relative to a same-aged
    // token that has recent activity.
    expect(alive - dead).toBeGreaterThan(900);
  });

  it("does NOT demote young tokens just because they haven't traded yet", () => {
    const freshQuiet = computeTrendingScore({
      ...baseInputs(),
      createdAtSec: NOW_SEC - 30 * 60,
      lastTradeAtSec: null,
      volume24hUsd: 0,
    });
    // Age < 7d branch of the dead-penalty guard should keep score above the
    // -1000 floor. Freshness bonus keeps it modestly positive.
    expect(freshQuiet).toBeGreaterThan(-100);
  });

  it("treats null market signals as zero (graceful degradation)", () => {
    const score = computeTrendingScore({
      change24h: null,
      volume24hUsd: null,
      mcapUsd: null,
      createdAtSec: NOW_SEC - 2 * HOUR,
      lastTradeAtSec: null,
      nowSec: NOW_SEC,
    });
    // Finite, sortable value — NOT NaN. Indexer/BounceTech blips must not
    // collapse the entire trending list.
    expect(Number.isFinite(score)).toBe(true);
  });

  it("adds a flat boost when isBoosted is set, without disturbing other components", () => {
    const plain = computeTrendingScore({ ...baseInputs() });
    const boosted = computeTrendingScore({ ...baseInputs(), isBoosted: true });
    expect(boosted - plain).toBeCloseTo(50, 5);
  });

  it("does not let the boost rescue a dead token", () => {
    // A boosted token still hit by the −1000 dead-token penalty must
    // remain deeply negative — boost is additive (+50), so the penalty
    // wins by ~950 points and the dead boosted token can't leapfrog
    // any active non-boosted token. This is the "stealth" property the
    // route relies on.
    const deadInputs = {
      ...baseInputs(),
      createdAtSec: NOW_SEC - 30 * DAY,
      lastTradeAtSec: null,
    };
    const deadPlain = computeTrendingScore(deadInputs);
    const deadBoosted = computeTrendingScore({ ...deadInputs, isBoosted: true });
    const liveQuiet = computeTrendingScore({
      ...baseInputs(),
      change24h: 0,
      volume24hUsd: 0,
    });
    // Boost only chips +50 off a −1000 penalty — the penalty still wins
    // by an order of magnitude.
    expect(deadBoosted - deadPlain).toBeCloseTo(50, 5);
    expect(deadBoosted).toBeLessThan(liveQuiet);
    // Still well into "buried" territory; the boost cannot lift the
    // token anywhere near zero.
    expect(deadBoosted).toBeLessThan(-800);
  });

  it("orders a realistic mix the way a human would", () => {
    // Mover: mid-aged, pumping, decent volume, active.
    const mover = computeTrendingScore({
      change24h: 80,
      volume24hUsd: 50_000,
      mcapUsd: 500_000,
      createdAtSec: NOW_SEC - 6 * HOUR,
      lastTradeAtSec: NOW_SEC - 5 * 60,
      nowSec: NOW_SEC,
    });
    // Ancient leader: big market cap but flat and quiet.
    const oldLeader = computeTrendingScore({
      change24h: 0,
      volume24hUsd: 0,
      mcapUsd: 10_000_000,
      createdAtSec: NOW_SEC - 60 * DAY,
      lastTradeAtSec: null,
      nowSec: NOW_SEC,
    });
    // Fresh launch with no data yet.
    const brandNew = computeTrendingScore({
      change24h: null,
      volume24hUsd: null,
      mcapUsd: null,
      createdAtSec: NOW_SEC - 10 * 60,
      lastTradeAtSec: null,
      nowSec: NOW_SEC,
    });
    // A real mover must beat an ancient quiet whale.
    expect(mover).toBeGreaterThan(oldLeader);
    // A just-launched token also beats the dead whale (freshness vs
    // dead-token penalty).
    expect(brandNew).toBeGreaterThan(oldLeader);
  });
});
