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
}
