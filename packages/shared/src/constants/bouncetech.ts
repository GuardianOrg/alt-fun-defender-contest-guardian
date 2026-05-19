export const BOUNCE_INDEXING_API = "https://indexing.bounce.tech" as const;

/**
 * On-chain `LeveragedTokenHelper` contract on HyperEVM. Read-only view-
 * helper that returns the full BounceTech LT directory (`address`,
 * `targetAsset`, `targetLeverage`, `isLong`, `exchangeRate`, `mintPaused`,
 * `baseAssetBalance`, `totalAssets`, …) in one batched call.
 *
 * Source of truth for Alt Fun's `LtDirectoryPoller` Durable Object
 * (`apps/api/src/websocket/lt-directory-poller.ts`), which keeps the
 * `lt_directory` Postgres table fresh on a 30s alarm cadence. This is the
 * additive plumbing for replacing reliance on
 * `${BOUNCE_INDEXING_API}/leveraged-tokens` — the cutover from HTTP to
 * the on-chain helper is deliberately deferred until parity is verified
 * (see the follow-up GitHub issue for the verification plan).
 */
export const LEVERAGED_TOKEN_HELPER_ADDRESS =
  "0x69028FFb4e18c068fC65917ca7152c29e4B38B01" as const;

/**
 * Public BounceTech web app. We use it as a "is this LT live on BounceTech's
 * own UI?" oracle: BounceTech ships a per-LT logo at
 * `${BOUNCE_UI_BASE_URL}/leveraged-tokens/<symbol>.png` once they decide an
 * LT is ready to go public. Some LTs exist in the indexing API for internal
 * testing well before that flag flips, so we use the image's existence (via
 * a HEAD request) as the integration boundary — only LTs BounceTech actually
 * surfaces in their UI become eligible pairs / surface in our markets +
 * tape on Alt Fun. See `apps/api/src/lib/lt-availability.ts` and issue #621.
 */
export const BOUNCE_UI_BASE_URL = "https://bounce.tech" as const;

/**
 * Canonical URL of an LT's logo on the BounceTech UI. The HEAD response on
 * this URL drives the live-LT filter, but the status alone is **not enough**
 * because bounce.tech is a SPA: every URL (including `/leveraged-tokens/<not-
 * yet-published>.png`) returns HTTP 200 with the SPA HTML shell rather than
 * a clean 404. The check that actually distinguishes "live" from "internal"
 * is the response `Content-Type` — a real PNG comes back as `image/png`,
 * the SPA fallback comes back as `text/html`. See
 * `apps/api/src/lib/lt-availability.ts → defaultSymbolChecker`.
 */
export function getBounceLtImageUrl(symbol: string): string {
  return `${BOUNCE_UI_BASE_URL}/leveraged-tokens/${symbol}.png`;
}

export const HYPERLIQUID_INFO_API = "https://api.hyperliquid.xyz/info" as const;
export const HYPERLIQUID_WS = "wss://api.hyperliquid.xyz/ws" as const;

export const USDC_ADDRESS =
  "0xb88339CB7199b77E23DB6E890353E22632Ba630f" as const;

/** Alt Fun minimum buy size — higher than BounceTech's $10 floor to provide buffer. */
export const MIN_USDC_BUY_AMOUNT = 20 as const;

/** Alt Fun minimum sell size — above BounceTech's $10 floor but lower than the buy minimum. */
export const MIN_USDC_SELL_AMOUNT = 12 as const;

export interface LeveragedTokenInfo {
  address: `0x${string}`;
  symbol: string;
  name: string;
  targetAsset: string;
  targetLeverage: number;
  isLong: boolean;
  decimals: number;
}

/**
 * Live LT data from the BounceTech Indexing API includes exchange rates and mint status
 * on top of the base LeveragedTokenInfo fields.
 */
export interface LiveLeveragedToken extends LeveragedTokenInfo {
  mintPaused: boolean;
  exchangeRate: string;
  totalSupply: string;
  totalAssets: string;
  baseAssetBalance: string;
}

/**
 * Underlying assets we've hard-coded out of every Alt Fun UI surface
 * (markets sidebar, create-token pair selector, home-page token list,
 * token search). Add an entry here to retire a market without touching
 * any other call site — `filterSupportedLTs` drops matching LTs from
 * the BounceTech directory, and the API's `/tokens` list + search
 * routes drop matching tokens from PostgreSQL responses.
 *
 * We don't purge underlying data: tokens already in the DB stay
 * registered (and accessible by direct URL for existing holders), and
 * the LT directory is read-through. The exclusion is a UI-level
 * filter, applied at every read boundary.
 *
 * PAXG was added when BounceTech announced it was winding the LT down
 * — we hide it from the launchpad UI so creators don't pick a market
 * with no future, while leaving existing PAXG-backed tokens tradeable
 * by people who already hold them. Issue #639.
 */
export const EXCLUDED_UNDERLYING_ASSETS = ["PAXG"] as const;
export type ExcludedUnderlyingAsset =
  (typeof EXCLUDED_UNDERLYING_ASSETS)[number];

/**
 * Cheap predicate used by every callsite that reads a token's
 * `underlying` (DB row, on-chain `targetAsset`, etc.) to decide
 * whether to hide it. Centralised here so adding/removing an entry to
 * `EXCLUDED_UNDERLYING_ASSETS` flows everywhere automatically.
 */
export function isExcludedUnderlying(asset: string): boolean {
  return (EXCLUDED_UNDERLYING_ASSETS as readonly string[]).includes(asset);
}

/**
 * Assets that Alt Fun supports for token creation. Mirrors the full set of
 * underlying assets in the BounceTech LT directory at
 * `https://indexing.bounce.tech/leveraged-tokens` that ship with at least one
 * 2x/3x/5x LT, minus anything currently listed in
 * `EXCLUDED_UNDERLYING_ASSETS` (e.g. PAXG, which BounceTech is winding down).
 *
 * Two families:
 *   - **Crypto:** `HYPE`, `ETH`, `BTC`, `SOL`, `DOGE`, `ZEC`, `kPEPE`,
 *     `FARTCOIN`. Spot prices come from Hyperliquid's default `allMids`
 *     payload.
 *   - **xyz: equity / commodity perps:** `xyz:CL`, `xyz:BRENTOIL`, `xyz:GOLD`,
 *     `xyz:SILVER`, `xyz:NVDA`, `xyz:TSLA`, `xyz:SP500`, `xyz:XYZ100`. Prices
 *     come from `allMids` with `dex: "xyz"` — the builder-deployed
 *     equity/commodity perps dex on Hyperliquid. The `xyz:` prefix is
 *     intentional: it matches `targetAsset` on the BounceTech LT struct, so
 *     token rows round-trip against the directory without any normalization.
 *
 * When BounceTech adds new LTs we extend this list; the only other touchpoint
 * is `apps/web/src/components/shared/AssetIcon.tsx` for the icon mapping.
 */
export const SUPPORTED_UNDERLYING_ASSETS = [
  "HYPE",
  "ETH",
  "BTC",
  "SOL",
  "DOGE",
  "ZEC",
  "kPEPE",
  "FARTCOIN",
  "xyz:CL",
  "xyz:BRENTOIL",
  "xyz:GOLD",
  "xyz:SILVER",
  "xyz:NVDA",
  "xyz:TSLA",
  "xyz:SP500",
  "xyz:XYZ100",
] as const;
export type SupportedAsset = (typeof SUPPORTED_UNDERLYING_ASSETS)[number];

/**
 * Subset of `SUPPORTED_UNDERLYING_ASSETS` priced through Hyperliquid's default
 * `allMids` payload (the spot/perps universe). Anything outside this list is
 * priced via the `xyz` dex feed — see `XYZ_DEX_ASSETS`.
 */
export const HYPERLIQUID_DEFAULT_ASSETS = [
  "HYPE",
  "ETH",
  "BTC",
  "SOL",
  "DOGE",
  "ZEC",
  "kPEPE",
  "FARTCOIN",
] as const;

/**
 * Underlying assets routed through Hyperliquid's `xyz` builder-deployed dex
 * (`{type:"allMids", dex:"xyz"}`). These keep their `xyz:` prefix on every
 * surface so they line up 1:1 with `LiveLeveragedToken.targetAsset`.
 */
export const XYZ_DEX_ASSETS = [
  "xyz:CL",
  "xyz:BRENTOIL",
  "xyz:GOLD",
  "xyz:SILVER",
  "xyz:NVDA",
  "xyz:TSLA",
  "xyz:SP500",
  "xyz:XYZ100",
] as const;

/**
 * Hyperliquid `dex` parameter for the xyz equities/commodities perps. Used by
 * `{type:"allMids", dex}` and `{type:"candleSnapshot", req:{coin, ..., dex}}`.
 */
export const HYPERLIQUID_XYZ_DEX = "xyz" as const;

/**
 * Drop the `xyz:` namespace prefix for display surfaces (sidebar, tape,
 * pair selector). The on-chain `targetAsset` keeps the prefix so we never
 * normalise it in storage — only at the render boundary.
 */
export function getAssetDisplayName(asset: string): string {
  return asset.startsWith("xyz:") ? asset.slice("xyz:".length) : asset;
}

/**
 * Return the Hyperliquid `dex` parameter to use when fetching prices /
 * candles for a given asset. `null` means the default (spot/perps) feed.
 */
export function getHyperliquidDex(
  asset: string,
): typeof HYPERLIQUID_XYZ_DEX | null {
  return (XYZ_DEX_ASSETS as readonly string[]).includes(asset)
    ? HYPERLIQUID_XYZ_DEX
    : null;
}

export const SUPPORTED_LEVERAGES = [2, 3, 5] as const;
export type SupportedLeverage = (typeof SUPPORTED_LEVERAGES)[number];

/**
 * Filter a live LT list down to the ones Alt Fun supports.
 *
 * The redundant `!isExcludedUnderlying(...)` guard is deliberate: while
 * `SUPPORTED_UNDERLYING_ASSETS` already omits everything in
 * `EXCLUDED_UNDERLYING_ASSETS`, the explicit check makes the exclusion
 * authoritative in one place. If a future change adds an entry to
 * `EXCLUDED_UNDERLYING_ASSETS` without remembering to drop it from the
 * supported list, the LT directory filter still keeps it out — matching
 * the behaviour at every other call site that reads the excluded list
 * directly (API token list / search, etc.).
 */
export function filterSupportedLTs(
  lts: LiveLeveragedToken[],
): LiveLeveragedToken[] {
  return lts.filter(
    (lt) =>
      !isExcludedUnderlying(lt.targetAsset) &&
      (SUPPORTED_UNDERLYING_ASSETS as readonly string[]).includes(
        lt.targetAsset,
      ) &&
      (SUPPORTED_LEVERAGES as readonly number[]).includes(lt.targetLeverage),
  );
}

/**
 * Find a specific LT from a live list by asset, leverage, and direction.
 */
export function findLT(
  lts: readonly LeveragedTokenInfo[],
  asset: string,
  leverage: number,
  isLong: boolean,
): LeveragedTokenInfo | undefined {
  return lts.find(
    (lt) =>
      lt.targetAsset === asset &&
      lt.targetLeverage === leverage &&
      lt.isLong === isLong,
  );
}
