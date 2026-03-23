import type { Asset } from "../constants/targetAssets";
import type { Address } from "viem";

export interface LeveragedTokenData {
  address: Address;
  targetAsset: Asset;
  targetLeverage: number;
  isLong: boolean;
  exchangeRate: bigint;
  baseAssetBalance: bigint;
  totalAssets: bigint;
  balanceOf: bigint;
  mintPaused: boolean;
  isStandbyMode: boolean;
  symbol: string;
}

export type LeveragedTokenDataRaw = Omit<
  LeveragedTokenData,
  "targetLeverage" | "symbol" | "address"
> & {
  leveragedToken: Address;
  targetLeverage: bigint;
};
