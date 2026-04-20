import type { tokens } from "../db/schema.js";

/** Total initial supply (1B × 1e18). */
const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
/** 75% of total supply is sold on the bonding curve; 25% reserved for LP. */
const CURVE_ALLOCATION = (TOTAL_SUPPLY * 75n) / 100n;
/** USD trigger for graduation (matches `Bonding.GRADUATION_THRESHOLD_USD`). */
const GRADUATION_THRESHOLD_USD = 12_000;

export type DbToken = typeof tokens.$inferSelect;

export type TokenStatus = "curve" | "graduating" | "graduated";

/**
 * Compute curve-filled percentage (0–100) from the remaining curve supply. Null
 * when the indexer is unavailable — callers should render this as an unknown
 * state rather than "0%".
 */
export function computeCurveFilled(
  curveSupplyRaw: string | null | undefined,
): number | null {
  if (curveSupplyRaw === null || curveSupplyRaw === undefined) return null;
  const remaining = BigInt(curveSupplyRaw);
  if (remaining >= CURVE_ALLOCATION) return 0;
  const sold = CURVE_ALLOCATION - remaining;
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
 */
export function computeCurveFilledBreakdown(
  curveSupplyRaw: string | null | undefined,
  ltReserveRaw: string | null | undefined,
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

  // Without an LT rate we can't turn `ltReserve` into USD, so we can't
  // compute the boost. Fall back to showing supply-filled with no split.
  if (
    ltReserveRaw === undefined ||
    ltReserveRaw === null ||
    ltExchangeRate === undefined ||
    ltExchangeRate === null ||
    ltExchangeRate <= 0
  ) {
    return { total: supplyFilled, organic: null, leverageBoost: null };
  }

  // Current USD value of LT sitting in the curve. Pair starts with a virtual
  // reserve (no real LT at launch), so this is effectively "USD raised" at
  // current LT prices — the same number that `Bonding.canGraduate` compares
  // against the $12K threshold.
  const ltReserve = Number(BigInt(ltReserveRaw)) / 1e18;
  const usdRaisedNow = ltReserve * ltExchangeRate;
  const usdFilled = (usdRaisedNow / GRADUATION_THRESHOLD_USD) * 100;

  const total = Math.min(Math.max(supplyFilled, usdFilled), 100);

  const organicUsd =
    organicUsdcRaisedRaw === undefined || organicUsdcRaisedRaw === null
      ? 0
      : Number(BigInt(organicUsdcRaisedRaw)) / 1e6;
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
