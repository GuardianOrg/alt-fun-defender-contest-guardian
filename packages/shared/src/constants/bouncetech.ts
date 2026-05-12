export const BOUNCE_INDEXING_API = "https://indexing.bounce.tech" as const;

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
 * this URL drives the live-LT filter — a 2xx means BounceTech has published
 * the LT, anything else means it's still internal/draft.
 */
export function getBounceLtImageUrl(symbol: string): string {
  return `${BOUNCE_UI_BASE_URL}/leveraged-tokens/${symbol}.png`;
}

export const HYPERLIQUID_INFO_API = "https://api.hyperliquid.xyz/info" as const;
export const HYPERLIQUID_WS = "wss://api.hyperliquid.xyz/ws" as const;

export const USDC_ADDRESS = "0xb88339CB7199b77E23DB6E890353E22632Ba630f" as const;

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
}

/**
 * Assets that Alt Fun supports for token creation. Mirrors the full set of
 * underlying assets in the BounceTech LT directory at
 * `https://indexing.bounce.tech/leveraged-tokens` that ship with at least one
 * 2x/3x/5x LT.
 *
 * Two families:
 *   - **Crypto:** `HYPE`, `ETH`, `BTC`, `SOL`, `DOGE`, `PAXG`, `ZEC`, `kPEPE`.
 *     Spot prices come from Hyperliquid's default `allMids` payload.
 *   - **xyz: equity / commodity perps:** `xyz:CL`, `xyz:BRENTOIL`, `xyz:GOLD`,
 *     `xyz:SILVER`, `xyz:NVDA`, `xyz:SP500`, `xyz:XYZ100`. Prices come from
 *     `allMids` with `dex: "xyz"` — the builder-deployed equity/commodity
 *     perps dex on Hyperliquid. The `xyz:` prefix is intentional: it matches
 *     `targetAsset` on the BounceTech LT struct, so token rows round-trip
 *     against the directory without any normalization.
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
  "PAXG",
  "ZEC",
  "kPEPE",
  "xyz:CL",
  "xyz:BRENTOIL",
  "xyz:GOLD",
  "xyz:SILVER",
  "xyz:NVDA",
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
  "PAXG",
  "ZEC",
  "kPEPE",
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
export function getHyperliquidDex(asset: string): typeof HYPERLIQUID_XYZ_DEX | null {
  return (XYZ_DEX_ASSETS as readonly string[]).includes(asset)
    ? HYPERLIQUID_XYZ_DEX
    : null;
}

export const SUPPORTED_LEVERAGES = [2, 3, 5] as const;
export type SupportedLeverage = (typeof SUPPORTED_LEVERAGES)[number];

/**
 * Filter a live LT list down to the ones Alt Fun supports.
 */
export function filterSupportedLTs(lts: LiveLeveragedToken[]): LiveLeveragedToken[] {
  return lts.filter(
    (lt) =>
      (SUPPORTED_UNDERLYING_ASSETS as readonly string[]).includes(lt.targetAsset) &&
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
    (lt) => lt.targetAsset === asset && lt.targetLeverage === leverage && lt.isLong === isLong,
  );
}
