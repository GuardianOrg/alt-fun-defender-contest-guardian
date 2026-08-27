import {
  type AdminCheckResponse,
  type AdminSessionAuth,
  type AdminTokenActionResponse,
  type ApiResponse,
  type LiveLeveragedToken,
  type SupportedAsset,
  type SupportedLeverage,
} from "@launchpad/shared";

const apiUrl = import.meta.env.VITE_API_URL;
if (!apiUrl) {
  throw new Error("VITE_API_URL is not set");
}
export const API_BASE = apiUrl;

const DEGRADED_EVENT = "launchpad:degraded";

function emitDegradedState(degraded: boolean) {
  window.dispatchEvent(
    new CustomEvent(DEGRADED_EVENT, { detail: { degraded } }),
  );
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
  ltDirection: "long" | "short";
  leverage: SupportedLeverage;
  underlying: SupportedAsset;
  status: TokenListStatus;
  twitterUrl: string;
  telegramUrl: string;
  websiteUrl: string;
  creator: string;
  isHidden: boolean;
  createdAt: string;
  // Optional on search responses; null means degraded/unknown, never zero.
  curveSupply?: string | null;
  ltReserve?: string | null;
  curveFilled?: number | null;
  /** Organic USD contribution to `curveFilled`; null while degraded/post-grad. */
  curveFilledOrganic?: number | null;
  /** LT price-appreciation contribution to `curveFilled`, clamped at 0. */
  curveFilledLeverageBoost?: number | null;
  /** Live USD value of the curve's real LT reserve; null degraded/post-grad. */
  curveRaisedUsd?: number | null;
  graduated?: boolean;
  graduatedAt?: string | null;
  /** Phase 1 fired, phase 2 pending; token is contract-frozen. */
  pendingGraduation?: boolean;
  /** ISO timestamp when phase 1 fired. `null` if not currently in phase 1. */
  pendingGraduationAt?: string | null;
  bondingPair?: string | null;
  hyperswapPair?: string | null;
  priceUsd?: number | null;
  mcapUsd?: number | null;
  change24h?: number | null;
  /** 24h backing-LT exchange-rate change, independent of curve activity. */
  ltChange24h?: number | null;
  volume24hUsd?: number | null;
  /** Lifetime gross USD traded through `Zap`; null only when indexer is unreachable. */
  totalVolumeUsd?: number | null;
  /** Lifetime creator fees accrued; never decreases on claim. */
  creatorFeesUsd?: number | null;
  /** Lifetime protocol fee mirror of `creatorFeesUsd`. */
  protocolFeesUsd?: number | null;
  lastTradeAt?: string | null;
  poolAddress?: string | null;
  /**
   * ISO timestamp of the community takeover that moved this token's creator
   * role off its original dev; `null` when it never had one. A creator
   * voluntarily handing over to another wallet does not set this.
   */
  communityTakeoverAt?: string | null;
}

export type TokenListSort =
  | "createdAt"
  | "leverage"
  | "name"
  | "trending"
  | "volume24h"
  | "mcap"
  | "change24h";

export type TokenListStatus = "curve" | "graduating" | "graduated";

export interface FetchTokensOptions {
  sort?: TokenListSort;
  status?: TokenListStatus;
  /** Filter to tokens launched by one creator. */
  creator?: string;
  /** Pair-level facets forwarded to the API so pagination stays honest. */
  underlying?: SupportedAsset;
  leverage?: SupportedLeverage;
  direction?: "long" | "short";
}

export function fetchTokens(
  limit = 50,
  offset = 0,
  options: FetchTokensOptions = {},
  signal?: AbortSignal,
): Promise<ApiToken[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (options.sort) params.set("sort", options.sort);
  if (options.status) params.set("status", options.status);
  if (options.creator) params.set("creator", options.creator);
  if (options.underlying) params.set("underlying", options.underlying);
  if (options.leverage !== undefined) {
    params.set("leverage", String(options.leverage));
  }
  if (options.direction) params.set("direction", options.direction);
  return apiFetch(`/api/v1/tokens?${params.toString()}`, { signal });
}

// Server-enforced page cap for `/api/v1/tokens`.
const MAX_TOKENS_PAGE_SIZE = 100;

// Hard ceiling so an offset-loop bug cannot create an infinite request stream.
const MAX_TOKENS_PAGES = 1000;

/** Walk `/api/v1/tokens` until exhausted; use only when a full slice is needed. */
export async function fetchAllTokens(
  options: FetchTokensOptions = {},
): Promise<ApiToken[]> {
  const all: ApiToken[] = [];
  for (let page = 0; page < MAX_TOKENS_PAGES; page++) {
    const offset = page * MAX_TOKENS_PAGE_SIZE;
    const batch = await fetchTokens(MAX_TOKENS_PAGE_SIZE, offset, options);
    all.push(...batch);
    if (batch.length < MAX_TOKENS_PAGE_SIZE) return all;
  }
  // Probe one more row so exact-boundary catalogues don't look truncated.
  const probe = await fetchTokens(
    1,
    MAX_TOKENS_PAGES * MAX_TOKENS_PAGE_SIZE,
    options,
  );
  if (probe.length === 0) return all;
  throw new Error(
    `fetchAllTokens exceeded ${MAX_TOKENS_PAGES} pages — refusing to keep ` +
      `paginating to avoid silently truncating the catalogue. Consider a ` +
      `narrower filter (e.g. \`creator\`) or a server-side endpoint shape.`,
  );
}

/**
 * Fetch a single token by address.
 *
 * Optional `wallet` argument enables the holder-aware bypass for
 * admin-hidden tokens (issue #712): a wallet that already holds a hidden
 * token can still load its detail page (with `isHidden: true`) so it can
 * sell its position. Non-holders / wallets that don't hold the token /
 * disconnected sessions continue to see a 404 — exactly the public-lens
 * behaviour from issue #586. The server verifies ownership via a single
 * on-chain `balanceOf`; the wallet param is a hint only and is safe to
 * always supply when a wallet is connected.
 */
export function fetchToken(
  address: string,
  wallet?: string,
  signal?: AbortSignal,
): Promise<ApiToken> {
  const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
  return apiFetch(`/api/v1/tokens/${address}${qs}`, { signal });
}

export function searchTokens(query: string): Promise<ApiToken[]> {
  return apiFetch(`/api/v1/tokens/search?q=${encodeURIComponent(query)}`);
}

/**
 * Minimal `{address, name, symbol}` projection for a single token —
 * backs the in-memory `tokenNames` display-symbol cache. Resolves to
 * `null` whenever the token isn't (yet) indexed or the request fails;
 * the cache layer treats both as "no name available right now, keep
 * the truncated-address fallback rendering and retry later".
 *
 * Replaces the browser's previous direct POST to the Ponder GraphQL
 * endpoint (`apps/web/src/services/ponder.ts`'s `fetchPonderToken`,
 * removed in this PR). The API route this hits projects the row down
 * to three columns server-side and is edge-cached for 5 min — names
 * flip exactly once per token (at `TokenLaunched`), so even minutes
 * of staleness are harmless to the cache. See `apps/api/src/routes/
 * tokens/meta.ts` for the route, `apps/api/src/lib/indexer-reads.ts
 * → fetchTokenMeta` for the DB read.
 */
export interface TokenMeta {
  address: string;
  name: string;
  symbol: string;
}

export async function fetchTokenMeta(
  address: string,
): Promise<TokenMeta | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/tokens/${address}/meta`);
    const json = (await res.json()) as ApiResponse<TokenMeta>;
    if (json.status !== "success" || json.data === null) return null;
    return json.data;
  } catch {
    return null;
  }
}

/**
 * Whether a token is "valid" for public surfaces — registered in
 * `public.tokens` AND not moderation-hidden. Backs the recent-trades WS
 * filter (see `tokenValidity.ts`). Throws on transient API failure so the
 * caller can decide whether to cache the result.
 */
export async function fetchTokenValidity(address: string): Promise<boolean> {
  const res = await apiFetch<{ valid: boolean }>(
    `/api/v1/tokens/${address}/valid`,
  );
  return res.valid;
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

/**
 * Public endpoint — returns whether a wallet is in the moderation admin
 * allowlist. The frontend calls this on the token detail page to decide
 * whether to render the admin "Hide" button. Returns the boolean for
 * one address only; never enumerates the allowlist.
 */
export function fetchAdminCheck(address: string): Promise<AdminCheckResponse> {
  return apiFetch(`/api/v1/moderation/admins/${address}`);
}

/**
 * Hide a token from the public listings via the wallet-signed
 * moderation endpoint. Caller is responsible for obtaining `auth` from
 * `useSessionSignature` (which prompts the wallet only when no valid
 * 24h session signature is in localStorage).
 */
export function hideTokenApi(
  tokenAddress: string,
  auth: AdminSessionAuth,
): Promise<AdminTokenActionResponse> {
  return apiFetch(`/api/v1/moderation/tokens/${tokenAddress}/hide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(auth),
  });
}

export function unhideTokenApi(
  tokenAddress: string,
  auth: AdminSessionAuth,
): Promise<AdminTokenActionResponse> {
  return apiFetch(`/api/v1/moderation/tokens/${tokenAddress}/unhide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(auth),
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
 * `apps/api/src/routes/chart.ts`. Roughly mirrors the pump.fun set with
 * `5s` as the floor (sub-`5s` resolution isn't useful given our 1s LT
 * tick cadence and the curve's snapshot-per-trade write rate).
 */
export const CHART_INTERVAL_SECONDS = [
  5, // 5s
  15, // 15s
  30, // 30s
  60, // 1m
  300, // 5m
  900, // 15m
  1_800, // 30m
  3_600, // 1h
  14_400, // 4h
  21_600, // 6h
  43_200, // 12h
  86_400, // 1D
] as const;

export type ChartIntervalSeconds = (typeof CHART_INTERVAL_SECONDS)[number];

export const CHART_INTERVAL_LABELS: Record<ChartIntervalSeconds, string> = {
  5: "5s",
  15: "15s",
  30: "30s",
  60: "1m",
  300: "5m",
  900: "15m",
  1_800: "30m",
  3_600: "1h",
  14_400: "4h",
  21_600: "6h",
  43_200: "12h",
  86_400: "1D",
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

/** Chart y-axis unit toggle; data is the same, only multiplier/formatter changes. */
export type ChartUnit = "mcap" | "price";

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

/** Derive viewport window, candle width, query string, and stable mode key. */
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
  mode: ChartMode = { kind: "interval", seconds: 60 },
): Promise<ChartSnapshot> {
  const { query } = getChartModeConfig(mode);
  return apiFetch(`/api/v1/chart/${address}?${query}`);
}

export interface MarketDataEntry {
  /** Current token price in USD; null means unavailable/unknown, never zero. */
  priceUsd: number | null;
  mcapUsd: number | null;
  change24h: number | null;
  past24hPriceUsd: number | null;
  /** 24h USD trading volume through `Zap`; null while aggregation is degraded. */
  volume24hUsd: number | null;
}

export type MarketDataMap = Record<string, MarketDataEntry>;

// Mirrors the server-side market-data address cap; larger requests are chunked.
const MARKET_DATA_CHUNK_SIZE = 200;

/** Fetch bounded market data for a visible address slice, chunking over server cap. */
export async function fetchMarketData(
  addresses: string[],
  signal?: AbortSignal,
): Promise<MarketDataMap> {
  if (addresses.length === 0) return {};
  if (addresses.length <= MARKET_DATA_CHUNK_SIZE) {
    return apiFetch("/api/v1/market-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses }),
      signal,
    });
  }
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += MARKET_DATA_CHUNK_SIZE) {
    chunks.push(addresses.slice(i, i + MARKET_DATA_CHUNK_SIZE));
  }
  const results = await Promise.all(
    chunks.map((chunk) =>
      apiFetch<MarketDataMap>("/api/v1/market-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: chunk }),
        signal,
      }),
    ),
  );
  return Object.assign({}, ...results);
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
  leverage: SupportedLeverage;
  underlying: SupportedAsset;
  ltDirection: "long" | "short";
  /** Admin-hidden tokens still appear to holders so they can sell out. */
  isHidden: boolean;
  balance: string;
}

/** Asset row from the contract-backed LT mirror. */
export interface ApiAsset {
  symbol: string;
  price: string | null;
}

interface ApiAssetsResponse {
  underlying: ApiAsset[];
}

export async function fetchAssets(signal?: AbortSignal): Promise<ApiAsset[]> {
  const res = await apiFetch<ApiAssetsResponse>("/api/v1/assets", { signal });
  return res.underlying;
}

export function fetchBalances(wallet: string): Promise<ApiBalance[]> {
  return apiFetch(`/api/v1/balances-v2/${wallet}`);
}

/** Per-creator pooled earnings totals from the indexer's creator row. */
export interface ApiCreatorEarnings {
  /** Lifetime USDC accrued, 6dp decimal string. Never decreases. */
  lifetimeEarnedUsdcRaw: string;
  /** Lifetime USDC claimed, 6dp decimal string. Never decreases. */
  lifetimeClaimedUsdcRaw: string;
  /** `max(0, lifetimeEarned − lifetimeClaimed)`, 6dp decimal string. */
  claimableUsdcRaw: string;
  lifetimeEarnedUsd: number;
  lifetimeClaimedUsd: number;
  claimableUsd: number;
}

export function fetchCreatorEarnings(
  wallet: string,
): Promise<ApiCreatorEarnings> {
  return apiFetch(`/api/v1/creators/${wallet}/earnings`);
}

export function fetchSparkline(
  address: string,
  points = 20,
): Promise<number[]> {
  return apiFetch(`/api/v1/trades/sparkline/${address}?points=${points}`);
}

/** Router-routed trade row covering both curve and post-graduation trades. */
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
  /** Resolved display symbol, when the API can enrich the trade row. */
  tokenSymbol?: string;
  /** Full token name fallback when `tokenSymbol` is missing. */
  tokenName?: string;
}

/** Fetch global router-routed trades with backward pagination. */
export function fetchRouterTradesGlobal(
  limit = 20,
  offset = 0,
): Promise<ApiRouterTrade[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return apiFetch(`/api/v1/trades?${params.toString()}`);
}

/** Fetch per-token router trade history. */
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

export interface ApiTokenLock {
  /** Lowercased token address. */
  tokenAddress: string;
  /** Locked tokens, 18dp raw. */
  lockedAmount: string;
  /** Share of the 1B initial supply, 0–100. */
  lockedPercent: number;
  /**
   * ISO timestamp of the latest cliff across the token's locks — the date by
   * which all of `lockedAmount` is released. With multiple locks at different
   * cliffs, part of the total frees up earlier, so treat this as an upper
   * bound rather than the duration of the whole amount.
   */
  unlocksAt: string;
}

/**
 * Every token with an active supply lock, catalogue-wide. Deliberately not
 * per-token: the locked set is tiny, so one long-cached response feeds the
 * home-page list and every token page. Tokens absent from the list have no
 * lock.
 */
export function fetchTokenLocks(): Promise<{ locks: ApiTokenLock[] }> {
  return apiFetch("/api/v1/locks");
}

// API wraps the LT directory in an inner `{ data: [...] }` envelope.

export async function fetchLeveragedTokens(
  signal?: AbortSignal,
): Promise<LiveLeveragedToken[]> {
  const res = await apiFetch<{ data: LiveLeveragedToken[] }>(
    "/api/v1/assets/leveraged-tokens",
    { signal },
  );
  return res.data;
}
