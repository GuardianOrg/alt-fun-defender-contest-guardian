import { ponder } from "ponder:registry";
import {
  swap,
  pairReserve,
  hyperswapPairIndex,
  token,
  tokenSnapshot,
} from "ponder:schema";

import { broadcastEvent, isLiveEvent } from "./broadcast.js";

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
  const pairAddr = event.log.address;
  const reserve0 = BigInt(event.args.reserve0);
  const reserve1 = BigInt(event.args.reserve1);

  // Persist the latest pair reserves regardless of whether we know the
  // token mapping yet — the row is used by other code paths (e.g. ad-hoc
  // analytics, future routes) and keeping it independent of
  // `hyperswapPairIndex` makes the table idempotent on its own.
  await db
    .insert(pairReserve)
    .values({
      pairAddress: pairAddr,
      reserve0,
      reserve1,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoUpdate({
      reserve0,
      reserve1,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    });

  // Mirror HyperSwap reserves into `token.curveSupply` / `token.ltReserve`
  // so post-graduation price/mcap/change24h derive from live DEX state
  // through the same `computeTokenPrice(curveSupply, ltReserve, rate)`
  // formula used during the curve phase. The columns are reused
  // (rather than adding `hyperswapTokenReserve` / `hyperswapLtReserve`)
  // so every consumer that already reads token reserves keeps working
  // without having to special-case graduation.
  //
  // The very first Sync emitted in the same tx as `TokenGraduated`
  // (from the LP-seed `addLiquidity`) likely won't be observed: Ponder
  // only registers the pair as a factory contract once `TokenGraduated`
  // fires, and dynamic-factory events from the same tx that precede the
  // parent event aren't replayed. That's fine — at graduation the curve
  // and LP open at exactly the same price (zero-gap dynamic LP seeding),
  // so `token.curveSupply` / `token.ltReserve` carried over from the
  // last `Bonding.Trade` are already correct until the first user trade
  // on HyperSwap fires the next Sync.
  const idx = await db.find(hyperswapPairIndex, { pairAddress: pairAddr });
  if (!idx) return;

  const tokenReserve = idx.tokenIsToken0 ? reserve0 : reserve1;
  const ltReserve = idx.tokenIsToken0 ? reserve1 : reserve0;

  await db.update(token, { address: idx.tokenAddress }).set({
    curveSupply: tokenReserve,
    ltReserve,
  });

  const snapshotId = `sync-${event.transaction.hash}-${event.log.logIndex}`;
  await db
    .insert(tokenSnapshot)
    .values({
      id: snapshotId,
      tokenAddress: idx.tokenAddress,
      curveSupply: tokenReserve,
      ltReserve,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();

  // Chart-state broadcast on the `trade` channel so `useChartData` picks
  // up the new ratio and rolls the in-progress candle. We deliberately
  // omit the trade-list payload (`usdcAmount` / `trader` / `isBuy` /
  // `tokenAmount`) — Sync events don't carry them, and trade-list rows
  // for post-grad swaps come from the `Zap:Buy` / `Zap:Sell` broadcasts
  // (which fire in the same tx) plus the REST `/api/v1/trades` poll
  // fallback. See `TradeBroadcast`'s docstring for the full split.
  if (isLiveEvent(event.block.timestamp)) {
    broadcastEvent({
      event: "trade",
      tokenAddress: idx.tokenAddress,
      data: {
        id: snapshotId,
        tokenAddress: idx.tokenAddress,
        curveSupply: tokenReserve.toString(),
        ltReserve: ltReserve.toString(),
        timestamp: event.block.timestamp.toString(),
      },
    });
  }
});
