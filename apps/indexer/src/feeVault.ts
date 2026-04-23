import { ponder } from "ponder:registry";

import { feeAccrual, feeClaim } from "ponder:schema";

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
