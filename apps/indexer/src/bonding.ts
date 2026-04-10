import { ponder } from "@/generated";
import { token, trade, routerTrade, graduation, referral, feeClaim } from "../ponder.schema";

ponder.on("Bonding:TokenLaunched", async ({ event, context }) => {
  const { db } = context;
  await db
    .insert(token)
    .values({
      address: event.args.token,
      name: event.args.name,
      symbol: event.args.ticker,
      creator: event.args.creator,
      ltToken: event.args.ltAddress,
      k: event.args.k,
      curveSupply: 0n,
      ltReserve: 0n,
      graduated: false,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();
});

ponder.on("Bonding:Trade", async ({ event, context }) => {
  const { db } = context;
  const tradeId = `${event.transaction.hash}-${event.log.logIndex}`;

  await db
    .insert(trade)
    .values({
      id: tradeId,
      tokenAddress: event.args.token,
      trader: event.args.trader,
      isBuy: event.args.isBuy,
      ltAmount: event.args.ltAmount,
      tokenAmount: event.args.tokenAmount,
      curveSupply: event.args.newCurveSupply,
      ltReserve: event.args.newLtReserve,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();

  await db
    .update(token, { address: event.args.token })
    .set({
      curveSupply: event.args.newCurveSupply,
      ltReserve: event.args.newLtReserve,
    });
});

ponder.on("Bonding:TokenGraduated", async ({ event, context }) => {
  const { db } = context;

  await db
    .insert(graduation)
    .values({
      tokenAddress: event.args.token,
      pairAddress: event.args.pairAddress,
      liquidity: event.args.liquidity,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();

  await db
    .update(token, { address: event.args.token })
    .set({
      graduated: true,
      graduatedAt: BigInt(event.block.timestamp),
      pairAddress: event.args.pairAddress,
    });
});

ponder.on("Bonding:CreatorFeesClaimed", async ({ event, context }) => {
  const { db } = context;
  const claimId = `${event.transaction.hash}-${event.log.logIndex}`;

  await db
    .insert(feeClaim)
    .values({
      id: claimId,
      claimer: event.args.creator,
      ltAddress: event.args.lt,
      amount: event.args.amount,
      isCreator: true,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();
});

ponder.on("Bonding:ProtocolFeesClaimed", async ({ event, context }) => {
  const { db } = context;
  const claimId = `${event.transaction.hash}-${event.log.logIndex}`;

  await db
    .insert(feeClaim)
    .values({
      id: claimId,
      claimer: event.args.lt,
      ltAddress: event.args.lt,
      amount: event.args.amount,
      isCreator: false,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();
});

ponder.on("RedemptionRouter:Buy", async ({ event, context }) => {
  const { db } = context;
  const tradeId = `${event.transaction.hash}-${event.log.logIndex}`;

  await db
    .insert(routerTrade)
    .values({
      id: tradeId,
      tokenAddress: event.args.token,
      trader: event.args.buyer,
      isBuy: true,
      usdcAmount: event.args.usdcIn,
      tokenAmount: event.args.tokensOut,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();
});

ponder.on("RedemptionRouter:Sell", async ({ event, context }) => {
  const { db } = context;
  const tradeId = `${event.transaction.hash}-${event.log.logIndex}`;

  await db
    .insert(routerTrade)
    .values({
      id: tradeId,
      tokenAddress: event.args.token,
      trader: event.args.seller,
      isBuy: false,
      usdcAmount: event.args.usdcOut,
      tokenAmount: event.args.tokensIn,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();
});

ponder.on("RedemptionRouter:Referred", async ({ event, context }) => {
  const { db } = context;
  const refId = `${event.transaction.hash}-${event.log.logIndex}`;

  await db
    .insert(referral)
    .values({
      id: refId,
      tokenAddress: event.args.token,
      trader: event.args.trader,
      referrer: event.args.referrer,
      usdcAmount: event.args.usdcAmount,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();
});
