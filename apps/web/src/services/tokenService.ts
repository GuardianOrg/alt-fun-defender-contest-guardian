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
    // When the creator skipped image upload the API returns an empty
    // `imageUrl`; substitute the public default art so every row /
    // hero / balance entry renders the same fallback image instead of
    // falling through to the mint-`?` placeholder. See
    // `DEFAULT_TOKEN_IMAGE` for the why.
    image: api.imageUrl
      ? new URL(api.imageUrl, API_BASE).toString()
      : DEFAULT_TOKEN_IMAGE,
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
    isHidden: api.isHidden,
    socialLinks: buildSocialLinks(api),
  };
}

/**
 * Build the rendered social-link URLs from the raw API fields.
 *
 * The API stores Twitter / Telegram as **bare handles** (e.g. `"alice"`,
 * `"+abc1234"`) and only the website as a full URL (see
 * `apps/api/src/lib/token-registration.ts`). Rendering the bare handles
 * straight into `<a href>` produces relative URLs (`href="alice"` →
 * `https://alt.fun/alice` → 404), so every Twitter/Telegram link on the
 * token detail page was broken (issue #471).
 *
 * Pipe each field through the matching `build*Url` helper from
 * `@launchpad/shared` — these turn a stored handle into a fully-qualified
 * `https://x.com/<handle>` / `https://t.me/<path>` URL, and return `null`
 * for anything that fails the same sanitisation gate the API write path
 * uses (covers tampered / unsafe stored values too).
 */
function buildSocialLinks(api: ApiToken): Token["socialLinks"] {
  const twitter = buildTwitterUrl(api.twitterUrl);
  const telegram = buildTelegramUrl(api.telegramUrl);
  const website = buildWebsiteUrl(api.websiteUrl);
  if (!twitter && !telegram && !website) return undefined;
  // Omit absent keys instead of writing `undefined` so consumers that
  // iterate or `in`-check the object see the same shape they'd get from
  // a token where that field was never stored in the first place.
  return {
    ...(twitter ? { twitter } : {}),
    ...(telegram ? { telegram } : {}),
    ...(website ? { website } : {}),
  };
}

/**
 * Optional pair-level filters layered on top of the tab `TokenFilter`. Maps
 * 1:1 onto the API's `?underlying=…&leverage=…&direction=…` query params —
 * server-side filtering keeps pagination + sorting honest (a client-side
 * filter would let "TRENDING + Market: HYPE" silently drop rows that should
 * have been pulled from a deeper offset).
 */
export interface TokenTableFiltersInput {
  underlying?: string;
  leverage?: number;
  direction?: Direction;
}

export interface ITokenService {
  getTokens(
    filter?: TokenFilter,
    tableFilters?: TokenTableFiltersInput,
  ): Promise<Token[]>;
  /**
   * Paginated variant for the home-page infinite-scroll list. Returns a
   * single page exactly as the API serves it (no client-side filtering
   * or reordering), so the caller can walk pages with `offset += limit`
   * until a short page comes back. See `useInfiniteTokens`.
   */
  getTokensPage(
    filter: TokenFilter | undefined,
    offset: number,
    limit: number,
    tableFilters?: TokenTableFiltersInput,
  ): Promise<Token[]>;
  /**
   * Look up a single token by address.
   *
   * `wallet` (optional) opts into the holder-aware bypass for
   * admin-hidden tokens: passing the connected wallet lets a holder of
   * a hidden token load its detail page so they can sell out. Non-holders
   * (no wallet, wrong wallet, zero balance) continue to get `undefined`
   * for hidden tokens — server-side enforced via on-chain `balanceOf`.
   */
  getToken(address: string, wallet?: string): Promise<Token | undefined>;
  getTokensByDirection(
    direction: Direction,
    filter?: TokenFilter,
  ): Promise<Token[]>;
}

/**
 * Page size used by the home-page infinite-scroll list. The server caps
 * each page at 100 (`MAX_PAGE_SIZE` in `apps/api/src/routes/tokens/list.ts`);
 * a smaller page lets the first paint land sooner and keeps subsequent
 * loads cheap while the user scrolls.
 */
export const TOKENS_PAGE_SIZE = 30;

/**
 * Map a client-side `TokenFilter` + optional pair-level facets to the right
 * server-side query params. All filtering + sorting for the landing-page
 * tabs is done by the API — the client doesn't reorder or sub-filter the
 * returned list.
 */
function filterToApiOptions(
  filter: TokenFilter | undefined,
  tableFilters: TokenTableFiltersInput = {},
): FetchTokensOptions {
  const base: FetchTokensOptions = (() => {
    switch (filter) {
      case undefined:
      case "trending":
        return { sort: "trending" };
      case "new":
        // Default API sort is `createdAt desc` — exactly what NEW wants.
        return {};
      case "graduating":
        return { status: "graduating" };
      case "graduated":
        return { status: "graduated" };
    }
  })();
  // Spread the user-selected facets in, dropping `undefined` values so the
  // query string stays minimal (`fetchTokens` only serialises set params).
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

async function liveGetTokens(
  filter?: TokenFilter,
  tableFilters?: TokenTableFiltersInput,
): Promise<Token[]> {
  const apiTokens = await fetchTokens(
    100,
    0,
    filterToApiOptions(filter, tableFilters),
  ).catch((): ApiToken[] => []);
  if (apiTokens.length === 0) return [];
  return apiTokens.map(fromApiToken);
}

async function liveGetTokensPage(
  filter: TokenFilter | undefined,
  offset: number,
  limit: number,
  tableFilters?: TokenTableFiltersInput,
): Promise<Token[]> {
  // No catch-and-swallow here (unlike `liveGetTokens`) — the infinite-scroll
  // caller relies on a thrown error to mark the page as failed and surface
  // a retry path through TanStack Query, rather than silently returning an
  // empty page which would falsely terminate pagination.
  const apiTokens = await fetchTokens(
    limit,
    offset,
    filterToApiOptions(filter, tableFilters),
  );
  return apiTokens.map(fromApiToken);
}

async function liveGetToken(
  address: string,
  wallet?: string,
): Promise<Token | undefined> {
  const apiToken = await fetchToken(address, wallet).catch(() => null);
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
  getTokensPage: liveGetTokensPage,
  getToken: liveGetToken,
  getTokensByDirection: liveGetTokensByDirection,
};

export const tokenService: ITokenService = liveTokenService;
