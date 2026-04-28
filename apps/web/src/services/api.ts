import { BOUNCE_INDEXING_API, type LiveLeveragedToken } from "@launchpad/shared";

const apiUrl = import.meta.env.VITE_API_URL;
if (!apiUrl) {
  throw new Error("VITE_API_URL is not set");
}
export const API_BASE = apiUrl;

interface ApiResponse<T> {
  status: "success" | "error";
  data: T | null;
  error: string | null;
  dataSource?: "live" | "degraded";
}

/** Event dispatched when the API reports degraded data source */
const DEGRADED_EVENT = "launchpad:degraded";

function emitDegradedState(degraded: boolean) {
  window.dispatchEvent(new CustomEvent(DEGRADED_EVENT, { detail: { degraded } }));
}

export { DEGRADED_EVENT };

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  const json = (await res.json()) as ApiResponse<T>;
  if (json.status === "error" || json.data === null) {
    throw new Error(json.error ?? "API error");
  }
  if (json.dataSource) {
    emitDegradedState(json.dataSource === "degraded");
  }
  return json.data;
}

export interface ApiToken {
  address: string;
  name: string;
  ticker: string;
  description: string;
  imageUrl: string;
  ltPair: string;
  ltDirection: string;
  leverage: number;
  underlying: string;
  status: string;
  twitterUrl: string;
  telegramUrl: string;
  websiteUrl: string;
  creator: string;
  isHidden: boolean;
  createdAt: string;
  // Derived on the API from Ponder + BounceTech. Optional because the
  // `/tokens/search` endpoint returns only the base Postgres shape for speed.
  // Nullable (when present) because the indexer or BounceTech may be
  // temporarily unavailable — UI should treat null as "unknown", never zero.
  curveSupply?: string | null;
  ltReserve?: string | null;
  curveFilled?: number | null;
  /**
   * Organic USD contribution to `curveFilled` (0–curveFilled). Null while
   * indexer/BounceTech are degraded or post-graduation. See
   * `apps/api/src/lib/token-enrich.ts` for the computation.
   */
  curveFilledOrganic?: number | null;
  /**
   * LT price-appreciation contribution to `curveFilled`. Clamped at 0 — a
   * negative "boost" is hidden from the UI by product decision.
   */
  curveFilledLeverageBoost?: number | null;
  /**
   * Live USD value of the curve's real LT reserve (`realLt × currentRate`).
   * Powers the `$X raised` label on the curve strip; pairs with the live
   * `graduationThresholdUsd` to render `$X / $Y`. Null while
   * indexer/BounceTech are degraded or post-graduation.
   */
  curveRaisedUsd?: number | null;
  graduated?: boolean;
  graduatedAt?: string | null;
  /**
   * Phase 1 of graduation has fired but `finalizeGraduation` hasn't yet —
   * the token is contract-frozen, no buys/sells will land. Drives the
   * "Token is graduating" overlay on the trade panel.
   */
  pendingGraduation?: boolean;
  /** ISO timestamp when phase 1 fired. `null` if not currently in phase 1. */
  pendingGraduationAt?: string | null;
  bondingPair?: string | null;
  hyperswapPair?: string | null;
  priceUsd?: number | null;
  mcapUsd?: number | null;
  change24h?: number | null;
  /**
   * 24h percentage change of the backing LT's exchange rate (independent
   * of any curve activity). Primary signal for the LT MOVERS tab.
   */
  ltChange24h?: number | null;
  volume24hUsd?: number | null;
  /**
   * Lifetime gross USD traded through `Zap` for this token
   * (buys + sells). Sourced from a running counter on the indexer's
   * `token` row, so — unlike `volume24hUsd` — it doesn't go null on
   * pagination truncation. `null` only when the indexer is unreachable;
   * `0` when the token has never traded.
   */
  totalVolumeUsd?: number | null;
  /**
   * Lifetime USD accrued to this token's creator via `FeeVault:FeeAccrued`.
   * Lifetime counter — never decreases on claim. Sourced from a running
   * counter on the indexer's `token` row, so the Rewards tab can show
   * per-token earned figures in O(1) without a per-token round-trip.
   * `null` when the indexer is unreachable; `0` when the token has never
   * accrued fees.
   */
  creatorFeesUsd?: number | null;
  /**
   * Mirror of `creatorFeesUsd` for the protocol cut. Same lifetime
   * semantics. Surfaced for symmetry with the admin dashboard.
   */
  protocolFeesUsd?: number | null;
  lastTradeAt?: string | null;
  poolAddress?: string | null;
}

export interface ApiComment {
  id: number;
  tokenAddress: string;
  author: string;
  content: string;
  createdAt: string;
}

export type TokenListSort =
  | "createdAt"
  | "leverage"
  | "name"
  | "trending"
  | "lt-movers";

export type TokenListStatus = "curve" | "graduating" | "graduated";

export interface FetchTokensOptions {
  sort?: TokenListSort;
  status?: TokenListStatus;
}

export function fetchTokens(
  limit = 50,
  offset = 0,
  options: FetchTokensOptions = {},
): Promise<ApiToken[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (options.sort) params.set("sort", options.sort);
  if (options.status) params.set("status", options.status);
  return apiFetch(`/api/v1/tokens?${params.toString()}`);
}

export function fetchToken(address: string): Promise<ApiToken> {
  return apiFetch(`/api/v1/tokens/${address}`);
}

export function searchTokens(query: string): Promise<ApiToken[]> {
  return apiFetch(`/api/v1/tokens/search?q=${encodeURIComponent(query)}`);
}

/**
 * Register a token in the PostgreSQL `tokens` table after its on-chain
 * launch. Address-only — every other field is read from
 * `Bonding.getTokenInfo` server-side, so no signature is required and
 * arbitrary clients can call this idempotently. The frontend awaits this
 * synchronously after the launch tx confirms; if it fails, the API
 * Worker's cron backfill picks the token up within ~60s.
 *
 * Returns the registered row on both 201 (just inserted) and 200
 * (already existed) — `apiFetch` collapses the two into the same success
 * shape, which is the right thing for the UI.
 */
export function registerTokenApi(address: string): Promise<ApiToken> {
  return apiFetch("/api/v1/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
}

export function fetchComments(
  tokenAddress: string,
  limit = 50,
  offset = 0,
): Promise<ApiComment[]> {
  return apiFetch(
    `/api/v1/tokens/${tokenAddress}/comments?limit=${limit}&offset=${offset}`,
  );
}

export function postComment(
  tokenAddress: string,
  author: string,
  content: string,
  signature: string,
  expiresAt: number,
): Promise<ApiComment> {
  return apiFetch(`/api/v1/tokens/${tokenAddress}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ author, content, signature, expiresAt }),
  });
}

export function uploadImage(file: File): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch("/api/v1/images", {
    method: "POST",
    body: formData,
  });
}

export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type ChartTimeframe = "1d" | "5d" | "1m";

/**
 * Allowed candle-width values (seconds) surfaced in the interval picker.
 * Must stay in sync with `VALID_INTERVAL_SECONDS` in
 * `apps/api/src/routes/chart.ts`.
 */
export const CHART_INTERVAL_SECONDS = [
  60,       // 1m
  180,      // 3m
  300,      // 5m
  900,      // 15m
  3_600,    // 1h
  7_200,    // 2h
  14_400,   // 4h
  28_800,   // 8h
  43_200,   // 12h
  86_400,   // 1D
  259_200,  // 3D
  604_800,  // 1W
] as const;

export type ChartIntervalSeconds = (typeof CHART_INTERVAL_SECONDS)[number];

export const CHART_INTERVAL_LABELS: Record<ChartIntervalSeconds, string> = {
  60: "1m",
  180: "3m",
  300: "5m",
  900: "15m",
  3_600: "1h",
  7_200: "2h",
  14_400: "4h",
  28_800: "8h",
  43_200: "12h",
  86_400: "1D",
  259_200: "3D",
  604_800: "1W",
};

/**
 * Chart mode — either a fixed timeframe (window-centric, default candle width)
 * or a user-picked candle width (interval-centric, window auto-sizes on the
 * server). Exactly one is active at a time; selecting one deselects the
 * other in the UI.
 */
export type ChartMode =
  | { kind: "timeframe"; value: ChartTimeframe }
  | { kind: "interval"; seconds: ChartIntervalSeconds };

const TIMEFRAME_WINDOW_SECONDS: Record<ChartTimeframe, number> = {
  "1d": 86_400,
  "5d": 432_000,
  "1m": 2_592_000,
};

const TIMEFRAME_CANDLE_SECONDS: Record<ChartTimeframe, number> = {
  "1d": 300,
  "5d": 1_800,
  "1m": 14_400,
};

// Matches INTERVAL_MODE_BAR_COUNT in `apps/api/src/routes/chart.ts`.
const INTERVAL_MODE_BAR_COUNT = 120;

/**
 * Derives the window (chart viewport, seconds) and candle width (seconds)
 * for a given `ChartMode`. Used by the chart hooks for live-tick bucketing,
 * viewport padding, and by `fetchChart` to build the query string. Kept in
 * one place so API, `useChartData`, and `useChart` never drift.
 */
export function getChartModeConfig(mode: ChartMode): {
  windowSec: number;
  candleSec: number;
  query: string;
  /** Stable key safe to use as a `useEffect` dependency. */
  key: string;
} {
  if (mode.kind === "timeframe") {
    return {
      windowSec: TIMEFRAME_WINDOW_SECONDS[mode.value],
      candleSec: TIMEFRAME_CANDLE_SECONDS[mode.value],
      query: `timeframe=${mode.value}`,
      key: `tf:${mode.value}`,
    };
  }
  return {
    windowSec: mode.seconds * INTERVAL_MODE_BAR_COUNT,
    candleSec: mode.seconds,
    query: `interval=${mode.seconds}`,
    key: `iv:${mode.seconds}`,
  };
}

export interface ChartSnapshot {
  candles: ChartCandle[];
  /** Curve ratio (ltReserve / curveSupply) at the latest indexed trade. */
  currentRatio: number;
  /** LT exchange rate from BounceTech at the latest sampled tick. */
  currentExchangeRate: number;
}

export function fetchChart(
  address: string,
  mode: ChartMode = { kind: "timeframe", value: "1d" },
): Promise<ChartSnapshot> {
  const { query } = getChartModeConfig(mode);
  return apiFetch(`/api/v1/chart/${address}?${query}`);
}

export interface MarketDataEntry {
  mcapUsd: number | null;
  change24h: number | null;
  past24hPriceUsd: number | null;
}

export type MarketDataMap = Record<string, MarketDataEntry>;

export function fetchMarketData(): Promise<MarketDataMap> {
  return apiFetch("/api/v1/market-data");
}

export function fetchMarketDataForToken(
  address: string,
): Promise<MarketDataEntry> {
  return apiFetch(`/api/v1/market-data/${address.toLowerCase()}`);
}

export interface ApiBalance {
  address: string;
  name: string;
  ticker: string;
  imageUrl: string;
  ltPair: string;
  leverage: number;
  underlying: string;
  ltDirection: string;
  balance: string;
}

export function fetchBalances(wallet: string): Promise<ApiBalance[]> {
  return apiFetch(`/api/v1/balances/${wallet}`);
}

export function fetchSparkline(
  address: string,
  points = 20,
): Promise<number[]> {
  return apiFetch(`/api/v1/trades/sparkline/${address}?points=${points}`);
}

/**
 * Shape returned by `GET /api/v1/trades` and `GET /api/v1/trades/:address`.
 * Sourced from the indexer's `routerTrade` table (Zap `Buy`/`Sell` events),
 * so the same endpoint covers **both** bonding-curve and post-graduation
 * trades — no special-casing for graduated tokens.
 *
 * Contrast with `PonderTrade` from `services/ponder.ts` (Bonding-only,
 * LT-denominated): keep this one out of `services/ponder.ts` so a
 * graduation regression there doesn't pull the ponder-trades polling
 * path back into use.
 */
export interface ApiRouterTrade {
  id: string;
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  /** USDC amount in/out, 6dp decimal string (matches indexer storage). */
  usdcAmount: string;
  /** Token amount in/out, 1e18-scaled decimal string. */
  tokenAmount: string;
  blockNumber: string;
  /** Unix seconds (decimal string, NOT 1e18-scaled). */
  timestamp: string;
}

/**
 * Fetch the global feed of router-routed trades. Used by the home-page
 * trade ticker. Crucially graduation-aware (unlike Ponder's `trades`
 * GraphQL which only sees `Bonding.Trade`).
 */
export function fetchRouterTradesGlobal(limit = 20): Promise<ApiRouterTrade[]> {
  return apiFetch(`/api/v1/trades?limit=${limit}`);
}

/**
 * Fetch per-token router trade history (paginated). The same endpoint
 * powers the token detail page's "trades" tab and the per-token live feed
 * REST fallback.
 */
export function fetchRouterTradesByToken(
  address: string,
  limit = 30,
  offset = 0,
): Promise<ApiRouterTrade[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return apiFetch(`/api/v1/trades/${address}?${params.toString()}`);
}

export interface HolderInfo {
  wallet: string;
  balance: string;
  percentage: number;
}

export function fetchHolders(
  address: string,
  limit = 20,
): Promise<{ holders: HolderInfo[]; totalHolders: number }> {
  return apiFetch(`/api/v1/holders/${address}?limit=${limit}`);
}

// BounceTech Indexing API helpers

async function bounceTechFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BOUNCE_INDEXING_API}${path}`, init);
  if (!res.ok) {
    throw new Error(`BounceTech API error: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function fetchLeveragedTokens(): Promise<LiveLeveragedToken[]> {
  const res = await bounceTechFetch<{ data: LiveLeveragedToken[] }>("/leveraged-tokens");
  return res.data;
}
