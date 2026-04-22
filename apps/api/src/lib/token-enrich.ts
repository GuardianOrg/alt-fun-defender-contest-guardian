import type { tokens } from "../db/schema.js";

/** Total initial supply (1B × 1e18). */
const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
/** 75% of total supply is sold on the bonding curve; 25% reserved for LP. */
const CURVE_ALLOCATION = (TOTAL_SUPPLY * 75n) / 100n;
/**
 * Post-sellout virtual reserve0 floor (`TOTAL_SUPPLY − CURVE_ALLOCATION`,
 * = 250M × 1e18). Also the 25% LP reserve used for dynamic LP seeding.
 * See `packages/contracts/src/Bonding.sol` natspec on virtual reserves.
 */
const LP_RESERVE_RAW = TOTAL_SUPPLY - CURVE_ALLOCATION;
/** USD trigger for graduation (matches `Bonding.GRADUATION_THRESHOLD_USD`). */
const GRADUATION_THRESHOLD_USD = 12_000;

export type DbToken = typeof tokens.$inferSelect;

export type TokenStatus = "curve" | "graduating" | "graduated";

/**
 * Compute curve-filled percentage (0–100) from the **virtual** `reserve0` that
 * the indexer persists (= `IFPair.getReserves()[0]` from `Bonding.Trade`).
 *
 * Under the dynamic-LP design, virtual `reserve0` is initialised to the full
 * `TOTAL_SUPPLY` (1B) while only `CURVE_ALLOCATION` (750M) real tokens are
 * transferred to the pair. As curve tokens are sold, `reserve0` drops 1:1 with
 * the real balance (FPair.swap is symmetric on virtual vs real amounts), so
 * `reserve0` floors at `LP_RESERVE_RAW = 250M` at full sellout. We can recover
 * the real on-curve supply as `max(0, reserve0 − LP_RESERVE_RAW)`.
 *
 * Returns `null` when the indexer is unavailable — render as "unknown", not
 * "0%".
 */
export function computeCurveFilled(
  curveSupplyRaw: string | null | undefined,
): number | null {
  if (curveSupplyRaw === null || curveSupplyRaw === undefined) return null;
  const virtualReserve0 = BigInt(curveSupplyRaw);
  const realRemaining =
    virtualReserve0 > LP_RESERVE_RAW ? virtualReserve0 - LP_RESERVE_RAW : 0n;
  if (realRemaining >= CURVE_ALLOCATION) return 0;
  const sold = CURVE_ALLOCATION - realRemaining;
  return Math.min(Number((sold * 10000n) / CURVE_ALLOCATION) / 100, 100);
}

export interface CurveFilledBreakdown {
  /** Headline progress toward graduation (0–100). `null` when indexer is down. */
  total: number | null;
  /**
   * Share of `total` attributable to real USDC the curve has received via
   * `LaunchpadRouter`. `null` when the breakdown can't be computed (indexer
   * down or no exchange-rate data).
   */
  organic: number | null;
  /**
   * Share of `total` attributable to LT price appreciation since those buys.
   * Clamped at 0 — if the LT has *lost* value we just show the total and
   * don't surface a negative bucket in the UI (by product decision — it's a
   * marketing number showcasing the LT boost, not an accounting figure).
   */
  leverageBoost: number | null;
}

/**
 * Decompose the graduation progress bar into "organic USD raised" vs "LT
 * price appreciation". Both are percentages of the $12K USD graduation
 * threshold and always sum to ≤ `total`. Used by the tokens list + detail
 * endpoints to power the split progress bar on the landing page.
 *
 * The `total` we return is `max(supplyFilled, usdFilled)` — whichever trigger
 * is closer to firing — since graduation happens on whichever hits first. For
 * the split we use `usdFilled` as the denominator and clamp to `total` so the
 * two buckets never overshoot the headline number (which would look wrong in
 * the UI).
 *
 * Virtual vs real reserves: `curveSupplyRaw` and `ltReserveRaw` are the AMM's
 * **virtual** reserves (what the constant-product math uses, needed unmodified
 * for chart pricing). For USD raised we need the **real** LT balance that
 * matches `IFPair.assetBalance()` on-chain — i.e. what `Bonding.canGraduate`
 * compares against the $12K threshold. We recover it by subtracting the
 * launch-time virtual LT reserve (`virtualLtAtLaunch = k / TOTAL_SUPPLY`)
 * from the current virtual `reserve1`. Without `k` we can't do that subtraction
 * and would overcount by the initial $4K virtual liquidity, so we degrade
 * cleanly to supply-only progress.
 */
export function computeCurveFilledBreakdown(
  curveSupplyRaw: string | null | undefined,
  ltReserveRaw: string | null | undefined,
  kRaw: string | null | undefined,
  organicUsdcRaisedRaw: string | null | undefined,
  ltExchangeRate: number | null | undefined,
  graduated: boolean,
): CurveFilledBreakdown {
  const supplyFilled = computeCurveFilled(curveSupplyRaw);

  if (graduated) {
    return { total: 100, organic: null, leverageBoost: null };
  }

  if (supplyFilled === null) {
    return { total: null, organic: null, leverageBoost: null };
  }

  // Without an LT rate or `k` we can't turn `ltReserve` into *real* USD
  // raised, so we can't compute the USD trigger. Fall back to supply-only.
  if (
    ltReserveRaw === undefined ||
    ltReserveRaw === null ||
    kRaw === undefined ||
    kRaw === null ||
    ltExchangeRate === undefined ||
    ltExchangeRate === null ||
    ltExchangeRate <= 0
  ) {
    return { total: supplyFilled, organic: null, leverageBoost: null };
  }

  // Recover real LT balance from the virtual reserve1. At mint,
  //   k = TOTAL_SUPPLY × virtualLtAtLaunch   (`FPair.mint`, see Bonding.sol)
  // so `virtualLtAtLaunch = k / TOTAL_SUPPLY`. Real LT flowing in via buys
  // bumps both reserve1 and assetBalance() by the same amount, so
  //   realLt = reserve1 − virtualLtAtLaunch.
  // Clamp at 0 to be defensive against rounding in edge conditions.
  const virtualReserve1 = BigInt(ltReserveRaw);
  const k = BigInt(kRaw);
  const virtualLtAtLaunch = k / TOTAL_SUPPLY;
  const realLtRaw =
    virtualReserve1 > virtualLtAtLaunch
      ? virtualReserve1 - virtualLtAtLaunch
      : 0n;
  const realLt = Number(realLtRaw) / 1e18;
  const usdRaisedNow = realLt * ltExchangeRate;
  const usdFilled = (usdRaisedNow / GRADUATION_THRESHOLD_USD) * 100;

  const total = Math.min(Math.max(supplyFilled, usdFilled), 100);

  // Missing organic counter => don't invent a split. Returning `0` here would
  // silently render the bar as 100% leverage boost, which is a lie (and
  // contradicts the doc on `CurveFilledBreakdown`). Frontend treats `null` as
  // "unknown" and falls back to a single solid fill — that's the honest UI.
  if (organicUsdcRaisedRaw === undefined || organicUsdcRaisedRaw === null) {
    return { total, organic: null, leverageBoost: null };
  }

  const organicUsd = Number(BigInt(organicUsdcRaisedRaw)) / 1e6;
  const organicPct = (organicUsd / GRADUATION_THRESHOLD_USD) * 100;

  const organic = Math.min(Math.max(organicPct, 0), total);
  const leverageBoost = Math.max(total - organic, 0);

  return { total, organic, leverageBoost };
}

/**
 * Derive the lifecycle status. Graduation wins. Once ≥90% of the curve is
 * filled we surface "graduating" even if the DB still shows "curve".
 */
export function computeStatus(
  dbStatus: string,
  graduated: boolean,
  curveFilled: number | null,
): TokenStatus {
  if (graduated || dbStatus === "graduated") return "graduated";
  if (curveFilled !== null && curveFilled >= 90) return "graduating";
  if (dbStatus === "graduating") return "graduating";
  return "curve";
}

/**
 * Final shape returned by `GET /api/v1/tokens` and `GET /api/v1/tokens/:addr`.
 * Everything the webapp needs to render a token card or detail page without
 * touching Ponder or BounceTech directly.
 */
export interface EnrichedToken
  extends Omit<DbToken, "graduatedAt" | "createdAt" | "status"> {
  createdAt: string;
  status: TokenStatus;
  curveSupply: string | null;
  ltReserve: string | null;
  curveFilled: number | null;
  /**
   * Percent of the $12K graduation threshold that came from organic USDC
   * buys (clamped at `curveFilled`). `null` when the indexer/BounceTech are
   * degraded or the token is graduated.
   */
  curveFilledOrganic: number | null;
  /**
   * Percent of the $12K graduation threshold that came from LT price
   * appreciation since those buys. `null` when unknown, clamped at 0 when
   * the LT has dropped (marketing number — we don't surface a negative
   * contribution).
   */
  curveFilledLeverageBoost: number | null;
  graduated: boolean;
  graduatedAt: string | null;
  bondingPair: string | null;
  hyperswapPair: string | null;
  priceUsd: number | null;
  mcapUsd: number | null;
  change24h: number | null;
  /**
   * 24h percentage change of the backing LT's exchange rate. Primary
   * signal for the LT MOVERS tab on the landing page. `null` when
   * BounceTech can't give us a rate at either end of the window.
   */
  ltChange24h: number | null;
  /**
   * Sum of USDC (6dp → USD) traded through `LaunchpadRouter` in the last 24h
   * for this token (buys + sells). `null` when the indexer is unavailable,
   * `0` when the token has simply had no trades in the window — callers must
   * distinguish the two (null == unknown, 0 == legitimately quiet).
   */
  volume24hUsd: number | null;
  /**
   * Lifetime gross USD routed through `LaunchpadRouter` for this token
   * (buys + sells, never subtracts). Sourced from the indexer's running
   * counter (`token.volumeUsd`), so it survives pagination truncation that
   * can force `volume24hUsd` to null. `null` only when the indexer is
   * completely unreachable; `0` for a token that has never traded.
   */
  totalVolumeUsd: number | null;
  /**
   * ISO timestamp of the most recent `LaunchpadRouter` trade for this token
   * within the 24h lookback window. `null` means either no trades in the
   * window or indexer unavailable — use in conjunction with
   * `volume24hUsd` to disambiguate.
   */
  lastTradeAt: string | null;
}

/**
 * Compute a trending score from the signals every token already exposes.
 * Deliberately simple and deterministic — no ML, no historical state
 * outside the 24h change + volume window we already compute. Higher is
 * more trending. Callers sort descending and tie-break on mcap.
 *
 * Components (see README / TODO.md trending entry for the rationale):
 *
 *   1. `change24h`  — primary signal (percent, can be negative)
 *   2. Volume term  — `15 * log10(volume + 1)`. Log-dampened so a single
 *                     whale buy doesn't drown out broad activity.
 *   3. Mcap term    — `3 * log10(mcap + 1)`. Small nudge: among two
 *                     otherwise equivalent tokens, the bigger market wins.
 *                     Worth ~6 points per order of magnitude.
 *   4. Freshness    — +20 at launch, decays linearly to 0 at 24h. Gives
 *                     new tokens oxygen to surface before they've
 *                     accumulated history.
 *   5. Recency      — +10 if traded <1h ago, +5 if <6h, else 0. Tokens
 *                     that are actively trading right now beat tokens
 *                     that traded a while back with the same 24h stats.
 *   6. Dead penalty — −1000 if no trade within 24h AND older than 7 days.
 *                     Prevents ancient quiet tokens from leaking into
 *                     trending on pure LT-rate drift.
 *
 * `null` inputs are treated as 0 / "unknown, assumed quiet" rather than
 * as missing data — the sort needs a total order and punting a token to
 * "unknown" for any degraded signal would collapse the whole list when
 * BounceTech blips.
 */
/**
 * Filter + sort the LT MOVERS list. Primary order is the backing LT's own
 * 24h % change (descending, so the biggest LT movers come first); ties
 * break on the token's own 24h change (descending), so among tokens on
 * the same pumping LT the ones also getting buy-side action win.
 *
 * Excluded:
 *   - null `ltChange24h` or null `change24h` — we need a total order and
 *     "unknown" shouldn't leapfrog priced entries.
 *   - non-positive `ltChange24h` — LT MOVERS is a leaderboard, a flat or
 *     falling LT isn't moving *up*.
 *   - non-positive `change24h` — the user explicitly asked that a token
 *     with 24h losses not show in the movers list, however much the LT
 *     is pumping; protects against stale short LTs etc.
 */
export function sortLtMovers<
  T extends { ltChange24h: number | null; change24h: number | null },
>(items: T[]): T[] {
  return items
    .filter(
      (t) =>
        t.ltChange24h !== null &&
        t.ltChange24h > 0 &&
        t.change24h !== null &&
        t.change24h > 0,
    )
    .sort((a, b) => {
      const ltDelta = (b.ltChange24h ?? 0) - (a.ltChange24h ?? 0);
      if (ltDelta !== 0) return ltDelta;
      return (b.change24h ?? 0) - (a.change24h ?? 0);
    });
}

export function computeTrendingScore(
  inputs: {
    change24h: number | null;
    volume24hUsd: number | null;
    mcapUsd: number | null;
    /** Unix seconds — token creation / launch timestamp. */
    createdAtSec: number;
    /** Unix seconds — most recent router trade, or null if none in window. */
    lastTradeAtSec: number | null;
    /** Unix seconds — current time (injected for test determinism). */
    nowSec: number;
  },
): number {
  const {
    change24h,
    volume24hUsd,
    mcapUsd,
    createdAtSec,
    lastTradeAtSec,
    nowSec,
  } = inputs;

  const change = change24h ?? 0;
  const volume = Math.max(0, volume24hUsd ?? 0);
  const mcap = Math.max(0, mcapUsd ?? 0);
  const ageHours = Math.max(0, (nowSec - createdAtSec) / 3600);
  const lastTradeHours = lastTradeAtSec === null
    ? Number.POSITIVE_INFINITY
    : Math.max(0, (nowSec - lastTradeAtSec) / 3600);

  const volumeTerm = 15 * Math.log10(volume + 1);
  const mcapTerm = 3 * Math.log10(mcap + 1);

  const freshnessBonus = ageHours < 24 ? 20 * (1 - ageHours / 24) : 0;

  const recencyBonus =
    lastTradeHours < 1 ? 10 : lastTradeHours < 6 ? 5 : 0;

  const deadPenalty =
    lastTradeHours > 24 && ageHours > 24 * 7 ? -1000 : 0;

  return (
    change +
    volumeTerm +
    mcapTerm +
    freshnessBonus +
    recencyBonus +
    deadPenalty
  );
}
