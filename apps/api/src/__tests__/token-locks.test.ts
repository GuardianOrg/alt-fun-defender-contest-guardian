import { describe, it, expect } from "vitest";

import {
  MIN_LOCK_DURATION_SECONDS,
  MIN_LOCK_PERCENT,
  summariseTokenLocks,
  type TokenLockRow,
} from "../lib/token-locks.js";

const ONE = 10n ** 18n;
/** 1% of the fixed 1B supply the percentages are measured against. */
const ONE_PERCENT = 10_000_000n * ONE;
const NOW = 1_787_671_521;
const TOKEN_A = "0x7f7430a1ad9a9b0e86849c332bf27facfd700000";
const TOKEN_B = "0xbbbb000000000000000000000000000000000002";

function lock(overrides: Partial<TokenLockRow> = {}): TokenLockRow {
  return {
    tokenAddress: TOKEN_A,
    depositAmount: (750_000_000n * ONE).toString(),
    // The real mainnet lock: 92 days out.
    cliffTime: String(NOW + 7_952_400),
    ...overrides,
  };
}

describe("summariseTokenLocks", () => {
  it("reports the full deposit as locked and the cliff as the unlock date", () => {
    // Mirrors the on-chain state of the first real lock: a 750M/1B pure
    // timelock, non-cancelable, cliff 92 days out, `streamedAmountOf` = 0.
    const [summary] = summariseTokenLocks([lock()], NOW);

    expect(summary).toEqual({
      tokenAddress: TOKEN_A,
      lockedAmount: (750_000_000n * ONE).toString(),
      lockedPercent: 75,
      unlocksAt: new Date((NOW + 7_952_400) * 1000).toISOString(),
    });
  });

  it("sums multiple locks on the same token and reports the latest cliff", () => {
    const early = NOW + MIN_LOCK_DURATION_SECONDS + 1_000;
    const late = NOW + MIN_LOCK_DURATION_SECONDS + 90_000;
    const [summary] = summariseTokenLocks(
      [
        lock({ depositAmount: (100_000_000n * ONE).toString(), cliffTime: String(early) }),
        lock({ depositAmount: (50_000_000n * ONE).toString(), cliffTime: String(late) }),
      ],
      NOW,
    );

    expect(summary.lockedAmount).toBe((150_000_000n * ONE).toString());
    expect(summary.lockedPercent).toBe(15);
    // "Unlocks" means "fully unlocked", so the last cliff wins.
    expect(summary.unlocksAt).toBe(new Date(late * 1000).toISOString());
  });

  it("groups by token", () => {
    const summaries = summariseTokenLocks(
      [
        lock({ depositAmount: (100_000_000n * ONE).toString() }),
        lock({
          tokenAddress: TOKEN_B,
          depositAmount: (250_000_000n * ONE).toString(),
        }),
      ],
      NOW,
    );

    expect(summaries).toHaveLength(2);
    const byToken = new Map(summaries.map((s) => [s.tokenAddress, s]));
    expect(byToken.get(TOKEN_A)!.lockedPercent).toBe(10);
    expect(byToken.get(TOKEN_B)!.lockedPercent).toBe(25);
  });

  it("lowercases the token address so clients can index by it directly", () => {
    const [summary] = summariseTokenLocks(
      [lock({ tokenAddress: "0x7F7430A1AD9A9B0E86849C332BF27FACFD700000" })],
      NOW,
    );
    expect(summary.tokenAddress).toBe(TOKEN_A);
  });

  it("drops a lock whose cliff is inside the minimum-duration window", () => {
    // A lock with six days to run is about to release; badging it would
    // make the signal trivially cheap to fake.
    const summaries = summariseTokenLocks(
      [lock({ cliffTime: String(NOW + MIN_LOCK_DURATION_SECONDS - 1) })],
      NOW,
    );
    expect(summaries).toEqual([]);
  });

  it("keeps a lock exactly one second past the minimum-duration window", () => {
    const summaries = summariseTokenLocks(
      [lock({ cliffTime: String(NOW + MIN_LOCK_DURATION_SECONDS + 1) })],
      NOW,
    );
    expect(summaries).toHaveLength(1);
  });

  it("drops a lock whose cliff has already passed", () => {
    const summaries = summariseTokenLocks(
      [lock({ cliffTime: String(NOW - 1) })],
      NOW,
    );
    expect(summaries).toEqual([]);
  });

  it("omits a token entirely when none of its locks qualify", () => {
    const summaries = summariseTokenLocks(
      [
        lock({ cliffTime: String(NOW - 1) }),
        lock({ tokenAddress: TOKEN_B, cliffTime: String(NOW + 60) }),
      ],
      NOW,
    );
    // Absent, not zero — clients treat a missing entry as "no lock".
    expect(summaries).toEqual([]);
  });

  it("ignores expired locks when summing a token that also has live ones", () => {
    const [summary] = summariseTokenLocks(
      [
        lock({
          depositAmount: (400_000_000n * ONE).toString(),
          cliffTime: String(NOW - 1),
        }),
        lock({ depositAmount: (200_000_000n * ONE).toString() }),
      ],
      NOW,
    );
    expect(summary.lockedPercent).toBe(20);
  });

  it("skips rows with malformed numerics rather than throwing", () => {
    const summaries = summariseTokenLocks(
      [
        lock({ depositAmount: "not-a-number" }),
        lock({ tokenAddress: TOKEN_B, cliffTime: "not-a-number" }),
        lock({ depositAmount: (120_000_000n * ONE).toString() }),
      ],
      NOW,
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0].tokenAddress).toBe(TOKEN_A);
    expect(summaries[0].lockedPercent).toBe(12);
  });

  it("skips zero-deposit rows", () => {
    expect(summariseTokenLocks([lock({ depositAmount: "0" })], NOW)).toEqual([]);
  });

  it("clamps the percentage at 100", () => {
    // Unreachable while `Bonding` mints exactly 1B, but a badge reading
    // ">100% locked" is the loudest possible "this number is broken".
    const [summary] = summariseTokenLocks(
      [lock({ depositAmount: (2_000_000_000n * ONE).toString() })],
      NOW,
    );
    expect(summary.lockedPercent).toBe(100);
  });

  it("reports percentages against the 1B initial supply, matching the holders table", () => {
    // Deliberately not live `totalSupply()`, which drops at graduation. See
    // the denominator note in `token-locks.ts` — the holders route divides
    // by 1B too, and the two numbers appear side by side on the token page.
    // 125M reads 12.5% against 1B and 13.3% against the 937.5M a token that
    // burned 62.5M at graduation would report, so this pins the denominator.
    const [summary] = summariseTokenLocks(
      [lock({ depositAmount: (125_000_000n * ONE).toString() })],
      NOW,
    );
    expect(summary.lockedPercent).toBe(12.5);
  });

  it("drops a token locking less than the minimum share of supply", () => {
    // Nobody has to be the creator to lock a token, so without this floor a
    // dust escrow would hang a LOCKED pill on any launch for the price of gas.
    const summaries = summariseTokenLocks(
      [lock({ depositAmount: (1_000_000n * ONE).toString() })],
      NOW,
    );
    expect(summaries).toEqual([]);
  });

  it("keeps a token locking exactly the minimum share of supply", () => {
    const atFloor = BigInt(MIN_LOCK_PERCENT) * ONE_PERCENT;
    const [summary] = summariseTokenLocks(
      [lock({ depositAmount: atFloor.toString() })],
      NOW,
    );
    expect(summary.lockedPercent).toBe(MIN_LOCK_PERCENT);
  });

  it("applies the supply floor to the per-token total, not to each lock", () => {
    // Two locks that individually fall under the floor but together clear it
    // are a real lock, so the floor has to run after the per-token sum. This
    // is also why it can't become a SQL predicate on `deposit_amount`.
    const belowFloorEach = (60_000_000n * ONE).toString();
    const [summary] = summariseTokenLocks(
      [
        lock({ depositAmount: belowFloorEach }),
        lock({ depositAmount: belowFloorEach }),
      ],
      NOW,
    );
    expect(summary.lockedPercent).toBe(12);
  });
});
