import { ponder } from "ponder:registry";
import { token, trade, routerTrade, graduation, referral, feeClaim, tokenBalance } from "ponder:schema";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

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
      claimer: event.transaction.from,
      ltAddress: event.args.lt,
      amount: event.args.amount,
      isCreator: false,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();
});

ponder.on("LaunchpadRouter:Buy", async ({ event, context }) => {
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

ponder.on("LaunchpadRouter:Sell", async ({ event, context }) => {
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

ponder.on("LaunchpadRouter:Referred", async ({ event, context }) => {
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

ponder.on("FERC20Token:Transfer", async ({ event, context }) => {
  const { db } = context;
  const tokenAddr = event.log.address;
  const from = event.args.from;
  const to = event.args.to;
  const value = event.args.value;

  if (from !== ZERO_ADDRESS) {
    const id = `${from}-${tokenAddr}`;
    const existing = await db.find(tokenBalance, { id });
    const prev = existing?.balance ?? 0n;
    const balance = prev >= value ? prev - value : 0n;
    await db
      .insert(tokenBalance)
      .values({ id, wallet: from, tokenAddress: tokenAddr, balance })
      .onConflictDoUpdate({ balance });
  }

  if (to !== ZERO_ADDRESS) {
    const id = `${to}-${tokenAddr}`;
    const existing = await db.find(tokenBalance, { id });
    const prev = existing?.balance ?? 0n;
    await db
      .insert(tokenBalance)
      .values({ id, wallet: to, tokenAddress: tokenAddr, balance: prev + value })
      .onConflictDoUpdate({ balance: prev + value });
  }
});
