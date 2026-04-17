import type { tokens } from "../db/schema.js";

/** Total initial supply (1B × 1e18). */
const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
/** 75% of total supply is sold on the bonding curve; 25% reserved for LP. */
const CURVE_ALLOCATION = (TOTAL_SUPPLY * 75n) / 100n;

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
  graduated: boolean;
  graduatedAt: string | null;
  bondingPair: string | null;
  hyperswapPair: string | null;
  priceUsd: number | null;
  mcapUsd: number | null;
  change24h: number | null;
}
