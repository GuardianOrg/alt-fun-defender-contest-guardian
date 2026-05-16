import { ponder } from "ponder:registry";
import {
  pairReserve,
  hyperswapPairIndex,
  token,
  tokenSnapshot,
} from "ponder:schema";

import { broadcastEvent, isLiveEvent } from "./broadcast.js";

/**
 * The `HyperSwapPair` source intentionally has only **one** indexing function
 * (`Sync`) — see the doc comment below the handler for the why. Adding a
 * second `ponder.on("HyperSwapPair:...")` handler would silently break
 * post-graduation indexing for every newly-graduated token until repaired by
 * hand. If you need per-swap data, derive it from `Zap:Buy` / `Zap:Sell` (the
 * router-level events) or compute it from `Sync` reserve deltas — do not
 * subscribe `HyperSwapPair:Swap`. The lock is enforced at runtime by
 * `apps/indexer/test/single-handler-per-factory.test.ts`.
 */
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
  //
  // Why this is the only `HyperSwapPair:*` handler: Ponder 0.16's
  // real-time sync has a known bug where a factory source registered
  // for ≥2 events causes `factories` (in `sync-realtime/index.js`) to
  // contain the same factory object twice, and `filterBlockEventData`'s
  // self-deletion branch (`blockChildAddresses.get(factory).delete(...)`)
  // erases the freshly-extracted child address on the second pass —
  // every new pair registered post-deploy is silently dropped from
  // `ponder_sync.factory_addresses`. Historical sync dedupes by
  // `factory.id`; real-time does not. Keeping `Sync` as the single
  // handler avoids the bug; per-swap data comes from `Zap:Buy` /
  // `Zap:Sell` instead. See PR description for the full root-cause
  // walkthrough.
  const idx = await db.find(hyperswapPairIndex, { pairAddress: pairAddr });
  if (!idx) return;

  const tokenReserve = idx.tokenIsToken0 ? reserve0 : reserve1;
  const ltReserve = idx.tokenIsToken0 ? reserve1 : reserve0;

  await db.update(token, { address: idx.tokenAddress }).set({
    curveSupply: tokenReserve,
    ltReserve,
  });

  // Per-second snapshot decimation: one `tokenSnapshot` row per
  // `(tokenAddress, blockTs)` bucket via deterministic id +
  // `onConflictDoNothing()` (first-wins). Policy rationale lives in
  // `apps/indexer/AGENTS.md` → *Per-second snapshot decimation* (issue #978).
  const snapshotId = `sync-bucket-${idx.tokenAddress}-${event.block.timestamp.toString()}`;
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
  //
  // The broadcast fires unconditionally on every Sync (subject to the
  // `isLiveEvent` backfill guard) — it is intentionally NOT gated on the
  // database-side dedup. The chart's live tick aggregator merges every
  // tick into the in-progress candle for sub-second high/low fidelity;
  // suppressing intra-second ticks would visibly flat-line the candle.
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
