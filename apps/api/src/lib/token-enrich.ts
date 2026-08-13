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

export type DbToken = typeof tokens.$inferSelect;

export type TokenStatus = "curve" | "graduating" | "graduated";

/**
 * Convert a raw USDC amount (6dp fixed-point, as the indexer persists it)
 * into a USD float.
 *
 * Naive `Number(BigInt(raw)) / 1e6` silently loses precision once `raw`
 * exceeds `Number.MAX_SAFE_INTEGER` (= 2^53 − 1 ≈ 9.0e15), which for a 6dp
 * USDC counter corresponds to ~$9 trillion of lifetime volume. That's well
 * outside anything we'd realistically see, but `volumeUsd` is an
 * ever-increasing lifetime counter, so defending against it is cheap
 * insurance.
 *
 * We split the fixed-point value into a whole-dollar `bigint` and a
 * sub-dollar remainder before casting, which pushes the precision ceiling
 * to 2^53 *dollars* (~$9 quadrillion) — enough that the number will always
 * fit long before the counter ever got there. The `remainder` branch is
 * always < 1e6 and always safe.
 *
 * Returns `null` for null/undefined inputs so callers can distinguish
 * "indexer said 0" from "indexer had no value to report".
 */
export function usdcRawToUsd(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const raw6dp = BigInt(raw);
  const dollars = raw6dp / 1_000_000n;
  const micros = raw6dp % 1_000_000n;
  return Number(dollars) + Number(micros) / 1e6;
}

/**
 * Compute curve-filled percentage (0–100) from the **virtual** `reserve0` that
 * the indexer persists (= `IPair.getReserves()[0]` from `Bonding.Trade`).
 *
 * Under the dynamic-LP design, virtual `reserve0` is initialised to the full
 * `TOTAL_SUPPLY` (1B) while only `CURVE_ALLOCATION` (750M) real tokens are
 * transferred to the pair. As curve tokens are sold, `reserve0` drops 1:1 with
 * the real balance (Pair.swap is symmetric on virtual vs real amounts), so
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
   * `Zap`. `null` when the breakdown can't be computed (indexer
   * down or no exchange-rate data).
   */
  organic: number | null;
  /**
   * Share of `total` attributable to LT price appreciation since those buys.
   * Computed as `max(0, total − organic)` — i.e. the gap between
   * `realLt × currentRate` (already encoded in `total = usdFilled`) and the
   * **net** organic USDC raised (indexer's `organicUsdcRaised`, where buys
   * add and sells subtract, floored at 0). Clamped at 0 — if the LT has
   * *lost* value we just show the total and don't surface a negative bucket
   * (by product decision — it's a marketing number showcasing the LT boost,
   * not an accounting figure).
   */
  leverageBoost: number | null;
  /**
   * Live USD value of the curve's real LT reserve (`realLt × currentRate`).
   * This is the numerator behind `total` (= `raisedUsd / threshold × 100`),
   * surfaced separately so the curve-strip UI can render the absolute "we've
   * raised $X of $Y" number alongside the percentage bar without redoing the
   * virtual→real reserve subtraction client-side. `null` when the breakdown
   * is degraded (indexer down, no `k`, or no LT exchange rate).
   */
  raisedUsd: number | null;
}

/**
 * Decompose the graduation progress bar into "organic USD raised" vs "LT
 * price appreciation". Both are percentages of the live USD graduation
 * threshold (set once at `Bonding.initialize` and read by the route handler
 * from `protocol-config.getGraduationThresholdUsd`, threaded in here as
 * `graduationThresholdUsd`) and always sum to ≤ `total`.
 * Used by the tokens list + detail endpoints to power the split progress bar
 * on the landing page.
 *
 * **`total = clamp(usdFilled, 0, 100)`**, where `usdFilled = realLt × rate /
 * threshold × 100`. This is the framing users actually think in: "we need
 * `$X` raised, we've raised `$Y`, so we're `Y/X` of the way there."
 *
 * The supply trigger (curve sells out → graduation fires regardless of USD)
 * is a bear-market backstop, not the natural progress framing — under the
 * constant-product AMM with the current `VIRTUAL_LIQUIDITY_USD : threshold`
 * ratio, supply-% systematically *leads* USD-% throughout most of the
 * curve, so using `max(supplyFilled, usdFilled)` (the previous formulation)
 * made small fresh-mint buys look ~3× further along than they actually are.
 * `supplyFilled` is still computed and exported as `curveFilled` on the
 * single-supply-fallback path (when `k` / rate / `ltReserve` are missing),
 * so the bar stays populated when the indexer or BounceTech is degraded.
 *
 * Split (with `total = usdFilled`, no rescaling needed):
 *   - `organic       = min(organicPct, usdFilled)` — clamped so a late-life
 *                      LT crash that drove `usdFilled` below `organicPct`
 *                      reads as all-organic, not negative-leverage.
 *   - `leverageBoost = max(0, usdFilled − organicPct)` — the appreciation
 *                      premium between user-paid USDC and the curve's
 *                      current USD value. Always ≥ 0 by product decision.
 *
 * Virtual vs real reserves: `curveSupplyRaw` and `ltReserveRaw` are the AMM's
 * **virtual** reserves (what the constant-product math uses, needed unmodified
 * for chart pricing). For USD raised we need the **real** LT balance that
 * matches `IPair.assetBalance()` on-chain — i.e. what `Bonding.canGraduate`
 * compares against `graduationThresholdUsd`. We recover it by subtracting the
 * launch-time virtual LT reserve (`virtualLtAtLaunch = k / TOTAL_SUPPLY`)
 * from the current virtual `reserve1`. Without `k` we can't do that subtraction
 * and would overcount by the initial virtual liquidity, so we degrade
 * cleanly to supply-only progress.
 */
export function computeCurveFilledBreakdown(
  curveSupplyRaw: string | null | undefined,
  ltReserveRaw: string | null | undefined,
  kRaw: string | null | undefined,
  organicUsdcRaisedRaw: string | null | undefined,
  ltExchangeRate: number | null | undefined,
  graduated: boolean,
  graduationThresholdUsd: number,
): CurveFilledBreakdown {
  const supplyFilled = computeCurveFilled(curveSupplyRaw);

  if (graduated) {
    return { total: 100, organic: null, leverageBoost: null, raisedUsd: null };
  }

  if (supplyFilled === null) {
    return { total: null, organic: null, leverageBoost: null, raisedUsd: null };
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
    return {
      total: supplyFilled,
      organic: null,
      leverageBoost: null,
      raisedUsd: null,
    };
  }

  // Recover real LT balance from the virtual reserve1. At mint,
  //   k = TOTAL_SUPPLY × virtualLtAtLaunch   (`Pair.mint`, see Bonding.sol)
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
  const usdFilled = (usdRaisedNow / graduationThresholdUsd) * 100;

  // USD-denominated headline. See function docstring on why the supply
  // trigger doesn't influence `total` — the constant-product AMM makes
  // supply-% lead USD-% throughout most of the curve, so using `max()` made
  // fresh tokens look multiples further along than the user-paid dollars
  // actually represent. `supplyFilled` is preserved on the fallback path
  // above so the bar stays populated when USD progress is uncomputable.
  const total = Math.min(Math.max(usdFilled, 0), 100);

  // Missing organic counter => don't invent a split. Returning `0` here would
  // silently render the bar as 100% leverage boost, which is a lie (and
  // contradicts the doc on `CurveFilledBreakdown`). Frontend treats `null` as
  // "unknown" and falls back to a single solid fill — that's the honest UI.
  // `raisedUsd` is still meaningful here (it's just `realLt × rate`) so we
  // surface it for the curve-strip "$X raised" label even when the split is
  // unknown.
  if (organicUsdcRaisedRaw === undefined || organicUsdcRaisedRaw === null) {
    return {
      total,
      organic: null,
      leverageBoost: null,
      raisedUsd: usdRaisedNow,
    };
  }

  const organicUsd = Number(BigInt(organicUsdcRaisedRaw)) / 1e6;
  const organicPct = (organicUsd / graduationThresholdUsd) * 100;

  // With `total = usdFilled` no rescaling is needed: the USD headline IS the
  // sum of "organic dollars in" and "LT appreciation since". `organic` is
  // clamped to `total` so a late-life LT crash that drove `usdFilled` below
  // `organicPct` reads as all-organic (not negative-leverage); leverage
  // floors at 0 by product decision (marketing number, not accounting).
  const organic = Math.min(Math.max(organicPct, 0), total);
  const leverageBoost = Math.max(0, total - organic);

  return { total, organic, leverageBoost, raisedUsd: usdRaisedNow };
}

/**
 * Derive the lifecycle status. The contract's two-phase graduation flow is
 * the single source of truth:
 *   - `pendingGraduation === true` → `Bonding.TokenGraduating` fired but
 *     `TokenGraduated` hasn't yet (the keeper is about to call
 *     `finalizeGraduation`). Trades revert with `TokenIsGraduating`. UI
 *     shows the "Token is graduating, no buys or sells allowed" overlay.
 *   - `graduated === true` → `Bonding.TokenGraduated` fired; LP locked,
 *     post-grad trading on HyperSwap.
 *   - else → `"curve"` (the active bonding-curve phase).
 *
 * The previous heuristic ("≥90% curve filled means graduating") was dropped
 * because it conflated a *progress* signal with a *contract-frozen* signal —
 * those should now mean different things in the UI.
 */
export function computeStatus(
  graduated: boolean,
  pendingGraduation: boolean,
): TokenStatus {
  if (graduated) return "graduated";
  if (pendingGraduation) return "graduating";
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
  /**
   * BounceTech has mint-paused this token's LT. Buys revert; sells still
   * work. Catalogue rows omit paused LTs entirely; detail sets this so
   * holders and deep links can disable buy without a second directory fetch.
   */
  mintPaused?: boolean;
  curveSupply: string | null;
  ltReserve: string | null;
  curveFilled: number | null;
  /**
   * Percent of the USD graduation threshold (`Bonding.graduationThresholdUsd`,
   * set once at proxy initialisation; production = $9K) that came from
   * organic USDC buys (clamped at `curveFilled`). `null` when the
   * indexer/BounceTech are degraded or the token is graduated.
   */
  curveFilledOrganic: number | null;
  /**
   * Percent of the USD graduation threshold (`Bonding.graduationThresholdUsd`,
   * set once at proxy initialisation; production = $9K) that came from LT
   * price appreciation since those buys. `null` when unknown, clamped at 0
   * when the LT has dropped (marketing number — we don't surface a negative
   * contribution).
   */
  curveFilledLeverageBoost: number | null;
  /**
   * Live USD value of the curve's real LT reserve (`realLt × currentRate`).
   * Powers the "$X raised" label on the token-detail curve strip; pairs with
   * the live `graduationThresholdUsd` to render "$X / $Y" without making the
   * client redo the virtual→real LT subtraction. `null` when the breakdown
   * is degraded (no `k`, no rate, or indexer down) or when the token has
   * already graduated (the curve no longer holds reserves).
   */
  curveRaisedUsd: number | null;
  graduated: boolean;
  graduatedAt: string | null;
  /**
   * Phase 1 of graduation has fired but `finalizeGraduation` hasn't yet —
   * the token is contract-frozen, no buys/sells will land. Frontend renders
   * the "Token is graduating, no buys or sells allowed" overlay over the
   * trade panel during this window (~1-2 minutes). Always `false` once
   * `graduated` is `true`.
   */
  pendingGraduation: boolean;
  /** ISO timestamp when phase 1 fired. `null` if not currently in phase 1. */
  pendingGraduationAt: string | null;
  bondingPair: string | null;
  hyperswapPair: string | null;
  priceUsd: number | null;
  mcapUsd: number | null;
  change24h: number | null;
  /**
   * 24h percentage change of the backing LT's exchange rate. `null` when
   * BounceTech can't give us a rate at either end of the window.
   */
  ltChange24h: number | null;
  /**
   * Sum of USDC (6dp → USD) traded through `Zap` in the last 24h
   * for this token (buys + sells). `null` when the indexer is unavailable,
   * `0` when the token has simply had no trades in the window — callers must
   * distinguish the two (null == unknown, 0 == legitimately quiet).
   */
  volume24hUsd: number | null;
  /**
   * Lifetime gross USD routed through `Zap` for this token
   * (buys + sells, never subtracts). Sourced from the indexer's running
   * counter (`token.volumeUsd`), so it survives pagination truncation that
   * can force `volume24hUsd` to null. `null` only when the indexer is
   * completely unreachable; `0` for a token that has never traded.
   */
  totalVolumeUsd: number | null;
  /**
   * Lifetime USD accrued to this token's creator via `FeeVault:FeeAccrued`.
   * Sourced from a running counter on the indexer's `token` row — collapses
   * what was previously a per-token paginated GraphQL fetch (one round-trip
   * per token shown on the Rewards tab) into a single column on the existing
   * tokens response. `null` when the indexer is unreachable; `0` for a
   * token that has never accrued fees. Lifetime, never resets on claim.
   */
  creatorFeesUsd: number | null;
  /**
   * Mirror of `creatorFeesUsd` for the protocol cut. Same lifetime
   * semantics. Surfaced for symmetry with the admin dashboard.
   */
  protocolFeesUsd: number | null;
  /**
   * ISO timestamp of the most recent `Zap` trade for this token
   * within the 24h lookback window. `null` means either no trades in the
   * window or indexer unavailable — use in conjunction with
   * `volume24hUsd` to disambiguate.
   */
  lastTradeAt: string | null;
  /**
   * ISO timestamp of the community takeover (CTO) that moved this token's
   * creator role off its original dev, or `null` if it never had one — which
   * is the case for almost every token. Clients can treat non-null as "badge
   * this as community-run" and use the timestamp for "taken over 3d ago".
   *
   * Sourced from `Bonding.CreatorReassigned`, which only the protocol
   * multisig can trigger. A creator voluntarily handing the role to another
   * wallet (`CreatorTransferred`) does **not** set this — that's a handover,
   * not a takeover, and badging it as one would misrepresent the creator.
   *
   * Also `null` when the indexer is unreachable, so this conflates "no
   * takeover" with "unknown" exactly as `pendingGraduationAt` above does.
   * That's deliberate: for a badge, failing closed to "no badge" is the safe
   * direction, and the alternative pushes a tri-state onto every consumer.
   */
  communityTakeoverAt: string | null;
}

