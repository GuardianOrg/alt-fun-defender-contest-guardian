import {
  BOUNCE_INDEXING_API,
  type AdminCheckResponse,
  type AdminSessionAuth,
  type AdminTokenActionResponse,
  type LiveLeveragedToken,
} from "@launchpad/shared";

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
   * of any curve activity). Exposed for ad-hoc sorting/inspection; no UI
   * surface consumes it currently.
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

export type TokenListSort =
  | "createdAt"
  | "leverage"
  | "name"
  | "trending";

export type TokenListStatus = "curve" | "graduating" | "graduated";

export interface FetchTokensOptions {
  sort?: TokenListSort;
  status?: TokenListStatus;
  /**
   * Filter to tokens launched by a specific creator (lowercase or
   * checksummed address). Used by the creator-rewards tab to bound the
   * paginated catalogue scan to one wallet's tokens. The `/api/v1/tokens`
   * route forwards this to a `WHERE creator = …` in Postgres so the cap
   * matches the caller's actual blast radius, not the global catalogue.
   */
  creator?: string;
  /**
   * Pair-level filter facets. Forwarded to the API's `?underlying=` /
   * `?leverage=` / `?direction=` query params so filtering happens
   * server-side — keeping pagination honest. The API validates each
   * value: an unknown `underlying` returns an empty page rather than
   * 400-ing, and `leverage` is constrained to `2|3|5`.
   */
  underlying?: string;
  leverage?: number;
  direction?: "long" | "short";
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
  if (options.creator) params.set("creator", options.creator);
  if (options.underlying) params.set("underlying", options.underlying);
  if (options.leverage !== undefined) {
    params.set("leverage", String(options.leverage));
  }
  if (options.direction) params.set("direction", options.direction);
  return apiFetch(`/api/v1/tokens?${params.toString()}`);
}

/**
 * Server-enforced cap on `/api/v1/tokens?limit=…` (see `MAX_PAGE_SIZE` in
 * `apps/api/src/routes/tokens/list.ts`). The paginator below requests this
 * many tokens per page; any caller asking for "everything" needs to walk
 * pages until a short page comes back.
 */
const MAX_TOKENS_PAGE_SIZE = 100;

/**
 * Hard ceiling on how many pages `fetchAllTokens` will pull before bailing
 * out. Matches the production worst-case (~50K tokens at MAX_TOKENS_PAGE_SIZE)
 * with headroom — a runaway catalogue or a bug in the offset loop should
 * surface as a thrown error, not as an infinite request stream that
 * silently melts the client and the API.
 */
const MAX_TOKENS_PAGES = 1000;

/**
 * Walk `/api/v1/tokens` until exhausted and return every matching token in
 * a single array. Use this when the caller actually needs the full
 * catalogue (or full creator slice, etc.) — e.g. the balances chain
 * fallback's multicall list, or the creator-rewards per-token grid. For
 * paginated UI surfaces (home-page list, search) keep using `fetchTokens`
 * with a bounded page size.
 *
 * The server caps each page at `MAX_TOKENS_PAGE_SIZE` (100), so the cost
 * scales linearly: ~10 sequential requests per 1K tokens. Callers pay
 * latency, not memory — every page is small and the responses concatenate
 * cheaply.
 *
 * Throws (rather than returning a partial list) if the catalogue exceeds
 * `MAX_TOKENS_PAGES * MAX_TOKENS_PAGE_SIZE`. A silently-truncated full
 * catalogue would re-introduce the exact bug this helper exists to fix
 * (issue #476).
 */
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
  // We hit the page-count ceiling on a full page — the catalogue is either
  // exactly `MAX_TOKENS_PAGES * MAX_TOKENS_PAGE_SIZE` rows (perfectly
  // exhausted) or actually overflowing. Cheap one-row probe at the next
  // offset disambiguates: an empty probe means we're done; a non-empty one
  // means truncation is real and we must throw rather than silently drop
  // tail rows.
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
): Promise<ApiToken> {
  const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
  return apiFetch(`/api/v1/tokens/${address}${qs}`);
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
  5,        // 5s
  15,       // 15s
  30,       // 30s
  60,       // 1m
  300,      // 5m
  900,      // 15m
  1_800,    // 30m
  3_600,    // 1h
  14_400,   // 4h
  21_600,   // 6h
  43_200,   // 12h
  86_400,   // 1D
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

/**
 * Y-axis unit toggle — lets users flip the chart between aggregate market cap
 * (price × `TOKEN_SUPPLY`) and per-token USD price, mirroring the
 * Dexscreener `MC | Price` toggle. The underlying data is identical (every
 * candle is just a price reading) — the unit only controls the multiplier
 * and the price-scale formatter. We keep `mcap` as the default because the
 * primary signal on a launchpad is "where on the curve are we?" rather than
 * the absolute per-token price (which is always sub-cent on a 1B-supply
 * token).
 */
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
  mode: ChartMode = { kind: "interval", seconds: 60 },
): Promise<ChartSnapshot> {
  const { query } = getChartModeConfig(mode);
  return apiFetch(`/api/v1/chart/${address}?${query}`);
}

export interface MarketDataEntry {
  /**
   * Current token price in USD, computed from live curve state and the
   * BounceTech LT exchange rate. `null` when either input is unavailable
   * (treat as unknown, never zero). The full-catalogue `/api/v1/market-data`
   * payload includes this for every token, so consumers can build an
   * address-keyed price map without hitting the 100-row cap on the
   * `/api/v1/tokens` list endpoint (issue #476).
   */
  priceUsd: number | null;
  mcapUsd: number | null;
  change24h: number | null;
  past24hPriceUsd: number | null;
  /**
   * 24h USD trading volume (buys + sells through `Zap`). `null` while the
   * indexer aggregation is degraded — render as `—`, never `$0`. Surfaced
   * here so the hero card can live-update volume off the same 30s
   * `/market-data` poll that drives mcap (with WS deltas layered on top
   * via `useLiveTokenVolume24h`).
   */
  volume24hUsd: number | null;
}

export type MarketDataMap = Record<string, MarketDataEntry>;

/**
 * Maximum addresses per outbound `POST /api/v1/market-data` request.
 * Mirrors the server-side cap (`MAX_ADDRESSES_PER_REQUEST` in
 * `apps/api/src/routes/market-data.ts`); requests larger than this are
 * chunked client-side and merged below so the caller doesn't have to
 * page their own consumer (home-table infinite scroll will routinely
 * accumulate more than this).
 */
const MARKET_DATA_CHUNK_SIZE = 200;

/**
 * Per-page market-data fetch. Replaces the legacy catalogue-wide
 * `GET /api/v1/market-data` dump (which fanned out to O(catalogue)
 * upstream calls per cache miss). Consumers pass the address slice they
 * care about — token table page, search results, portfolio held
 * positions — and get back the same address-keyed map.
 *
 * Empty `addresses[]` short-circuits with `{}` (no round-trip). When
 * the caller passes more than `MARKET_DATA_CHUNK_SIZE` addresses we
 * fire chunked requests in parallel and merge — the server cap is a
 * defensive bound on per-request fan-out, not a user-facing limit on
 * the home table's infinite-scroll backlog.
 */
export async function fetchMarketData(
  addresses: string[],
): Promise<MarketDataMap> {
  if (addresses.length === 0) return {};
  if (addresses.length <= MARKET_DATA_CHUNK_SIZE) {
    return apiFetch("/api/v1/market-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses }),
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

/**
 * Per-asset response shape from `GET /api/v1/assets`. Currently only
 * exposes the current Hyperliquid mid — kept narrow so we can extend
 * the API without a breaking change to consumers.
 */
export interface ApiLiveMarketUnderlying {
  symbol: string;
  /** Current mid as a Hyperliquid-formatted decimal string, or `null` if the feed is missing the asset. */
  price: string | null;
}

export interface ApiLiveLeveragedToken {
  address: string;
  symbol: string;
  name: string;
  targetAsset: string;
  targetLeverage: number;
  isLong: boolean;
  exchangeRate: string;
  mintPaused: boolean;
}

export interface ApiLiveMarkets {
  underlying: ApiLiveMarketUnderlying[];
  leveragedTokens: ApiLiveLeveragedToken[];
  /**
   * Subset of `SUPPORTED_UNDERLYING_ASSETS` whose backing LTs BounceTech
   * has already surfaced on their public UI (the `bounce.tech/leveraged-
   * tokens/<symbol>.png` HEAD-check from issue #621). When the API
   * couldn't reach BounceTech's CDN this falls back to the full supported
   * list, so consumers can treat it as the authoritative "show these in
   * the UI" set without a separate "degraded" branch.
   */
  liveUnderlyings: string[];
}

/**
 * Pulls the BounceTech-UI-live filter set + per-asset mid prices in a
 * single round-trip. Used by the markets sidebar, asset tape, and the
 * create-flow pair selector to avoid listing underlyings whose LTs
 * BounceTech hasn't yet published.
 */
export function fetchLiveMarkets(): Promise<ApiLiveMarkets> {
  return apiFetch("/api/v1/assets");
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
  /**
   * Whether the token is currently hidden from the public listings by an
   * admin. Hidden positions still appear in the wallet's balances feed
   * (issue #712) so the holder can sell out; the UI uses this flag to
   * render the policy-violation disclaimer and disable the buy CTA on
   * the corresponding token's detail page.
   */
  isHidden: boolean;
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
  /**
   * Resolved token display symbol (e.g. `"TST"`), populated by the API
   * by batching a single Ponder `tokens(address_in: …)` query alongside
   * the trade fetch. Lets the client render the right label on first
   * paint without a second per-trade Ponder round-trip from
   * `prefetchTokenName` — which was the race the truncated-address
   * fallback exposed in issue #703.
   *
   * Optional because (a) older API builds don't return it, and (b) the
   * indexer briefly holds a blank-label placeholder row between
   * `Factory:PairCreated` and `Bonding:TokenLaunched` that we strip
   * server-side (a blank label would let the client cache an empty
   * string as "resolved").
   */
  tokenSymbol?: string;
  /**
   * Full token name (e.g. `"Test Token"`). Display fallback when
   * `tokenSymbol` is missing. Same optional/forward-compat semantics
   * as `tokenSymbol`.
   */
  tokenName?: string;
}

/**
 * Fetch the global feed of router-routed trades. Used by the home-page
 * trade ticker. Crucially graduation-aware (unlike Ponder's `trades`
 * GraphQL which only sees `Bonding.Trade`).
 *
 * `offset` lets the right-panel recent-trades list page backwards
 * through history when the user scrolls past the initial batch
 * (issue #807). Mirrors the per-token endpoint's pagination shape so
 * a single helper covers both.
 */
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
