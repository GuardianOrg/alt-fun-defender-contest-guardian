import { ponder } from "ponder:registry";

import {
  creatorEarnings,
  feeAccrual,
  feeClaim,
  token,
} from "ponder:schema";

ponder.on("FeeVault:FeeAccrued", async ({ event, context }) => {
  const { db } = context;
  const id = `${event.transaction.hash}-${event.log.logIndex}`;

  await db
    .insert(feeAccrual)
    .values({
      id,
      tokenAddress: event.args.token,
      creator: event.args.creator,
      creatorAmount: event.args.creatorAmount,
      protocolAmount: event.args.protocolAmount,
      isBuy: event.args.isBuy,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();

  // Bump the per-token lifetime fee counters so the API can serve
  // `ApiToken.creatorFeesUsd` / `protocolFeesUsd` in O(1) without
  // paginating every accrual for the token. Mirrors the
  // `volumeUsd` / `organicUsdcRaised` pattern in `bonding.ts`. Defensive
  // skip when the token row is missing (shouldn't happen — the router
  // can only fire `FeeAccrued` for tokens registered via Bonding — but
  // protects against handler ordering quirks during a backfill).
  const current = await db.find(token, { address: event.args.token });
  if (current) {
    await db.update(token, { address: event.args.token }).set({
      creatorFeesUsd: current.creatorFeesUsd + event.args.creatorAmount,
      protocolFeesUsd: current.protocolFeesUsd + event.args.protocolAmount,
    });
  }

  // Bump the per-creator running counter. The API's `/creators/:wallet
  // /earnings` endpoint reads from this row directly so the frontend
  // doesn't need to hit `FeeVault.creatorBalance` /
  // `lifetimeCreatorEarned` over RPC on every 30s poll. Lifetime
  // counter — never decreases (a `FeeVault:CreatorFeesClaimed` bumps
  // `lifetimeClaimedUsdc` instead, and the API derives `claimable =
  // lifetimeEarned − lifetimeClaimed` at read time).
  const existingEarnings = await db.find(creatorEarnings, {
    creator: event.args.creator,
  });
  if (existingEarnings) {
    await db.update(creatorEarnings, { creator: event.args.creator }).set({
      lifetimeEarnedUsdc:
        existingEarnings.lifetimeEarnedUsdc + event.args.creatorAmount,
    });
  } else {
    // `onConflictDoNothing` rather than absolute-value `onConflictDoUpdate`:
    // the find-then-update path above is the only correct accumulation
    // path; the conflict fallback is unreachable under Ponder's
    // single-threaded event-loop, and `DoUpdate` with absolute values would
    // overwrite an already-accumulated row with a single event's worth of
    // earnings if the impossible race ever fired. Mirrors the
    // `tokenHourlyMetrics` upsert in `bonding.ts` (CodeRabbit feedback on
    // PR #867).
    await db
      .insert(creatorEarnings)
      .values({
        creator: event.args.creator,
        lifetimeEarnedUsdc: event.args.creatorAmount,
        lifetimeClaimedUsdc: 0n,
      })
      .onConflictDoNothing();
  }
});

ponder.on("FeeVault:CreatorFeesClaimed", async ({ event, context }) => {
  const { db } = context;
  const id = `${event.transaction.hash}-${event.log.logIndex}`;

  await db
    .insert(feeClaim)
    .values({
      id,
      claimer: event.args.creator,
      amount: event.args.amount,
      isCreator: true,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();

  // Mirror image of the FeeAccrued handler — keep the per-creator
  // claimed-total counter in lockstep with the claim event. The
  // `creatorEarnings` row may be absent if the very first event we see
  // for this wallet is a claim (e.g. backfill ordering, or a creator
  // who claimed via direct contract interaction before any indexed
  // accrual fired); seed the row in that case so the read side never
  // sees a `lifetimeEarned < lifetimeClaimed` snapshot it would have to
  // re-clamp.
  const existingEarnings = await db.find(creatorEarnings, {
    creator: event.args.creator,
  });
  if (existingEarnings) {
    await db.update(creatorEarnings, { creator: event.args.creator }).set({
      lifetimeClaimedUsdc:
        existingEarnings.lifetimeClaimedUsdc + event.args.amount,
    });
  } else {
    // See accumulator-upsert comment in the FeeAccrued handler above —
    // `onConflictDoNothing` is the correct fallback for a running counter.
    await db
      .insert(creatorEarnings)
      .values({
        creator: event.args.creator,
        lifetimeEarnedUsdc: 0n,
        lifetimeClaimedUsdc: event.args.amount,
      })
      .onConflictDoNothing();
  }
});

ponder.on("FeeVault:ProtocolFeesClaimed", async ({ event, context }) => {
  const { db } = context;
  const id = `${event.transaction.hash}-${event.log.logIndex}`;

  await db
    .insert(feeClaim)
    .values({
      id,
      claimer: event.args.feeTo,
      amount: event.args.amount,
      isCreator: false,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();
});
