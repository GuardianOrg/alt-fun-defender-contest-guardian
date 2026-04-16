import { API_BASE, fetchToken, fetchTokens } from "./api";
import { fetchPonderToken, fetchPonderTokens } from "./ponder";

import type { ApiToken } from "./api";
import type { PonderToken } from "./ponder";
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

export function deriveStatus(apiToken: ApiToken): Token["status"] {
  if (apiToken.status === "graduated") return "graduated";
  if (apiToken.status === "graduating") return "graduating";
  return "active";
}

function mergeToken(api: ApiToken, onchain: PonderToken | null): Token {
  const totalSupply = 1_000_000_000n * 10n ** 18n;
  const curveAlloc = (totalSupply * 75n) / 100n;
  const curveSupply = onchain ? BigInt(onchain.curveSupply) : 0n;
  const soldTokens = curveAlloc - curveSupply;
  const curveFilled =
    curveAlloc > 0n ? Number((soldTokens * 10000n) / curveAlloc) / 100 : 0;

  const isGraduated = onchain?.graduated ?? false;
  const status: Token["status"] = isGraduated
    ? "graduated"
    : curveFilled >= 90
      ? "graduating"
      : "active";

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
    mcapUsd: 0,
    change24h: 0,
    buyMomentum: 0,
    leverageBoost: 0,
    curveFilled: Math.min(curveFilled, 100),
    curveRaisedUsd: 0,
    volume24h: 0,
    athUsd: 0,
    status,
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
 * Filter and sort tokens. Sorting by market cap (`trending`) is intentionally
 * left to the consumer because live mcap lives in hooks, not on the Token
 * object directly.
 */
export function applyFilter(
  tokens: Token[],
  filter: TokenFilter | undefined,
  getMcap?: (address: string) => number,
): Token[] {
  const mcapOf = (t: Token) =>
    getMcap ? getMcap(t.address) : t.mcapUsd;

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
      return tokens;
    case "trending":
    default: {
      const graduated = tokens.filter((t) => t.status === "graduated");
      const active = tokens.filter((t) => t.status !== "graduated");
      active.sort((a, b) => mcapOf(b) - mcapOf(a));
      const king = graduated.sort((a, b) => mcapOf(b) - mcapOf(a))[0];
      return king ? [king, ...active] : active;
    }
  }
}

async function liveGetTokens(filter?: TokenFilter): Promise<Token[]> {
  const [apiTokens, ponderTokens] = await Promise.all([
    fetchTokens(100).catch((): ApiToken[] => []),
    fetchPonderTokens(100).catch((): PonderToken[] => []),
  ]);

  if (apiTokens.length === 0 && ponderTokens.length === 0) {
    return [];
  }

  const ponderMap = new Map(ponderTokens.map((t) => [t.address.toLowerCase(), t]));

  const merged = apiTokens.map((api) =>
    mergeToken(api, ponderMap.get(api.address.toLowerCase()) ?? null),
  );

  return applyFilter(merged, filter);
}

async function liveGetToken(address: string): Promise<Token | undefined> {
  const [apiToken, ponderToken] = await Promise.all([
    fetchToken(address).catch(() => null),
    fetchPonderToken(address).catch(() => null),
  ]);

  if (!apiToken) return undefined;
  return mergeToken(apiToken, ponderToken);
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
