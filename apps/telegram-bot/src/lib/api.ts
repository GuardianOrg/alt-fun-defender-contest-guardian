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
  | {
      ok: false;
      kind: "invalid_address" | "not_found" | "unavailable" | "unknown";
    };

export interface TokenInfo {
  address: string;
  name: string;
  ticker: string;
  priceUsd: number | null;
  mcapUsd: number | null;
  change24h: number | null;
  ltChange24h: number | null;
  volume24hUsd: number | null;
  curveFilled: number | null;
  status: string;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const isAddress = (value: string): boolean => ADDRESS_RE.test(value);

/**
 * When `apiKey` is unset, omit the header entirely rather than sending
 * `x-api-key: undefined` (which serializes to the literal string
 * `"undefined"` and trips apps/api's 401 path). Missing header instead
 * routes the request into apps/api's anonymous per-IP rate limit
 * (240/min, see AGENTS.md "Auth model"). Tracked for proper
 * provisioning in #640 — fine for solo dev / smoke tests, will starve
 * under concurrent users.
 */
const buildHeaders = (apiKey: string | undefined): HeadersInit => {
  const headers: Record<string, string> = { accept: "application/json" };
  // Trim before checking — a whitespace-only secret would otherwise
  // pass the truthy guard, get serialized as `" "` on the wire, hash
  // to nothing the api keys table recognises, and surface as a 401.
  // Treating whitespace as unset routes it cleanly into the anonymous
  // bucket like a missing secret.
  const normalized = apiKey?.trim();
  if (normalized) {
    headers["x-api-key"] = normalized;
  }
  return headers;
};

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

async function getJsonWithNotFound<T>(
  env: Pick<Env, "API_BASE_URL" | "API_KEY">,
  path: string,
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(`${env.API_BASE_URL}${path}`, {
      headers: buildHeaders(env.API_KEY),
      signal: controller.signal,
    });
  } catch {
    return { ok: false, kind: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 400) return { ok: false, kind: "invalid_address" };
  if (res.status === 404) return { ok: false, kind: "not_found" };
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

// JSON payloads never carry `undefined`; accept only `null` or a number.
const isOptionalNumber = (v: unknown): boolean =>
  v === null || typeof v === "number";

// Wire shape: mirrors `TokenInfo` but allows `volume24hUsd` to be
// absent so older API builds that predate the field still parse.
// `fetchToken` normalises to canonical `TokenInfo` (always `number | null`).
type TokenInfoWire = Omit<TokenInfo, "volume24hUsd"> & {
  volume24hUsd?: number | null;
};

const isTokenInfoWire = (v: unknown): v is TokenInfoWire => {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.address === "string" &&
    typeof obj.name === "string" &&
    typeof obj.ticker === "string" &&
    isOptionalNumber(obj.priceUsd) &&
    isOptionalNumber(obj.mcapUsd) &&
    isOptionalNumber(obj.change24h) &&
    isOptionalNumber(obj.ltChange24h) &&
    (obj.volume24hUsd === undefined || isOptionalNumber(obj.volume24hUsd)) &&
    isOptionalNumber(obj.curveFilled) &&
    typeof obj.status === "string"
  );
};

export const fetchToken = async (
  env: Pick<Env, "API_BASE_URL" | "API_KEY">,
  address: string,
): Promise<ApiResult<TokenInfo>> => {
  const res = await getJsonWithNotFound<unknown>(env, `/api/v1/tokens/${address}`);
  if (!res.ok) return res;
  if (!isTokenInfoWire(res.data)) return { ok: false, kind: "unknown" };
  const wire = res.data;
  return {
    ok: true,
    data: { ...wire, volume24hUsd: wire.volume24hUsd ?? null },
  };
};

/**
 * Extract the first 0x-prefixed 40-hex-char address from raw input or a URL.
 * The non-hex boundaries prevent matching a truncated address from a longer hex run.
 */
export const extractTokenAddress = (input: string): string | null => {
  const match = /(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/.exec(
    input.trim(),
  );
  return match ? match[0] : null;
};
