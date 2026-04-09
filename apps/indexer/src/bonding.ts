import { ponder } from "@/generated";

import * as schema from "../ponder.schema";

ponder.on("Bonding:TokenLaunched", async ({ event, context }) => {
  await context.db.insert(schema.token).values({
    address: event.args.token,
    name: event.args.name,
    symbol: event.args.symbol,
    creator: event.args.creator,
    ltToken: event.args.ltToken,
    k: event.args.k,
    curveSupply: 0n,
    ltReserve: 0n,
    graduated: false,
    blockNumber: BigInt(event.block.number),
    timestamp: event.block.timestamp,
  });
});

ponder.on("Bonding:Trade", async ({ event, context }) => {
  const tradeId = `${event.transaction.hash}-${event.log.logIndex}`;

  await context.db.insert(schema.trade).values({
    id: tradeId,
    tokenAddress: event.args.token,
    trader: event.args.trader,
    isBuy: event.args.isBuy,
    ltAmount: event.args.ltAmount,
    tokenAmount: event.args.tokenAmount,
    curveSupply: event.args.curveSupply,
    ltReserve: event.args.ltReserve,
    blockNumber: BigInt(event.block.number),
    timestamp: event.args.timestamp,
  });

  await context.db
    .update(schema.token, { address: event.args.token })
    .set({
      curveSupply: event.args.curveSupply,
      ltReserve: event.args.ltReserve,
    });
});

ponder.on("Bonding:TokenGraduated", async ({ event, context }) => {
  await context.db.insert(schema.graduation).values({
    tokenAddress: event.args.token,
    pairAddress: event.args.pair,
    liquidity: event.args.liquidity,
    blockNumber: BigInt(event.block.number),
    timestamp: event.block.timestamp,
  });

  await context.db
    .update(schema.token, { address: event.args.token })
    .set({
      graduated: true,
      graduatedAt: event.block.timestamp,
      pairAddress: event.args.pair,
    });
});

ponder.on("Bonding:Referred", async ({ event, context }) => {
  const referralId = `${event.transaction.hash}-${event.log.logIndex}`;

  await context.db.insert(schema.referral).values({
    id: referralId,
    tokenAddress: event.args.token,
    trader: event.args.trader,
    referrer: event.args.referrer,
    ltAmount: event.args.ltAmount,
    blockNumber: BigInt(event.block.number),
    timestamp: event.block.timestamp,
  });
});
