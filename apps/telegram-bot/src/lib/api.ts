import type { Env } from "./types.js";

export interface PortfolioPosition {
  tokenAddress: string;
  tokenAmount: string;
  costBasisUsdc: string;
}

export interface PortfolioResponse {
  positions: PortfolioPosition[];
  approximate: boolean;
}

export interface BalanceEntry {
  address: string;
  name: string;
  ticker: string;
  ltPair: string;
  leverage: number;
  underlying: string;
  ltDirection: string;
  balance: string;
}

/**
 * Outcomes the bot needs to distinguish in user-facing replies. A
 * client-side `invalid_address` is a different message than an upstream
 * 503; squashing both into `null` would force the caller to guess.
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "invalid_address" | "unavailable" | "unknown" };

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const isAddress = (value: string): boolean => ADDRESS_RE.test(value);

const buildHeaders = (apiKey: string): HeadersInit => ({
  "x-api-key": apiKey,
  accept: "application/json",
});

interface ApiEnvelope<T> {
  data?: T;
  error?: string;
}

async function getJson<T>(
  env: Pick<Env, "API_BASE_URL" | "API_KEY">,
  path: string,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${env.API_BASE_URL}${path}`, {
      headers: buildHeaders(env.API_KEY),
    });
  } catch {
    return { ok: false, kind: "unavailable" };
  }
  if (res.status === 400) return { ok: false, kind: "invalid_address" };
  if (res.status === 503 || res.status >= 500)
    return { ok: false, kind: "unavailable" };
  if (!res.ok) return { ok: false, kind: "unknown" };
  let body: ApiEnvelope<T>;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    return { ok: false, kind: "unknown" };
  }
  if (!body || body.data === undefined)
    return { ok: false, kind: "unknown" };
  return { ok: true, data: body.data };
}

export const fetchPortfolio = (
  env: Pick<Env, "API_BASE_URL" | "API_KEY">,
  wallet: string,
): Promise<ApiResult<PortfolioResponse>> =>
  getJson<PortfolioResponse>(env, `/api/v1/portfolio/${wallet}`);

export const fetchBalances = (
  env: Pick<Env, "API_BASE_URL" | "API_KEY">,
  wallet: string,
): Promise<ApiResult<BalanceEntry[]>> =>
  getJson<BalanceEntry[]>(env, `/api/v1/balances/${wallet}`);
