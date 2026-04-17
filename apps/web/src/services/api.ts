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
  graduated?: boolean;
  graduatedAt?: string | null;
  bondingPair?: string | null;
  hyperswapPair?: string | null;
  priceUsd?: number | null;
  mcapUsd?: number | null;
  change24h?: number | null;
  poolAddress?: string | null;
}

export interface ApiComment {
  id: number;
  tokenAddress: string;
  author: string;
  content: string;
  createdAt: string;
}

export function fetchTokens(limit = 50, offset = 0): Promise<ApiToken[]> {
  return apiFetch(`/api/v1/tokens?limit=${limit}&offset=${offset}`);
}

export function fetchToken(address: string): Promise<ApiToken> {
  return apiFetch(`/api/v1/tokens/${address}`);
}

export function searchTokens(query: string): Promise<ApiToken[]> {
  return apiFetch(`/api/v1/tokens/search?q=${encodeURIComponent(query)}`);
}

export function createTokenApi(data: {
  address: string;
  name: string;
  ticker: string;
  description?: string;
  imageUrl?: string;
  ltPair: string;
  ltDirection: string;
  leverage: number;
  twitterUrl?: string;
  telegramUrl?: string;
  websiteUrl?: string;
  creator: string;
  signature: string;
}): Promise<ApiToken> {
  return apiFetch("/api/v1/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
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

export function fetchChart(
  address: string,
  timeframe: ChartTimeframe = "1d",
  interval?: number,
): Promise<ChartCandle[]> {
  let url = `/api/v1/chart/${address}?timeframe=${timeframe}`;
  if (interval) url += `&interval=${interval}`;
  return apiFetch(url);
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
