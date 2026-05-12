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

/**
 * Validate that an unknown JSON value matches `PortfolioResponse`.
 * The downstream join/format paths assume `positions` is iterable and
 * each entry has string fields; a malformed envelope (api regression,
 * upstream MITM, partial response) would otherwise crash at the
 * format layer with a less-actionable error than `kind: "unknown"`.
 */
const isPortfolioResponse = (v: unknown): v is PortfolioResponse => {
  if (!v || typeof v !== "object") return false;
  const obj = v as { positions?: unknown; approximate?: unknown };
  if (!Array.isArray(obj.positions)) return false;
  if (typeof obj.approximate !== "boolean") return false;
  return obj.positions.every(
    (p) =>
      p &&
      typeof p === "object" &&
      typeof (p as { tokenAddress?: unknown }).tokenAddress === "string" &&
      typeof (p as { tokenAmount?: unknown }).tokenAmount === "string" &&
      typeof (p as { costBasisUsdc?: unknown }).costBasisUsdc === "string",
  );
};

const isBalanceEntryArray = (v: unknown): v is BalanceEntry[] =>
  Array.isArray(v) &&
  v.every(
    (b) =>
      b &&
      typeof b === "object" &&
      typeof (b as { address?: unknown }).address === "string" &&
      typeof (b as { name?: unknown }).name === "string" &&
      typeof (b as { ticker?: unknown }).ticker === "string" &&
      typeof (b as { balance?: unknown }).balance === "string",
  );

export const fetchPortfolio = async (
  env: Pick<Env, "API_BASE_URL" | "API_KEY">,
  wallet: string,
): Promise<ApiResult<PortfolioResponse>> => {
  const res = await getJson<unknown>(env, `/api/v1/portfolio/${wallet}`);
  if (!res.ok) return res;
  return isPortfolioResponse(res.data)
    ? { ok: true, data: res.data }
    : { ok: false, kind: "unknown" };
};

export const fetchBalances = async (
  env: Pick<Env, "API_BASE_URL" | "API_KEY">,
  wallet: string,
): Promise<ApiResult<BalanceEntry[]>> => {
  const res = await getJson<unknown>(env, `/api/v1/balances/${wallet}`);
  if (!res.ok) return res;
  return isBalanceEntryArray(res.data)
    ? { ok: true, data: res.data }
    : { ok: false, kind: "unknown" };
};
