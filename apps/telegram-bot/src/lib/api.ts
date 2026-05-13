import type { Env } from "./types.js";

export interface ReferralStats {
  referredWallets: number;
  referredVolume: string;
}

/**
 * Bot-namespaced referral stats sourced from `BotFeeRouter`'s
 * `referrerStats` Ponder entity, plus the rewards-wallet KV record.
 * Surfaced on `/referral` — see `commands/referral.ts`. Bad-payment
 * and attribution-loss counts drive the two safety banners spec'd in
 * `apps/telegram-bot/AGENTS.md`. Until the BotFeeRouter contract is
 * deployed and indexed all four counters default to zero on the api
 * side, which collapses the banners to a no-op cleanly.
 */
export interface BotReferralStats {
  rewardsWallet: string;
  referredCount: number;
  lifetimeEarnedUsdc: string;
  badPaymentCount: number;
  attributionLossCount: number;
}

/**
 * Bot-namespaced open + realised positions sourced from
 * `walletBotPosition` on the shared indexer. Drives the /positions
 * surface — see `commands/positions.ts`. Until the BotFeeRouter
 * contract is deployed and the entity exists, the api returns empty
 * `open` / `realised` arrays which renders "no open positions"
 * cleanly with no banner spam.
 */
export interface BotOpenPosition {
  token: string;
  ticker: string;
  balance: string;
  costBasisUsdc: string;
  currentValueUsdc: string;
  unrealisedPnlUsdc: string;
  unrealisedPnlPct: number | null;
}

export interface BotRealisedPosition {
  token: string;
  ticker: string;
  totalCostUsdc: string;
  totalProceedsUsdc: string;
  realisedPnlUsdc: string;
  realisedPnlPct: number | null;
}

export interface BotPositionsResponse {
  open: BotOpenPosition[];
  realised: BotRealisedPosition[];
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
  /**
   * Address of the BounceTech Leveraged Token used as the bonding-curve
   * reserve. Required by /sell's buffer preflight — see
   * `commands/sell.ts` and AGENTS.md "BounceTech LT Integration →
   * Buffer-limited sells". Optional on the wire because pre-#XYZ
   * api builds did not expose it; in that case the preflight is
   * skipped and the user falls back to the post-tx revert.
   */
  ltPair: string | null;
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

const USDC_RAW_RE = /^-?[0-9]+$/;
const ADDRESS_LOWER_RE = /^0x[0-9a-fA-F]{40}$/;

const isOptionalPct = (v: unknown): boolean =>
  v === null || typeof v === "number";

const isBotOpenPosition = (v: unknown): v is BotOpenPosition => {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.token === "string" &&
    ADDRESS_LOWER_RE.test(obj.token) &&
    typeof obj.ticker === "string" &&
    typeof obj.balance === "string" &&
    USDC_RAW_RE.test(obj.balance) &&
    typeof obj.costBasisUsdc === "string" &&
    USDC_RAW_RE.test(obj.costBasisUsdc) &&
    typeof obj.currentValueUsdc === "string" &&
    USDC_RAW_RE.test(obj.currentValueUsdc) &&
    typeof obj.unrealisedPnlUsdc === "string" &&
    USDC_RAW_RE.test(obj.unrealisedPnlUsdc) &&
    isOptionalPct(obj.unrealisedPnlPct)
  );
};

const isBotRealisedPosition = (v: unknown): v is BotRealisedPosition => {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.token === "string" &&
    ADDRESS_LOWER_RE.test(obj.token) &&
    typeof obj.ticker === "string" &&
    typeof obj.totalCostUsdc === "string" &&
    USDC_RAW_RE.test(obj.totalCostUsdc) &&
    typeof obj.totalProceedsUsdc === "string" &&
    USDC_RAW_RE.test(obj.totalProceedsUsdc) &&
    typeof obj.realisedPnlUsdc === "string" &&
    USDC_RAW_RE.test(obj.realisedPnlUsdc) &&
    isOptionalPct(obj.realisedPnlPct)
  );
};

const isBotPositionsResponse = (v: unknown): v is BotPositionsResponse => {
  if (!v || typeof v !== "object") return false;
  const obj = v as { open?: unknown; realised?: unknown };
  return (
    Array.isArray(obj.open) &&
    obj.open.every(isBotOpenPosition) &&
    Array.isArray(obj.realised) &&
    obj.realised.every(isBotRealisedPosition)
  );
};

export const fetchBotPositions = async (
  env: Pick<Env, "API_BASE_URL" | "API_KEY">,
  wallet: string,
): Promise<ApiResult<BotPositionsResponse>> => {
  const res = await getJson<unknown>(env, `/api/v1/bot/positions/${wallet}`);
  if (!res.ok) return res;
  return isBotPositionsResponse(res.data)
    ? { ok: true, data: res.data }
    : { ok: false, kind: "unknown" };
};

const isReferralStats = (v: unknown): v is ReferralStats => {
  if (!v || typeof v !== "object") return false;
  const obj = v as { referredWallets?: unknown; referredVolume?: unknown };
  return (
    typeof obj.referredWallets === "number" &&
    Number.isInteger(obj.referredWallets) &&
    obj.referredWallets >= 0 &&
    typeof obj.referredVolume === "string" &&
    /^[0-9]+$/.test(obj.referredVolume)
  );
};

export const fetchReferralStats = async (
  env: Pick<Env, "API_BASE_URL" | "API_KEY">,
  wallet: string,
): Promise<ApiResult<ReferralStats>> => {
  const res = await getJson<unknown>(env, `/api/v1/referrals/${wallet}`);
  if (!res.ok) return res;
  return isReferralStats(res.data)
    ? {
        ok: true,
        data: {
          referredWallets: res.data.referredWallets,
          referredVolume: res.data.referredVolume,
        },
      }
    : { ok: false, kind: "unknown" };
};

const isBotReferralStats = (v: unknown): v is BotReferralStats => {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.rewardsWallet === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(obj.rewardsWallet) &&
    typeof obj.referredCount === "number" &&
    Number.isInteger(obj.referredCount) &&
    obj.referredCount >= 0 &&
    typeof obj.lifetimeEarnedUsdc === "string" &&
    /^[0-9]+$/.test(obj.lifetimeEarnedUsdc) &&
    typeof obj.badPaymentCount === "number" &&
    Number.isInteger(obj.badPaymentCount) &&
    obj.badPaymentCount >= 0 &&
    typeof obj.attributionLossCount === "number" &&
    Number.isInteger(obj.attributionLossCount) &&
    obj.attributionLossCount >= 0
  );
};

export const fetchBotReferralStats = async (
  env: Pick<Env, "API_BASE_URL" | "API_KEY">,
  wallet: string,
): Promise<ApiResult<BotReferralStats>> => {
  const res = await getJson<unknown>(env, `/api/v1/bot/referrals/${wallet}`);
  if (!res.ok) return res;
  return isBotReferralStats(res.data)
    ? { ok: true, data: res.data }
    : { ok: false, kind: "unknown" };
};

/**
 * Persist the user's rewards wallet via the api. The api owns the KV
 * row (`rewards-wallet:<wallet>`) and the bot reads it back through
 * `fetchBotReferralStats`. Returns the wallet string that the api
 * confirmed it stored so callers can render confirmation copy
 * without round-tripping a separate read.
 */
export const setBotRewardsWallet = async (
  env: Pick<Env, "API_BASE_URL" | "API_KEY">,
  wallet: string,
  rewardsWallet: string,
): Promise<ApiResult<{ rewardsWallet: string }>> => {
  // 10s budget matches `getJsonWithNotFound` — long enough to ride
  // through a slow but healthy api, short enough that a hung worker
  // doesn't wedge the user mid-wizard. AbortError lands in the catch
  // below and surfaces as `unavailable`, the same shape as a network
  // refusal, so the wizard's user-facing copy stays uniform.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(
      `${env.API_BASE_URL}/api/v1/bot/referrals/${wallet}/rewards-wallet`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...buildHeaders(env.API_KEY),
        },
        body: JSON.stringify({ rewardsWallet }),
        signal: controller.signal,
      },
    );
  } catch {
    return { ok: false, kind: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 400) return { ok: false, kind: "invalid_address" };
  if (res.status === 503 || res.status >= 500)
    return { ok: false, kind: "unavailable" };
  if (!res.ok) return { ok: false, kind: "unknown" };
  let body: ApiEnvelope<{ rewardsWallet?: unknown }>;
  try {
    body = (await res.json()) as ApiEnvelope<{ rewardsWallet?: unknown }>;
  } catch {
    return { ok: false, kind: "unknown" };
  }
  if (
    !body ||
    !body.data ||
    typeof body.data.rewardsWallet !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(body.data.rewardsWallet)
  ) {
    return { ok: false, kind: "unknown" };
  }
  return { ok: true, data: { rewardsWallet: body.data.rewardsWallet } };
};

// JSON payloads never carry `undefined`; accept only `null` or a number.
const isOptionalNumber = (v: unknown): boolean =>
  v === null || typeof v === "number";

// Wire shape: mirrors `TokenInfo` but allows `volume24hUsd` and `ltPair`
// to be absent so older API builds that predate those fields still parse.
// `fetchToken` normalises to canonical `TokenInfo` (always `number | null`
// / `string | null`).
type TokenInfoWire = Omit<TokenInfo, "volume24hUsd" | "ltPair"> & {
  volume24hUsd?: number | null;
  ltPair?: string | null;
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
    typeof obj.status === "string" &&
    (obj.ltPair === undefined ||
      obj.ltPair === null ||
      (typeof obj.ltPair === "string" && ADDRESS_RE.test(obj.ltPair)))
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
    data: {
      ...wire,
      volume24hUsd: wire.volume24hUsd ?? null,
      ltPair: wire.ltPair ?? null,
    },
  };
};

/**
 * Single trade row from `GET /api/v1/trades/:address`. Mirrors the
 * `routerTrades` Ponder entity — amounts are raw decimal strings (USDC
 * 6dp, token 18dp) so the bot keeps full precision through formatting.
 */
export interface Trade {
  id: string;
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  /** USDC raw (6 decimals) as decimal string. */
  usdcAmount: string;
  /** Token raw (18 decimals) as decimal string. */
  tokenAmount: string;
  blockNumber: string;
  /** Unix seconds as decimal string. */
  timestamp: string;
}

const isTrade = (v: unknown): v is Trade => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.tokenAddress === "string" &&
    typeof o.trader === "string" &&
    typeof o.isBuy === "boolean" &&
    typeof o.usdcAmount === "string" &&
    typeof o.tokenAmount === "string" &&
    typeof o.blockNumber === "string" &&
    typeof o.timestamp === "string"
  );
};

const isTradeArray = (v: unknown): v is Trade[] =>
  Array.isArray(v) && v.every(isTrade);

/**
 * Fetch the most recent trades for a token. `limit` defaults to the
 * /track spec's 20 rows; the api caps at 100 server-side. Returns
 * `not_found` only when the api itself surfaces a 404 — an empty trade
 * list is `{ ok: true, data: [] }`, which the caller renders as "no
 * trades yet" rather than an error.
 */
export const fetchTrades = async (
  env: Pick<Env, "API_BASE_URL" | "API_KEY">,
  address: string,
  limit = 20,
): Promise<ApiResult<Trade[]>> => {
  const res = await getJson<unknown>(
    env,
    `/api/v1/trades/${address}?limit=${limit}`,
  );
  if (!res.ok) return res;
  return isTradeArray(res.data)
    ? { ok: true, data: res.data }
    : { ok: false, kind: "unknown" };
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
