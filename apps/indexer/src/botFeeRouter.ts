import { ponder } from "ponder:registry";

import {
  botRouterTrade,
  botReferrerTrader,
  referrerStats,
  token,
  walletBotPosition,
} from "ponder:schema";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const lower = (addr: string): string => addr.toLowerCase();

/**
 * Implied per-token price from a single router trade, in USDC 6dp per
 * token 18dp-wei. Used to refresh `walletBotPosition.currentValueUsdc`
 * on every trade for the (wallet, token). Returns 0 when the trade
 * carries no tokens — `tokenBalance = 0` rows always show value 0 too,
 * so the calling site clamps that case before this is invoked.
 */
function impliedValueUsdc(
  tokenBalance: bigint,
  usdcAmount: bigint,
  tokenAmount: bigint,
): bigint {
  if (tokenBalance <= 0n || tokenAmount <= 0n) return 0n;
  return (tokenBalance * usdcAmount) / tokenAmount;
}

/**
 * `BotFeeRouter.BotRouterTrade` handler. Source-of-truth event for the
 * bot's `/positions` and `/referral` surfaces.
 *
 * Per-trade writes:
 *  1. Append a `botRouterTrade` row (raw event archive).
 *  2. Upsert `walletBotPosition` for `(trader, token)`. Buys add to
 *     `tokenBalance` + `costBasisUsdc` + `totalCostUsdc`. Sells reduce
 *     `tokenBalance` and proportionally reduce `costBasisUsdc`, bank
 *     `realisedPnlUsdc` against the average-cost math, and bump
 *     `totalProceedsUsdc`. Matches the cost-basis semantics on
 *     `walletPosition` (web app /portfolio), extended with the
 *     realised columns the bot's view needs.
 *  3. Refresh `currentValueUsdc` from the latest trade's implied price.
 *     Stale between trades — the bot positions view is documented as a
 *     snapshot, not a live mark. Acceptable for v1; a follow-up that
 *     refreshes on every token's price tick would write here too.
 *  4. Update `referrerStats` when the trade had a referrer. Count
 *     distinct trader wallets via the `botReferrerTrader` helper table
 *     and surface the bad-rewards-wallet fallback (referrer set but
 *     `referrerCut = 0`) as `badPaymentCount` so the bot can banner
 *     the referrer.
 */
ponder.on("BotFeeRouter:BotRouterTrade", async ({ event, context }) => {
  const { db } = context;
  const id = `${event.transaction.hash}-${event.log.logIndex}`;
  const isBuy = event.args.side === 0;

  await db
    .insert(botRouterTrade)
    .values({
      id,
      tokenAddress: event.args.token,
      trader: event.args.trader,
      isBuy,
      usdcAmount: event.args.usdcAmount,
      tokenAmount: event.args.tokenAmount,
      botFee: event.args.botFee,
      referrer: event.args.referrer,
      referrerCut: event.args.referrerCut,
      treasuryCut: event.args.treasuryCut,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();

  // Look up ticker so positions answer with a single GraphQL query.
  const tokenRow = await db.find(token, { address: event.args.token });
  const ticker = tokenRow?.symbol ?? "";

  const positionId = `${lower(event.args.trader)}-${lower(event.args.token)}`;
  const existing = await db.find(walletBotPosition, { id: positionId });

  if (isBuy) {
    const prevBalance = existing?.tokenBalance ?? 0n;
    const prevCost = existing?.costBasisUsdc ?? 0n;
    const nextBalance = prevBalance + event.args.tokenAmount;
    const nextCost = prevCost + event.args.usdcAmount;
    const value = impliedValueUsdc(
      nextBalance,
      event.args.usdcAmount,
      event.args.tokenAmount,
    );
    if (existing) {
      await db.update(walletBotPosition, { id: positionId }).set({
        ticker: ticker !== "" ? ticker : existing.ticker,
        tokenBalance: nextBalance,
        costBasisUsdc: nextCost,
        currentValueUsdc: value,
        totalCostUsdc: existing.totalCostUsdc + event.args.usdcAmount,
      });
    } else {
      await db
        .insert(walletBotPosition)
        .values({
          id: positionId,
          wallet: event.args.trader,
          token: event.args.token,
          ticker,
          tokenBalance: nextBalance,
          costBasisUsdc: nextCost,
          currentValueUsdc: value,
          realisedPnlUsdc: 0n,
          totalCostUsdc: event.args.usdcAmount,
          totalProceedsUsdc: 0n,
        })
        .onConflictDoNothing();
    }
  } else if (existing) {
    // Sell: average-cost accounting on partial sells. Matches the
    // historical /portfolio math the web app already used so PnL is
    // consistent across bot + web for users on both surfaces.
    const sold = event.args.tokenAmount;
    const prevBalance = existing.tokenBalance;
    const prevCost = existing.costBasisUsdc;
    let nextBalance: bigint;
    let nextCost: bigint;
    let realisedCost: bigint;
    if (prevBalance > 0n && sold < prevBalance) {
      realisedCost = (prevCost * sold) / prevBalance;
      nextBalance = prevBalance - sold;
      nextCost = prevCost > realisedCost ? prevCost - realisedCost : 0n;
    } else {
      // Selling >= held: realise the entire remaining cost basis and
      // zero the position. Tokens sold in excess of the router-tracked
      // balance (e.g. tokens received via direct Transfer then sold via
      // the bot) have zero implicit cost basis — same convention as
      // `walletPosition`.
      realisedCost = prevCost;
      nextBalance = 0n;
      nextCost = 0n;
    }
    const proceeds = event.args.usdcAmount;
    const realisedDelta = proceeds - realisedCost;
    const value = impliedValueUsdc(nextBalance, proceeds, sold);
    await db.update(walletBotPosition, { id: positionId }).set({
      ticker: ticker !== "" ? ticker : existing.ticker,
      tokenBalance: nextBalance,
      costBasisUsdc: nextCost,
      currentValueUsdc: value,
      realisedPnlUsdc: existing.realisedPnlUsdc + realisedDelta,
      totalProceedsUsdc: existing.totalProceedsUsdc + proceeds,
    });
  } else {
    // A sell with no prior position row (the wallet received the
    // tokens via direct Transfer / airdrop and sold them via the bot
    // router). Realised cost basis is zero; full proceeds are pure
    // realised PnL. Same convention as `walletPosition`.
    await db
      .insert(walletBotPosition)
      .values({
        id: positionId,
        wallet: event.args.trader,
        token: event.args.token,
        ticker,
        tokenBalance: 0n,
        costBasisUsdc: 0n,
        currentValueUsdc: 0n,
        realisedPnlUsdc: event.args.usdcAmount,
        totalCostUsdc: 0n,
        totalProceedsUsdc: event.args.usdcAmount,
      })
      .onConflictDoNothing();
  }

  // Referrer accounting. Indexer counts only what's observable on
  // chain: distinct attributed traders and bad-rewards-wallet fallback
  // trades. `lifetimeEarnedUsdc` is updated by the `ReferralPaid`
  // handler (transfer-confirmed only).
  if (event.args.referrer !== ZERO_ADDRESS) {
    const referrerLower = lower(event.args.referrer);
    const traderLower = lower(event.args.trader);
    const attributionId = `${referrerLower}-${traderLower}`;

    const seenTrader = await db.find(botReferrerTrader, { id: attributionId });
    const isFirstTimeReferred = !seenTrader;
    if (isFirstTimeReferred) {
      await db
        .insert(botReferrerTrader)
        .values({
          id: attributionId,
          referrer: event.args.referrer,
          trader: event.args.trader,
        })
        .onConflictDoNothing();
    }

    const isBadPayment = event.args.referrerCut === 0n;
    const referrerStatsRow = await db.find(referrerStats, {
      id: referrerLower,
    });
    if (referrerStatsRow) {
      await db.update(referrerStats, { id: referrerLower }).set({
        referredCount:
          referrerStatsRow.referredCount + (isFirstTimeReferred ? 1 : 0),
        badPaymentCount:
          referrerStatsRow.badPaymentCount + (isBadPayment ? 1 : 0),
      });
    } else {
      await db
        .insert(referrerStats)
        .values({
          id: referrerLower,
          referrer: event.args.referrer,
          referredCount: isFirstTimeReferred ? 1 : 0,
          lifetimeEarnedUsdc: 0n,
          badPaymentCount: isBadPayment ? 1 : 0,
          attributionLossCount: 0,
        })
        .onConflictDoNothing();
    }
  }
});

/**
 * `BotFeeRouter.ReferralPaid` handler. Emitted only when the USDC
 * transfer to the referrer's rewards wallet succeeded, so this is the
 * authoritative source for `referrerStats.lifetimeEarnedUsdc`. A
 * `BotRouterTrade` with `referrerCut > 0` always co-fires with a
 * matching `ReferralPaid` in the same tx (the router emits both inside
 * `_splitAndPay`), so the two handlers stay consistent without
 * cross-referencing.
 */
ponder.on("BotFeeRouter:ReferralPaid", async ({ event, context }) => {
  const { db } = context;
  const referrerLower = lower(event.args.referrer);
  const existing = await db.find(referrerStats, { id: referrerLower });
  if (existing) {
    await db.update(referrerStats, { id: referrerLower }).set({
      lifetimeEarnedUsdc: existing.lifetimeEarnedUsdc + event.args.amount,
    });
  } else {
    // First payout to this referrer that bypassed the `BotRouterTrade`
    // bootstrap path (shouldn't happen — both events fire from the
    // same `_splitAndPay`, with `BotRouterTrade` emitted at the higher
    // log index). Insert the row with the earnings recorded so the
    // counter never drops below the chain's truth.
    await db
      .insert(referrerStats)
      .values({
        id: referrerLower,
        referrer: event.args.referrer,
        referredCount: 0,
        lifetimeEarnedUsdc: event.args.amount,
        badPaymentCount: 0,
        attributionLossCount: 0,
      })
      .onConflictDoNothing();
  }
});
