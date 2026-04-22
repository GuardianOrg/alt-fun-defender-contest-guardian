import { ponder } from "ponder:registry";

import {
  token,
  trade,
  routerTrade,
  graduation,
  referral,
  feeClaim,
  tokenBalance,
  tokenSnapshot,
} from "ponder:schema";

import { broadcastEvent, isLiveEvent } from "./broadcast.js";

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
    // FFactory:PairCreated fires earlier in the same tx and may have inserted a
    // placeholder row carrying `bondingPair`. Overwrite the metadata fields but
    // preserve `bondingPair` / `hyperswapPair`.
    .onConflictDoUpdate({
      name: event.args.name,
      symbol: event.args.ticker,
      creator: event.args.creator,
      ltToken: event.args.ltAddress,
      k: event.args.k,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    });
});

ponder.on("FFactory:PairCreated", async ({ event, context }) => {
  const { db } = context;
  const tokenAddr = event.args.tokenA;
  const ltAddr = event.args.tokenB;

  // Runs in the same tx as Bonding:TokenLaunched, before it. The Bonding
  // handler later overwrites the placeholder metadata fields.
  await db
    .insert(token)
    .values({
      address: tokenAddr,
      name: "",
      symbol: "",
      creator: ZERO_ADDRESS,
      ltToken: ltAddr,
      k: 0n,
      curveSupply: 0n,
      ltReserve: 0n,
      graduated: false,
      bondingPair: event.args.pair,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoUpdate({ bondingPair: event.args.pair });
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

  // Curve-state snapshot used by /market-data to reconstruct the curve ratio at
  // any cutoff. The LT exchange rate at the same cutoff is joined in from
  // BounceTech's `token_snapshots_v1` at API read time — we can't read it here
  // historically on HyperEVM (Hyperliquid precompile reverts on past blocks).
  await db
    .insert(tokenSnapshot)
    .values({
      id: tradeId,
      tokenAddress: event.args.token,
      curveSupply: event.args.newCurveSupply,
      ltReserve: event.args.newLtReserve,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();

  // Real-time broadcast for the `trade` WS channel. Skipped during historical
  // backfill so restarts don't replay stale trades to live subscribers.
  // `curveSupply` / `ltReserve` are included so the frontend chart can
  // recompute `ratio = ltReserve / curveSupply` without a Ponder round-trip.
  if (isLiveEvent(event.block.timestamp)) {
    broadcastEvent({
      event: "trade",
      tokenAddress: event.args.token,
      data: {
        id: tradeId,
        tokenAddress: event.args.token,
        trader: event.args.trader,
        isBuy: event.args.isBuy,
        ltAmount: event.args.ltAmount.toString(),
        tokenAmount: event.args.tokenAmount.toString(),
        curveSupply: event.args.newCurveSupply.toString(),
        ltReserve: event.args.newLtReserve.toString(),
        timestamp: event.block.timestamp.toString(),
      },
    });
  }
});

ponder.on("Bonding:TokenGraduated", async ({ event, context }) => {
  const { db } = context;

  await db
    .insert(graduation)
    .values({
      tokenAddress: event.args.token,
      pairAddress: event.args.pairAddress,
      liquidity: event.args.liquidity,
      tokensInLP: event.args.tokensInLP,
      lpBurned: event.args.lpBurned,
      unsoldBurned: event.args.unsoldBurned,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();

  await db
    .update(token, { address: event.args.token })
    .set({
      graduated: true,
      graduatedAt: BigInt(event.block.timestamp),
      hyperswapPair: event.args.pairAddress,
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

  // Bump `organicUsdcRaised` so the API can split the graduation progress bar
  // into "organic" (user USDC) and "LT price appreciation" (current LT×rate
  // minus organic). We update unconditionally — if the LT rallied mid-buy and
  // graduation fires in the same tx, this event still represents real user
  // capital and should count toward the organic bucket.
  //
  // `volumeUsd` is a lifetime gross counter (both buys and sells add, never
  // subtract) surfaced as `totalVolumeUsd` on the API — different semantics
  // from the net `organicUsdcRaised`, so we bump both in the same write.
  const current = await db.find(token, { address: event.args.token });
  if (current) {
    await db.update(token, { address: event.args.token }).set({
      organicUsdcRaised: current.organicUsdcRaised + event.args.usdcIn,
      volumeUsd: current.volumeUsd + event.args.usdcIn,
    });
  }
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

  // Mirror image of the Buy handler — net USDC out reduces the organic
  // bucket. Floor at zero: if a user sells more USDC than the cumulative buys
  // (e.g. post-graduation sells on a token with very thin curve history), we
  // don't want a negative organic number bleeding into the UI.
  //
  // `volumeUsd` tracks *gross* lifetime turnover (not net capital in), so a
  // sell adds to it just like a buy does. Never floors.
  const current = await db.find(token, { address: event.args.token });
  if (current) {
    const next = current.organicUsdcRaised - event.args.usdcOut;
    await db.update(token, { address: event.args.token }).set({
      organicUsdcRaised: next > 0n ? next : 0n,
      volumeUsd: current.volumeUsd + event.args.usdcOut,
    });
  }
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
