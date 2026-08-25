import { ponder } from "ponder:registry";

import { token, tokenLock } from "ponder:schema";

/**
 * Sablier Lockup v4.0 stream creations — the mechanism creators use to lock
 * a token's supply.
 *
 * We record a stream only when it is a **pure timelock**: no tokens move
 * until a single cliff, at which point the entire deposit unlocks. Three
 * conditions define that shape, and each maps onto a branch of Sablier's own
 * `LockupMath.calculateStreamedAmountLL`:
 *
 *   - `unlockAmounts.start === 0` — nothing is released at `startTime`.
 *   - `unlockAmounts.cliff === depositAmount` — everything is released at the
 *     cliff, so the linear tail after it is empty.
 *   - `cliffTime !== 0` — a stream with `unlockAmounts.cliff === deposit` and
 *     *no* cliff vests instantly (the `unlockAmountsSum >= depositedAmount`
 *     short-circuit fires on the first read), so this check is what separates
 *     a real lock from a no-op one.
 *
 * For that shape the streamed amount is provably `0` before `cliffTime` and
 * `depositAmount` from `cliffTime` onward, which is why this table stores no
 * vesting parameters and the API needs no vesting math.
 *
 * Cancelable streams are rejected outright: `cancel()` refunds the unvested
 * balance to the sender, so a cancelable stream gives holders no protection
 * at all — the creator can take the supply back whenever they like. Excluding
 * them is also what makes the table append-only, since a non-cancelable
 * stream has no path that returns tokens early.
 *
 * Genuine vesting schedules (linear, tranched, dynamic, price-gated) are not
 * recorded. They unlock continuously, which is not the claim a "locked"
 * signal makes, and counting them would need the full vesting curve. The
 * failure direction throughout is "no lock recorded", never "lock
 * overstated".
 *
 * Guard order matters. `commonParams` is not an indexed event arg, so we
 * cannot filter by token in the log query — **every** Sablier linear stream
 * on HyperEVM, for every unrelated project, reaches this handler. The
 * shape/cancelable checks are free and run first so foreign streams cost
 * zero database round-trips; only a stream that would actually qualify pays
 * for the `token` lookup.
 */
ponder.on(
  "SablierLockup:CreateLockupLinearStream",
  async ({ event, context }) => {
    const { commonParams, cliffTime, unlockAmounts } = event.args;

    // `uint40` decodes as a JS number; normalise before comparing so the
    // handler is indifferent to viem's width-dependent mapping.
    const cliffTimeSec = BigInt(cliffTime);
    if (cliffTimeSec === 0n) return;
    if (unlockAmounts.start !== 0n) return;
    if (unlockAmounts.cliff !== commonParams.depositAmount) return;
    if (commonParams.cancelable) return;

    const { db } = context;
    const tokenRow = await db.find(token, { address: commonParams.token });
    if (!tokenRow) return;

    const lockup = event.log.address.toLowerCase();
    await db
      .insert(tokenLock)
      .values({
        id: `${lockup}-${event.args.streamId}`,
        tokenAddress: commonParams.token,
        lockup: event.log.address,
        streamId: event.args.streamId,
        depositAmount: commonParams.depositAmount,
        cliffTime: cliffTimeSec,
        blockNumber: BigInt(event.block.number),
        timestamp: BigInt(event.block.timestamp),
      })
      .onConflictDoNothing();
  },
);
