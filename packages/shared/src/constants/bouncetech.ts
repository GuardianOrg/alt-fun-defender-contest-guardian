export const BOUNCE_INDEXING_API = "https://indexing.bounce.tech" as const;

export const HYPERLIQUID_INFO_API = "https://api.hyperliquid.xyz/info" as const;
export const HYPERLIQUID_WS = "wss://api.hyperliquid.xyz/ws" as const;

export const USDC_ADDRESS = "0xb88339CB7199b77E23DB6E890353E22632Ba630f" as const;

/** Alt Fun minimum transaction size — higher than BounceTech's $10 floor to provide buffer. */
export const MIN_USDC_AMOUNT = 20 as const;

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
 * Assets that Alt Fun supports for token creation.
 * PAXG is available on BounceTech but excluded from Alt Fun v1.
 */
export const SUPPORTED_UNDERLYING_ASSETS = ["HYPE", "ETH", "BTC", "SOL"] as const;
export type SupportedAsset = (typeof SUPPORTED_UNDERLYING_ASSETS)[number];

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
