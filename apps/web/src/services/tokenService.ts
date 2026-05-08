import { getAssetDisplayName } from "@launchpad/shared";

import { API_BASE, fetchToken, fetchTokens } from "./api";

import type { ApiToken, FetchTokensOptions } from "./api";
import type { Direction, Token, TokenFilter } from "./types";

export function ltDisplayName(apiToken: ApiToken): string {
  const dir = apiToken.ltDirection === "long" ? "Long" : "Short";
  const underlying = deriveUnderlying(apiToken);
  return `${getAssetDisplayName(underlying)} ${apiToken.leverage}× ${dir}`;
}

export function deriveUnderlying(apiToken: ApiToken): Token["underlying"] {
  if (apiToken.underlying && apiToken.underlying !== "") {
    return apiToken.underlying as Token["underlying"];
  }
  const match = apiToken.ltPair.match(/^(HYPE|ETH|BTC|SOL|ARB|OP)/i);
  return (match ? match[1].toUpperCase() : "HYPE") as Token["underlying"];
}

export function deriveDirection(apiToken: ApiToken): Direction {
  return apiToken.ltDirection === "short" ? "short" : "long";
}

/**
 * Map the API's lifecycle to the frontend's. The API uses `"curve"` for the
 * active state (matches the contract's `Lifecycle.Curve`); we render that as
 * `"active"`.
 *
 * The API's `"graduating"` status is now contract-driven — it means the token
 * is in the frozen window between phase 1 (`Bonding.TokenGraduating`) and
 * phase 2 (`finalizeGraduation`). The trade panel should refuse buys/sells
 * and show the "Token is graduating" overlay during this state.
 */
export function deriveStatus(api: ApiToken): Token["status"] {
  if (api.status === "graduated" || api.graduated) return "graduated";
  if (api.status === "graduating" || api.pendingGraduation) return "graduating";
  return "active";
}

export function fromApiToken(api: ApiToken): Token {
  return {
    address: api.address,
    name: api.name,
    ticker: api.ticker,
    emoji: "",
    image: api.imageUrl ? new URL(api.imageUrl, API_BASE).toString() : undefined,
    description: api.description,
    direction: deriveDirection(api),
    underlying: deriveUnderlying(api),
    leverage: api.leverage as Token["leverage"],
    ltName: ltDisplayName(api),
    ltAddress: api.ltPair,
    buyMomentum: 0,
    // Split of `curveFilled` surfaced by the API (organic USDC vs LT
    // appreciation). The UI renders the bar as `organic + boost = curveFilled`
    // when both are present, or a single solid fill when the breakdown is
    // degraded (e.g. indexer down). Null means "unknown", NOT zero — see
    // `ProgressBar` which treats null by rendering the full bar solid.
    leverageBoost: api.curveFilledLeverageBoost ?? 0,
    organicFilled: api.curveFilledOrganic ?? null,
    curveFilled: api.curveFilled ?? null,
    // Honest pass-through: `null` here means "indexer/BounceTech degraded or
    // graduated" — the curve-strip label uses `formatUsdOrDash` to render `—`,
    // never a misleading "$0". Hardcoding 0 (the previous behaviour) made
    // every fresh token's strip read "CURVE $0 ... $300" regardless of
    // actual USD raised, which read as a broken/disabled bar to users.
    curveRaisedUsd: api.curveRaisedUsd ?? null,
    volume24h: api.volume24hUsd ?? null,
    totalVolumeUsd: api.totalVolumeUsd ?? null,
    athUsd: 0,
    priceUsd: api.priceUsd ?? null,
    mcapUsd: api.mcapUsd ?? null,
    change24h: api.change24h ?? null,
    status: deriveStatus(api),
    creatorAddress: api.creator,
    createdAt: api.createdAt,
    socialLinks: (api.twitterUrl || api.telegramUrl || api.websiteUrl) ? {
      twitter: api.twitterUrl || undefined,
      telegram: api.telegramUrl || undefined,
      website: api.websiteUrl || undefined,
    } : undefined,
  };
}

export interface ITokenService {
  getTokens(filter?: TokenFilter): Promise<Token[]>;
  getToken(address: string): Promise<Token | undefined>;
  getTokensByDirection(
    direction: Direction,
    filter?: TokenFilter,
  ): Promise<Token[]>;
}

/**
 * Map a client-side `TokenFilter` to the right server-side query params.
 * All filtering + sorting for the landing-page tabs is now done by the
 * API — the client doesn't reorder or sub-filter the returned list.
 */
function filterToApiOptions(
  filter: TokenFilter | undefined,
): FetchTokensOptions {
  switch (filter) {
    case undefined:
    case "trending":
      return { sort: "trending" };
    case "new":
      // Default API sort is `createdAt desc` — exactly what NEW wants.
      return {};
    case "lt-movers":
      return { sort: "lt-movers" };
    case "graduating":
      return { status: "graduating" };
    case "graduated":
      return { status: "graduated" };
  }
}

async function liveGetTokens(filter?: TokenFilter): Promise<Token[]> {
  const apiTokens = await fetchTokens(
    100,
    0,
    filterToApiOptions(filter),
  ).catch((): ApiToken[] => []);
  if (apiTokens.length === 0) return [];
  return apiTokens.map(fromApiToken);
}

async function liveGetToken(address: string): Promise<Token | undefined> {
  const apiToken = await fetchToken(address).catch(() => null);
  if (!apiToken) return undefined;
  return fromApiToken(apiToken);
}

async function liveGetTokensByDirection(
  direction: Direction,
  filter?: TokenFilter,
): Promise<Token[]> {
  const tokens = await liveGetTokens(filter);
  return tokens.filter((t) => t.direction === direction);
}

const liveTokenService: ITokenService = {
  getTokens: liveGetTokens,
  getToken: liveGetToken,
  getTokensByDirection: liveGetTokensByDirection,
};

export const tokenService: ITokenService = liveTokenService;
