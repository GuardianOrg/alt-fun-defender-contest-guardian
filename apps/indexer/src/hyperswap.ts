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

  // Decimate snapshot writes to at most one row per `(tokenAddress, blockTs)`.
  // HyperSwap V2's `Sync` fires on every reserve change — post-swap state, MEV
  // bot tail-swaps inside the same block, multi-step arbitrage routes — and on
  // an actively-traded graduated token that produced ~22K snapshot rows in the
  // 24h window before this fix vs. ~12K user-facing trades, ~2× the rate the
  // chart actually needs. Sub-second resolution is unusable in the chart UI
  // (the finest interval is 5 s) so a once-per-second cadence is lossless for
  // the only consumer of this table (the `/chart` route).
  //
  // Strategy: first-per-second wins (`onConflictDoNothing`, NOT `doUpdate`).
  // The id shape encodes the bucket: `sync-bucket-${tokenAddress}-${blockTs}`,
  // and the bucket row is written exactly once — the FIRST same-second Sync
  // populates it, every subsequent same-second Sync short-circuits at the
  // unique-index check and is dropped before Postgres extends the heap or
  // writes a WAL record. This is deliberate, and load-bearing for both
  // properties below; the latest-wins alternative was rejected during review
  // (PR #985 thread with @charlesmlin):
  //
  //   1. **Write IOPS reduction.** `doUpdate` would still cost a Postgres
  //      round-trip + heap insert + WAL + replication + future vacuum on
  //      every single Sync (the dedup ratio only saves rows, not writes).
  //      `doNothing` cuts ALL of those proportional to the dedup ratio —
  //      ~2× write reduction on ALT, the whole point of the issue's
  //      "wastes Neon write IOPS during peak indexing" bullet.
  //   2. **Row immutability.** Once a `(token, second)` bucket row exists
  //      it is never mutated, so two queries against the same historical
  //      bucket return byte-identical results. Latest-wins would silently
  //      mutate the row on every same-second Sync, weakening the read-
  //      stability guarantee the original per-event id shape provided.
  //
  // Cost: the bucket records the FIRST Sync's reserves rather than the last.
  // Inside a same-second MEV sandwich the recorded reserves are pre-tail-
  // swap rather than post-tail-swap, so a 5 s candle's `close` is set by the
  // first Sync of its last second rather than the last. At HyperSwap V2 mid-
  // tier liquidity that's typically <0.1 % drift on a sub-pixel-relevant
  // dimension at the chart's >=5 s candle resolution, AND the live in-
  // progress candle bypasses the DB entirely via the WS broadcast (which
  // fires on every Sync regardless of the DB-side dedup, see below) so the
  // user-facing live chart is unaffected.
  //
  // The downstream chart fetcher (`fetchTokenChartSnapshots`) only uses
  // `tokenSnapshot.id` for the `(timestamp, id)` ORDER BY tiebreak, which
  // remains deterministic with the new shape (one row per second eliminates
  // the same-block tiebreak case the tiebreak existed for). Future consumers
  // that need per-event reserve deltas should NOT add a dependency on this
  // table — read `pairReserve` history (one row per pair, mutated on every
  // Sync) or compute deltas from `routerTrade` (per-event, append-only)
  // instead. See issue #978 and `apps/indexer/AGENTS.md`.
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
