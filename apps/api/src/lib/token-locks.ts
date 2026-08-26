/**
 * Total initial supply (1B × 1e18). Deliberately the *initial* supply and not
 * `totalSupply()`, which drops at graduation as unsold curve tokens and
 * excess LP reserve get burned.
 *
 * Using live supply would make `lockedPercent` disagree with the `% Supply`
 * column in the holders table for the very same balance — `routes/holders.ts`
 * and `routes/security-v2.ts` both divide by 1B — and a token page showing
 * "80% locked" beside a holder row reading "75%" is a worse failure than a
 * uniformly conservative denominator. Moving all three to live supply is a
 * single follow-up; splitting them here is not an option.
 */
const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;

/**
 * How much runway a lock needs before it counts as a signal. A lock expiring
 * tomorrow tells a buyer nothing useful, and letting one earn a badge would
 * make the badge trivially cheap to fake.
 */
export const MIN_LOCK_DURATION_SECONDS = 7 * 24 * 60 * 60;

/**
 * How much of the supply a lock has to cover before it counts as a signal.
 *
 * Without a floor the badge is free to mint: nobody has to be the creator to
 * lock a token, so anyone holding dust of any token could escrow it for eight
 * days and hang a `LOCKED` pill on someone else's launch for the price of
 * gas. At 10% the vector inverts — an attacker has to buy and give up 100M
 * tokens for over a week, which is a favour to the token, not an attack.
 *
 * Applied to the **per-token total**, not to individual streams: two 6%
 * locks are a 12% lock. That's also why it can't be pushed into
 * `fetchActiveTokenLocks`'s SQL as a `deposit_amount` predicate — filtering
 * per row would drop both halves.
 */
export const MIN_LOCK_PERCENT = 10;

/** A row of `ponder_views.token_lock`, as Drizzle returns it (numerics → strings). */
export interface TokenLockRow {
  tokenAddress: string;
  depositAmount: string;
  cliffTime: string;
}

export interface TokenLockSummary {
  tokenAddress: string;
  /** Locked tokens, 18dp raw. Sum of every qualifying stream's deposit. */
  lockedAmount: string;
  /** Share of the 1B initial supply, 0–100, two decimal places. */
  lockedPercent: number;
  /**
   * ISO timestamp of the **latest** cliff across the token's locks — the date
   * by which all of `lockedAmount` is released.
   *
   * Not "the date `lockedAmount` unlocks": a token with several locks at
   * different cliffs releases them progressively, so only part of the total
   * survives to this date. Consumers must phrase it as an upper bound
   * ("fully released by") rather than a duration for the whole amount.
   */
  unlocksAt: string;
}

/**
 * Fold `token_lock` rows into one summary per token.
 *
 * Rows arrive pre-qualified in two senses: the indexer only writes
 * non-cancelable pure timelocks, so the entire deposit is unsellable right up
 * to `cliffTime`; and every row is a deposit that has not yet reached that
 * cliff. Summing `depositAmount` is therefore the exact locked balance, not
 * an approximation of a vesting curve.
 *
 * The `cliffTime` cutoff is re-applied here rather than trusted from the
 * caller's SQL. The SQL predicate exists to keep the scan small; this one is
 * what defines the rule, so the function is meaningful (and testable) on any
 * input.
 *
 * A token whose qualifying locks add up to less than `MIN_LOCK_PERCENT` is
 * omitted entirely rather than reported at its real share — callers read an
 * absent entry as "no lock", which is the claim we want to make.
 *
 * No cross-check against the escrow's live `token_balance`: a pre-cliff pure
 * timelock cannot pay anything out, so the sum can only exceed the real
 * balance if `Bonding` burned tokens straight out of the escrow, and it only
 * ever burns from the curve pair and its own LP reserve.
 */
export function summariseTokenLocks(
  rows: TokenLockRow[],
  nowSec: number,
): TokenLockSummary[] {
  const cutoff = BigInt(nowSec + MIN_LOCK_DURATION_SECONDS);
  const byToken = new Map<string, { locked: bigint; unlocksAt: bigint }>();

  for (const row of rows) {
    let deposit: bigint;
    let cliffTime: bigint;
    try {
      deposit = BigInt(row.depositAmount);
      cliffTime = BigInt(row.cliffTime);
    } catch {
      // A non-numeric numeric means the indexer wrote something we can't
      // read. Skip the row rather than 500 the whole response — same
      // posture as the holders route (issue #421).
      continue;
    }
    if (deposit <= 0n) continue;
    if (cliffTime <= cutoff) continue;

    const key = row.tokenAddress.toLowerCase();
    const existing = byToken.get(key);
    if (existing) {
      existing.locked += deposit;
      if (cliffTime > existing.unlocksAt) existing.unlocksAt = cliffTime;
    } else {
      byToken.set(key, { locked: deposit, unlocksAt: cliffTime });
    }
  }

  const summaries: TokenLockSummary[] = [];
  for (const [tokenAddress, agg] of byToken) {
    // Clamped at 100: a badge reading ">100% locked" is the loudest
    // possible "this number is broken", and the clamp costs nothing.
    const lockedPercent = Math.min(
      Number((agg.locked * 10000n) / TOTAL_SUPPLY) / 100,
      100,
    );
    if (lockedPercent < MIN_LOCK_PERCENT) continue;
    summaries.push({
      tokenAddress,
      lockedAmount: agg.locked.toString(),
      lockedPercent,
      unlocksAt: new Date(Number(agg.unlocksAt) * 1000).toISOString(),
    });
  }
  return summaries;
}
