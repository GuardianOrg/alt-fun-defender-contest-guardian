const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8787";

interface ApiResponse<T> {
  status: "success" | "error";
  data: T | null;
  error: string | null;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  const json = (await res.json()) as ApiResponse<T>;
  if (json.status === "error" || json.data === null) {
    throw new Error(json.error ?? "API error");
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
  timestamp: number,
): Promise<ApiComment> {
  return apiFetch(`/api/v1/tokens/${tokenAddress}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ author, content, signature, timestamp }),
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

export interface OhlcvCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function fetchOhlcv(
  address: string,
  interval = "1h",
): Promise<OhlcvCandle[]> {
  return apiFetch(`/api/v1/trades/ohlcv/${address}?interval=${interval}`);
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
