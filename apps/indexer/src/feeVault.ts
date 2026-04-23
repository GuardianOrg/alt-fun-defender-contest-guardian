import { ponder } from "ponder:registry";

import { feeAccrual, feeClaim, token } from "ponder:schema";

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
