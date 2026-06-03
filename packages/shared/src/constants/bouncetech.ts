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

export const HYPERLIQUID_XYZ_DEX = "xyz" as const;

export const SUPPORTED_UNDERLYING_ASSETS = [
  "HYPE",
  "ETH",
  "BTC",
  "SOL",
  "DOGE",
  "ZEC",
  "kPEPE",
  "FARTCOIN",
  "NEAR",
  "LIT",
  "xyz:CBRS",
  "xyz:CL",
  "xyz:BRENTOIL",
  "xyz:GOLD",
  "xyz:SILVER",
  "xyz:NVDA",
  "xyz:TSLA",
  "xyz:SP500",
  "xyz:SPCX",
  "xyz:XYZ100",
  "xyz:BB",
] as const;

export type SupportedAsset = (typeof SUPPORTED_UNDERLYING_ASSETS)[number];

export function isSupportedUnderlying(asset: string): asset is SupportedAsset {
  return (SUPPORTED_UNDERLYING_ASSETS as readonly string[]).includes(asset);
}

export function getAssetDisplayName(asset: string): string {
  return asset.startsWith("xyz:") ? asset.slice("xyz:".length) : asset;
}

export function getHyperliquidDex(
  asset: string,
): typeof HYPERLIQUID_XYZ_DEX | null {
  return asset.startsWith("xyz:") ? HYPERLIQUID_XYZ_DEX : null;
}

export type SupportedLeverage = number;

function isContractLeverage(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function getLeverageOptions(
  lts: readonly LeveragedTokenInfo[],
  asset?: string,
  isLong?: boolean,
): number[] {
  const leverages = new Set<number>();
  for (const lt of lts) {
    if (asset !== undefined && lt.targetAsset !== asset) continue;
    if (isLong !== undefined && lt.isLong !== isLong) continue;
    if (!isContractLeverage(lt.targetLeverage)) continue;
    leverages.add(lt.targetLeverage);
  }
  return [...leverages].sort((a, b) => a - b);
}

/**
 * Filter a live LT list down to the ones Alt Fun supports.
 */
export function filterSupportedLTs(
  lts: LiveLeveragedToken[],
): LiveLeveragedToken[] {
  return lts.filter(
    (lt) =>
      isSupportedUnderlying(lt.targetAsset) &&
      isContractLeverage(lt.targetLeverage),
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
