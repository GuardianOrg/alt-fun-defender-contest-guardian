import { ponder } from "ponder:registry";

import {
  token,
  trade,
  routerTrade,
  graduation,
  referral,
  tokenBalance,
  tokenSnapshot,
  hyperswapPairIndex,
  globalStats,
  hourlyVolume,
  walletPosition,
  tokenHourlyMetrics,
} from "ponder:schema";

import { broadcastEvent, isLiveEvent } from "./broadcast.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const GLOBAL_STATS_ID = "global" as const;
const SECONDS_PER_HOUR = 3600n;

// `bumpTokenHourly` would be the natural shape for the per-token hourly
// bucket maintenance below — one upsert called from both Buy and Sell
// handlers — but Ponder's `Db<typeof schema>` type isn't exported from
// the public `ponder` module (only the schema-bound `Db` interface is in
// `ponder/dist/types/types/db.d.ts`), so a top-level helper signature
// can't be typed without invasive `Parameters<Parameters<...>>`
// reflection. The block is inlined in both handlers below with the
// `MAINTAIN_TOKEN_HOURLY` marker comment — keep the two copies in sync.

/**
 * Trim a token-row label and collapse blank-after-trim to `undefined`.
 *
 * The `Factory:PairCreated` handler inserts a placeholder `token` row
 * with empty `name` / `symbol` strings before `Bonding:TokenLaunched`
 * runs and overwrites them, so the trade broadcast must be defensive:
 * shipping a literal empty string would let the client cache that
 * blank label and freeze the row on it.
 *
 * Trimming is also defensive against indexer payloads with whitespace-
 * only labels — same failure mode (the client's `subscribeTokenName`
 * fast-path would treat a whitespace string as "resolved" and never
 * retry, see `tokenNames.ts`).
 */
function tokenLabelOrUndefined(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const trimmed = label.trim();
  return trimmed === "" ? undefined : trimmed;
}

ponder.on("Bonding:TokenLaunched", async ({ event, context }) => {
  const { db } = context;
  await db
    .insert(token)
    .values({
      address: event.args.token,
      name: event.args.name,
      symbol: event.args.ticker,
      creator: event.args.creator,
      feeRecipient: event.args.creator,
      ltToken: event.args.ltAddress,
      k: event.args.k,
      curveSupply: 0n,
      ltReserve: 0n,
      graduated: false,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    // Factory:PairCreated fires earlier in the same tx and may have inserted a
    // placeholder row carrying `bondingPair`. Overwrite the metadata fields but
    // preserve `bondingPair` / `hyperswapPair`.
    .onConflictDoUpdate({
      name: event.args.name,
      symbol: event.args.ticker,
      creator: event.args.creator,
      feeRecipient: event.args.creator,
      ltToken: event.args.ltAddress,
      k: event.args.k,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    });

  // Bump platform-wide token counters. `TokenLaunched` is the canonical
  // "token created" event (Factory:PairCreated only inserts a placeholder
  // metadata row), so it's the deduped point for incrementing `totalTokens`.
  // `tokensLive` mirrors the historic /stats math: live = total − graduated.
  const stats = await db.find(globalStats, { id: GLOBAL_STATS_ID });
  if (stats) {
    await db.update(globalStats, { id: GLOBAL_STATS_ID }).set({
      totalTokens: stats.totalTokens + 1n,
      tokensLive: stats.tokensLive + 1n,
    });
  } else {
    await db
      .insert(globalStats)
      .values({
        id: GLOBAL_STATS_ID,
        totalTokens: 1n,
        tokensLive: 1n,
        tokensGraduated: 0n,
        totalVolumeUsd: 0n,
      })
      .onConflictDoUpdate({ totalTokens: 1n, tokensLive: 1n });
  }
});

ponder.on("Factory:PairCreated", async ({ event, context }) => {
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
      feeRecipient: ZERO_ADDRESS,
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

/**
 * Move `feeRecipient` when the creator role changes hands. `creator` is
 * deliberately left alone — see the field docs in `ponder.schema.ts` for why
 * the launch identity and the current fee earner are separate columns.
 *
 * Without these handlers `feeRecipient` would be frozen at the launch wallet,
 * and the API's `?creator=` filter (which the profile's created-token list,
 * the rewards tab, and the transfer-creator tab all sit on) would keep
 * attributing tokens to whoever launched them. Creator *earnings* are
 * unaffected either way: those come from `FeeVault.FeeAccrued`, which carries
 * whichever creator was live at trade time.
 *
 * `Bonding` emits two events for this one state change — `CreatorTransferred`
 * when the outgoing creator signs the handover, `CreatorReassigned` when the
 * protocol owner forces it for a community takeover — and both need the
 * identical row update. The update is inlined in both rather than extracted
 * because Ponder's `Db` type isn't exported (see the `MAINTAIN_TOKEN_HOURLY`
 * note at the top of this file).
 *
 * `TokenLaunched` always precedes a transfer, so the row is guaranteed to
 * exist by the time either event fires — a bare `update` is safe, same as
 * the `TokenGraduating` handler below.
 */
ponder.on("Bonding:CreatorTransferred", async ({ event, context }) => {
  await context.db
    .update(token, { address: event.args.token })
    .set({ feeRecipient: event.args.newCreator });
});

ponder.on("Bonding:CreatorReassigned", async ({ event, context }) => {
  await context.db
    .update(token, { address: event.args.token })
    .set({ feeRecipient: event.args.newCreator });
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

  // Chart-state broadcast. Carries only the post-trade virtual reserves so
  // the frontend chart can recompute `ratio = ltReserve / curveSupply`
  // without a Ponder round-trip. The trade-feed UI does NOT consume this
  // event for its row list — trade-list rows come from the `Zap:Buy` /
  // `Zap:Sell` broadcasts (which carry the gross USDC and dedupe against
  // the REST poll fallback by `id`). The trade-list payload (`usdcAmount`
  // / `trader` / `isBuy` / `tokenAmount`) is deliberately omitted so the
  // shape can't be misread as a user-facing trade.
  if (isLiveEvent(event.block.timestamp)) {
    broadcastEvent({
      event: "trade",
      tokenAddress: event.args.token,
      data: {
        id: tradeId,
        tokenAddress: event.args.token,
        curveSupply: event.args.newCurveSupply.toString(),
        ltReserve: event.args.newLtReserve.toString(),
        timestamp: event.block.timestamp.toString(),
      },
    });
  }
});

/**
 * Phase 1 of graduation. Fires inline on the threshold-crossing buy. The
 * token is now contract-frozen — no more buys/sells will land — but the
 * HyperSwap LP isn't seeded yet (that's phase 2 / `TokenGraduated`). We
 * surface this as `pendingGraduation: true` so the API can show the
 * "Token is graduating" overlay and the keeper can drive `finalizeGraduation`.
 */
ponder.on("Bonding:TokenGraduating", async ({ event, context }) => {
  const { db } = context;

  await db
    .update(token, { address: event.args.token })
    .set({
      pendingGraduation: true,
      pendingGraduationAt: BigInt(event.block.timestamp),
    });

  if (isLiveEvent(event.block.timestamp)) {
    broadcastEvent({
      event: "graduation",
      tokenAddress: event.args.token,
      data: {
        phase: "graduating",
        tokenAddress: event.args.token,
        tokensForLP: event.args.tokensForLP.toString(),
        ltFromPair: event.args.ltFromPair.toString(),
        lpBurned: event.args.lpBurned.toString(),
        unsoldBurned: event.args.unsoldBurned.toString(),
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
      pendingGraduation: false,
      graduated: true,
      graduatedAt: BigInt(event.block.timestamp),
      hyperswapPair: event.args.pairAddress,
    });

  // Move the token from the live bucket to the graduated bucket. Mirrors
  // the legacy /stats `live = total − graduated` decomposition; safe to
  // run unconditionally because `TokenGraduated` only fires once per token.
  // `find` always returns a row here in practice (TokenLaunched fires first
  // and seeds the singleton), but we tolerate an absent row for robustness.
  const graduationStats = await db.find(globalStats, { id: GLOBAL_STATS_ID });
  if (graduationStats) {
    await db.update(globalStats, { id: GLOBAL_STATS_ID }).set({
      tokensLive: graduationStats.tokensLive - 1n,
      tokensGraduated: graduationStats.tokensGraduated + 1n,
    });
  }

  // Populate the reverse pair → token index so the HyperSwap Sync handler
  // can resolve the token in O(1) on every post-graduation reserve update.
  // We need the LT address to cache the token0/token1 ordering: HyperSwap V2
  // sorts pair tokens by ascending address, so `tokenIsToken0` is fixed at
  // pair creation. Caching it here avoids re-comparing strings on every
  // Sync event over the lifetime of the pair.
  const tokenRow = await db.find(token, { address: event.args.token });
  if (tokenRow) {
    const tokenAddrLower = event.args.token.toLowerCase();
    const ltAddrLower = tokenRow.ltToken.toLowerCase();
    await db
      .insert(hyperswapPairIndex)
      .values({
        pairAddress: event.args.pairAddress,
        tokenAddress: event.args.token,
        ltAddress: tokenRow.ltToken,
        tokenIsToken0: tokenAddrLower < ltAddrLower,
      })
      .onConflictDoNothing();
  }

  if (isLiveEvent(event.block.timestamp)) {
    broadcastEvent({
      event: "graduation",
      tokenAddress: event.args.token,
      data: {
        phase: "graduated",
        tokenAddress: event.args.token,
        pairAddress: event.args.pairAddress,
        liquidity: event.args.liquidity.toString(),
        tokensInLP: event.args.tokensInLP.toString(),
        lpBurned: event.args.lpBurned.toString(),
        unsoldBurned: event.args.unsoldBurned.toString(),
        timestamp: event.block.timestamp.toString(),
      },
    });
  }
});

ponder.on("Zap:Buy", async ({ event, context }) => {
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

  // Platform-wide gross volume + hourly bucket. Read by `/api/v1/stats` so
  // it can answer in O(1) (singleton + ≤24-row bucket scan) instead of
  // paginating every Zap trade in the last 24h.
  const buyStats = await db.find(globalStats, { id: GLOBAL_STATS_ID });
  if (buyStats) {
    await db.update(globalStats, { id: GLOBAL_STATS_ID }).set({
      totalVolumeUsd: buyStats.totalVolumeUsd + event.args.usdcIn,
    });
  } else {
    await db
      .insert(globalStats)
      .values({
        id: GLOBAL_STATS_ID,
        totalTokens: 0n,
        tokensLive: 0n,
        tokensGraduated: 0n,
        totalVolumeUsd: event.args.usdcIn,
      })
      .onConflictDoUpdate({ totalVolumeUsd: event.args.usdcIn });
  }
  const buyHourStart = (BigInt(event.block.timestamp) / SECONDS_PER_HOUR) * SECONDS_PER_HOUR;
  const buyHourly = await db.find(hourlyVolume, { hourStart: buyHourStart });
  if (buyHourly) {
    await db.update(hourlyVolume, { hourStart: buyHourStart }).set({
      volumeUsd: buyHourly.volumeUsd + event.args.usdcIn,
    });
  } else {
    await db
      .insert(hourlyVolume)
      .values({ hourStart: buyHourStart, volumeUsd: event.args.usdcIn })
      .onConflictDoUpdate({ volumeUsd: event.args.usdcIn });
  }

  // Per-(wallet, token) cost-basis state for `/api/v1/portfolio`. Avoids
  // walking the wallet's full Zap trade history on every read. Only Zap
  // mediates buys, so cost basis here is exact for purchased tokens; tokens
  // received via direct Transfer don't bump this row (and correctly stay at
  // zero cost basis).
  const positionId = `${event.args.buyer}-${event.args.token}`;
  const existingPosition = await db.find(walletPosition, { id: positionId });
  const nextZapTokenAmount = (existingPosition?.zapTokenAmount ?? 0n) + event.args.tokensOut;
  const nextCostBasis = (existingPosition?.costBasisUsdc ?? 0n) + event.args.usdcIn;
  if (existingPosition) {
    await db.update(walletPosition, { id: positionId }).set({
      zapTokenAmount: nextZapTokenAmount,
      costBasisUsdc: nextCostBasis,
    });
  } else {
    await db
      .insert(walletPosition)
      .values({
        id: positionId,
        wallet: event.args.buyer,
        tokenAddress: event.args.token,
        zapTokenAmount: nextZapTokenAmount,
        costBasisUsdc: nextCostBasis,
      })
      .onConflictDoUpdate({
        zapTokenAmount: nextZapTokenAmount,
        costBasisUsdc: nextCostBasis,
      });
  }

  // MAINTAIN_TOKEN_HOURLY — per-(token, hour) gross USDC bucket. The API
  // sums the last 24 rows per token to derive the rolling 24h volume that
  // powers `?sort=trending` and the `volume24hUsd` column. Mirror image of
  // the platform-wide `hourlyVolume` upsert above; identical block lives in
  // Zap:Sell — keep the two in sync.
  {
    const buyTimestamp = BigInt(event.block.timestamp);
    const buyHourStartTm = (buyTimestamp / SECONDS_PER_HOUR) * SECONDS_PER_HOUR;
    const buyHourlyId = `${event.args.token}-${buyHourStartTm}`;

    const existingTokenHourly = await db.find(tokenHourlyMetrics, {
      id: buyHourlyId,
    });
    if (existingTokenHourly) {
      await db.update(tokenHourlyMetrics, { id: buyHourlyId }).set({
        volumeUsd: existingTokenHourly.volumeUsd + event.args.usdcIn,
        tradeCount: existingTokenHourly.tradeCount + 1,
      });
    } else {
      // `onConflictDoNothing` rather than the absolute-value
      // `onConflictDoUpdate` the surrounding `globalStats` / `hourlyVolume`
      // upserts use: the find-then-update path above is the only correct
      // *accumulation* path; the conflict fallback is unreachable under
      // Ponder's single-threaded event-loop, and `DoUpdate` with absolute
      // values would overwrite an already-accumulated bucket with a
      // single event's worth of volume if the impossible race ever fired
      // (CodeRabbit feedback on PR #867).
      await db
        .insert(tokenHourlyMetrics)
        .values({
          id: buyHourlyId,
          tokenAddress: event.args.token,
          hourStart: buyHourStartTm,
          volumeUsd: event.args.usdcIn,
          tradeCount: 1,
        })
        .onConflictDoNothing();
    }
  }

  // Real-time trade-list broadcast. The trade-feed UI uses this *instead*
  // of the `Bonding:Trade` broadcast because:
  //   1. It carries the gross USDC the user paid (matching the visible
  //      "$X" they typed into the buy box). The Bonding broadcast carries
  //      the LT *actually consumed* by the curve, which can be less than
  //      the gross when a graduation-triggering buy hits the supply cap —
  //      producing a phantom second row in the feed (see PR notes).
  //   2. Its `id` matches `routerTrade.id` so the live-broadcast row
  //      dedupes against the REST `/api/v1/trades` poll fallback.
  //
  // We also carry the resolved `tokenSymbol` / `tokenName` from the
  // token row we already loaded above. Without this the web client has
  // to do a second Ponder GraphQL lookup to render the symbol on the
  // very first buy — which races the indexer's checkpoint and lands a
  // truncated-address fallback on screen indefinitely (issue #703).
  // `Bonding:TokenLaunched` is at a lower log index in the deploy tx,
  // so by the time `Zap:Buy` runs the metadata fields have already been
  // written and `current` is the source of truth.
  if (isLiveEvent(event.block.timestamp)) {
    broadcastEvent({
      event: "trade",
      tokenAddress: event.args.token,
      data: {
        id: tradeId,
        tokenAddress: event.args.token,
        trader: event.args.buyer,
        isBuy: true,
        tokenAmount: event.args.tokensOut.toString(),
        usdcAmount: event.args.usdcIn.toString(),
        timestamp: event.block.timestamp.toString(),
        tokenSymbol: tokenLabelOrUndefined(current?.symbol),
        tokenName: tokenLabelOrUndefined(current?.name),
      },
    });
  }
});

ponder.on("Zap:Sell", async ({ event, context }) => {
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

  // Mirror image of the Buy-side platform counters (gross only — never
  // subtracts on a sell, just like per-token `volumeUsd`).
  const sellStats = await db.find(globalStats, { id: GLOBAL_STATS_ID });
  if (sellStats) {
    await db.update(globalStats, { id: GLOBAL_STATS_ID }).set({
      totalVolumeUsd: sellStats.totalVolumeUsd + event.args.usdcOut,
    });
  } else {
    await db
      .insert(globalStats)
      .values({
        id: GLOBAL_STATS_ID,
        totalTokens: 0n,
        tokensLive: 0n,
        tokensGraduated: 0n,
        totalVolumeUsd: event.args.usdcOut,
      })
      .onConflictDoUpdate({ totalVolumeUsd: event.args.usdcOut });
  }
  const sellHourStart = (BigInt(event.block.timestamp) / SECONDS_PER_HOUR) * SECONDS_PER_HOUR;
  const sellHourly = await db.find(hourlyVolume, { hourStart: sellHourStart });
  if (sellHourly) {
    await db.update(hourlyVolume, { hourStart: sellHourStart }).set({
      volumeUsd: sellHourly.volumeUsd + event.args.usdcOut,
    });
  } else {
    await db
      .insert(hourlyVolume)
      .values({ hourStart: sellHourStart, volumeUsd: event.args.usdcOut })
      .onConflictDoUpdate({ volumeUsd: event.args.usdcOut });
  }

  // Update the seller's `walletPosition` with proportional cost-basis
  // reduction (matches the math the old /portfolio route computed in-memory
  // from the trade history). Floors at zero so a user who sold more tokens
  // than they bought via Zap (e.g. transferred-in supply, then sold via
  // Zap) doesn't end up with a negative position.
  const positionId = `${event.args.seller}-${event.args.token}`;
  const existingPosition = await db.find(walletPosition, { id: positionId });
  if (existingPosition) {
    const sold = event.args.tokensIn;
    const prevAmount = existingPosition.zapTokenAmount;
    const prevCost = existingPosition.costBasisUsdc;
    let nextAmount: bigint;
    let nextCost: bigint;
    if (prevAmount > 0n && sold < prevAmount) {
      const reduction = (prevCost * sold) / prevAmount;
      nextAmount = prevAmount - sold;
      nextCost = prevCost > reduction ? prevCost - reduction : 0n;
    } else {
      nextAmount = 0n;
      nextCost = 0n;
    }
    await db.update(walletPosition, { id: positionId }).set({
      zapTokenAmount: nextAmount,
      costBasisUsdc: nextCost,
    });
  }

  // MAINTAIN_TOKEN_HOURLY — see Zap:Buy for the rationale; identical
  // block — keep in sync.
  {
    const sellTimestamp = BigInt(event.block.timestamp);
    const sellHourStartTm = (sellTimestamp / SECONDS_PER_HOUR) * SECONDS_PER_HOUR;
    const sellHourlyId = `${event.args.token}-${sellHourStartTm}`;

    const existingTokenHourly = await db.find(tokenHourlyMetrics, {
      id: sellHourlyId,
    });
    if (existingTokenHourly) {
      await db.update(tokenHourlyMetrics, { id: sellHourlyId }).set({
        volumeUsd: existingTokenHourly.volumeUsd + event.args.usdcOut,
        tradeCount: existingTokenHourly.tradeCount + 1,
      });
    } else {
      // See Zap:Buy for the `onConflictDoNothing` rationale.
      await db
        .insert(tokenHourlyMetrics)
        .values({
          id: sellHourlyId,
          tokenAddress: event.args.token,
          hourStart: sellHourStartTm,
          volumeUsd: event.args.usdcOut,
          tradeCount: 1,
        })
        .onConflictDoNothing();
    }
  }

  // Trade-list broadcast — see Buy handler for rationale, including the
  // `tokenSymbol` / `tokenName` enrichment that lets the web feed render
  // the symbol on the first trade for a freshly-deployed token without
  // racing the indexer's GraphQL checkpoint (issue #703).
  if (isLiveEvent(event.block.timestamp)) {
    broadcastEvent({
      event: "trade",
      tokenAddress: event.args.token,
      data: {
        id: tradeId,
        tokenAddress: event.args.token,
        trader: event.args.seller,
        isBuy: false,
        tokenAmount: event.args.tokensIn.toString(),
        usdcAmount: event.args.usdcOut.toString(),
        timestamp: event.block.timestamp.toString(),
        tokenSymbol: tokenLabelOrUndefined(current?.symbol),
        tokenName: tokenLabelOrUndefined(current?.name),
      },
    });
  }
});

ponder.on("Zap:Referred", async ({ event, context }) => {
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

ponder.on("Token:Transfer", async ({ event, context }) => {
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
