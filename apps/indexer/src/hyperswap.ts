import { ponder } from "ponder:registry";
import { swap, pairReserve } from "ponder:schema";

ponder.on("HyperSwapPair:Swap", async ({ event, context }) => {
  const { db } = context;
  await db
    .insert(swap)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      pairAddress: event.log.address,
      sender: event.args.sender,
      to: event.args.to,
      amount0In: event.args.amount0In,
      amount1In: event.args.amount1In,
      amount0Out: event.args.amount0Out,
      amount1Out: event.args.amount1Out,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();
});

ponder.on("HyperSwapPair:Sync", async ({ event, context }) => {
  const { db } = context;
  await db
    .insert(pairReserve)
    .values({
      pairAddress: event.log.address,
      reserve0: BigInt(event.args.reserve0),
      reserve1: BigInt(event.args.reserve1),
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoUpdate({
      reserve0: BigInt(event.args.reserve0),
      reserve1: BigInt(event.args.reserve1),
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    });
});
