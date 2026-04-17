import { API_BASE, fetchToken, fetchTokens } from "./api";

import type { ApiToken } from "./api";
import type { Direction, Token, TokenFilter } from "./types";

export function ltDisplayName(apiToken: ApiToken): string {
  const dir = apiToken.ltDirection === "long" ? "Long" : "Short";
  const underlying = deriveUnderlying(apiToken);
  return `${underlying} ${apiToken.leverage}× ${dir}`;
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

export function deriveStatus(api: ApiToken): Token["status"] {
  if (api.status === "graduated" || api.graduated) return "graduated";
  if (api.status === "graduating") return "graduating";
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
    leverageBoost: 0,
    curveFilled: api.curveFilled ?? null,
    curveRaisedUsd: 0,
    volume24h: 0,
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
 * Apply filters that can be computed from the token row alone. The `trending`
 * mcap-based ordering lives in `useMcapSortedTokens` in `useTokens` because it
 * needs the full token list to sort globally.
 */
export function applyFilter(
  tokens: Token[],
  filter: TokenFilter | undefined,
): Token[] {
  switch (filter) {
    case "graduating":
      return tokens.filter((t) => t.status === "graduating");
    case "graduated":
      return tokens.filter((t) => t.status === "graduated");
    case "new":
      return [...tokens].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    case "lt-movers":
      return tokens
        .filter((t) => t.leverageBoost > 0)
        .sort((a, b) => b.leverageBoost - a.leverageBoost);
    case "all":
    case "trending":
    default:
      return tokens;
  }
}

async function liveGetTokens(filter?: TokenFilter): Promise<Token[]> {
  const apiTokens = await fetchTokens(100).catch((): ApiToken[] => []);
  if (apiTokens.length === 0) return [];
  return applyFilter(apiTokens.map(fromApiToken), filter);
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
