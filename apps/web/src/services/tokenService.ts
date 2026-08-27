import {
  buildTelegramUrl,
  buildTwitterUrl,
  buildWebsiteUrl,
  getAssetDisplayName,
} from "@launchpad/shared";

import { API_BASE, fetchToken, fetchTokens } from "./api";
import { DEFAULT_TOKEN_IMAGE } from "../config/constants";

import type { ApiToken, FetchTokensOptions } from "./api";
import type { Direction, Token, TokenFilter } from "./types";

export function ltDisplayName(apiToken: ApiToken): string {
  const dir = apiToken.ltDirection === "long" ? "Long" : "Short";
  const underlying = apiToken.underlying;
  return `${getAssetDisplayName(underlying)} ${apiToken.leverage}× ${dir}`;
}

/** Map API lifecycle names to frontend statuses. */
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
    // Empty on-chain image gets the shared public fallback.
    image: api.imageUrl
      ? new URL(api.imageUrl, API_BASE).toString()
      : DEFAULT_TOKEN_IMAGE,
    description: api.description,
    direction: api.ltDirection,
    underlying: api.underlying,
    leverage: api.leverage,
    ltName: ltDisplayName(api),
    ltAddress: api.ltPair,
    buyMomentum: 0,
    // Null organic fill means degraded/unknown, not zero.
    leverageBoost: api.curveFilledLeverageBoost ?? 0,
    organicFilled: api.curveFilledOrganic ?? null,
    curveFilled: api.curveFilled ?? null,
    // Preserve null as unknown/degraded; never coerce raised USD to `$0`.
    curveRaisedUsd: api.curveRaisedUsd ?? null,
    volume24h: api.volume24hUsd ?? null,
    totalVolumeUsd: api.totalVolumeUsd ?? null,
    athUsd: 0,
    priceUsd: api.priceUsd ?? null,
    mcapUsd: api.mcapUsd ?? null,
    change24h: api.change24h ?? null,
    status: deriveStatus(api),
    creatorAddress: api.creator,
    communityTakeoverAt: api.communityTakeoverAt ?? null,
    createdAt: api.createdAt,
    isHidden: api.isHidden,
    socialLinks: buildSocialLinks(api),
  };
}

// Manual website overrides for tokens whose on-chain `urls` were set before the
// create-flow ordering fix, so their website never reached the DB. Keyed by
// lowercased address. Remove an entry once the row is amended at source.
const WEBSITE_OVERRIDES: Record<string, string> = {
  "0x774d9f7ba2c55074e036f1b237293a4dd1900000": "https://bidthegoat.lol/",
};

/** Build full social URLs from API-stored handles/URLs. */
function buildSocialLinks(api: ApiToken): Token["socialLinks"] {
  const twitter = buildTwitterUrl(api.twitterUrl);
  const telegram = buildTelegramUrl(api.telegramUrl);
  const website =
    WEBSITE_OVERRIDES[api.address.toLowerCase()] ??
    buildWebsiteUrl(api.websiteUrl);
  if (!twitter && !telegram && !website) return undefined;
  // Omit absent keys rather than writing `undefined`.
  return {
    ...(twitter ? { twitter } : {}),
    ...(telegram ? { telegram } : {}),
    ...(website ? { website } : {}),
  };
}

/** Optional pair-level facets layered on top of the lifecycle tab. */
export interface TokenTableFiltersInput {
  underlying?: Token["underlying"];
  leverage?: Token["leverage"];
  direction?: Direction;
}

/** Sort axis layered on lifecycle tabs; `"default"` means the tab's natural order. */
export type TokenSort = "default" | "mcap" | "change24h" | "volume24h";

/** Map UI sort values to API `sort=` values. */
function wireSort(
  sort: Exclude<TokenSort, "default">,
): "trending" | "volume24h" | "mcap" | "change24h" {
  return sort;
}

export interface ITokenService {
  /** Paginated home-page list. */
  getTokensPage(
    filter: TokenFilter | undefined,
    offset: number,
    limit: number,
    tableFilters?: TokenTableFiltersInput,
    sort?: TokenSort,
    signal?: AbortSignal,
  ): Promise<Token[]>;
  /** Look up one token; wallet enables holder-only access to hidden tokens. */
  getToken(
    address: string,
    wallet?: string,
    signal?: AbortSignal,
  ): Promise<Token | undefined>;
}

// Smaller than server cap so first paint and subsequent scroll loads stay cheap.
export const TOKENS_PAGE_SIZE = 30;

/** Map tab, facets, and sort override to server-side query params. */
function filterToApiOptions(
  filter: TokenFilter | undefined,
  tableFilters: TokenTableFiltersInput = {},
  sort: TokenSort = "default",
): FetchTokensOptions {
  const base: FetchTokensOptions = (() => {
    switch (filter) {
      case undefined:
      case "trending":
        // Absence means createdAt desc, so TRENDING default must send `sort=trending`.
        if (sort === "default") return { sort: "trending" };
        return { sort: wireSort(sort) };
      case "new":
        return {};
      case "graduating":
        return { status: "graduating" };
      case "graduated":
        // GRADUATED default omits `sort` so the API uses graduatedAt desc.
        if (sort === "default") return { status: "graduated" };
        return { status: "graduated", sort: wireSort(sort) };
    }
  })();
  // Drop `undefined` facets so the query string stays minimal.
  if (tableFilters.underlying !== undefined) {
    base.underlying = tableFilters.underlying;
  }
  if (tableFilters.leverage !== undefined) {
    base.leverage = tableFilters.leverage;
  }
  if (tableFilters.direction !== undefined) {
    base.direction = tableFilters.direction;
  }
  return base;
}

async function liveGetTokensPage(
  filter: TokenFilter | undefined,
  offset: number,
  limit: number,
  tableFilters?: TokenTableFiltersInput,
  sort?: TokenSort,
  signal?: AbortSignal,
): Promise<Token[]> {
  // Errors propagate (rather than being swallowed into an empty page) so the
  // infinite-scroll caller can mark the page as failed and surface a retry
  // path through TanStack Query — a silent empty return would falsely
  // terminate pagination.
  const apiTokens = await fetchTokens(
    limit,
    offset,
    filterToApiOptions(filter, tableFilters, sort),
    signal,
  );
  return apiTokens.map(fromApiToken);
}

async function liveGetToken(
  address: string,
  wallet?: string,
  signal?: AbortSignal,
): Promise<Token | undefined> {
  try {
    return fromApiToken(await fetchToken(address, wallet, signal));
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return undefined;
    }
    throw error;
  }
}

const liveTokenService: ITokenService = {
  getTokensPage: liveGetTokensPage,
  getToken: liveGetToken,
};

export const tokenService: ITokenService = liveTokenService;
