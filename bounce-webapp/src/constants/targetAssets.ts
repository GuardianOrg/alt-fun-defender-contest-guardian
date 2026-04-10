import {
  TARGET_ASSETS_BASE,
  type Asset,
  type AssetId,
  type TargetAssetBase,
} from "./targetAssetsBase";
import bitcoin from "../assets/logos/bitcoin.svg";
import ethereum from "../assets/logos/ethereum.svg";
import hyperliquid from "../assets/logos/hyperliquid.svg";
import paxg from "../assets/logos/paxg.svg";
import solana from "../assets/logos/solana.svg";

export type { Asset };

export type TargetAssetType = TargetAssetBase & {
  image: string;
};

const resolveAsset = (asset: TargetAssetType): TargetAssetType => {
  if (asset.longLeverageOptions && asset.shortLeverageOptions) return asset;
  const canonical = TARGET_ASSETS_BASE.find((a) => a.id === asset.id);
  if (canonical) return { ...asset, ...canonical };
  return TARGET_ASSETS_BASE[0] as TargetAssetType;
};

export const getAvailableDirections = (
  asset: TargetAssetType,
  leverage: number,
): ("long" | "short")[] => {
  const resolved = resolveAsset(asset);
  const dirs: ("long" | "short")[] = [];
  if (resolved.longLeverageOptions.includes(leverage)) dirs.push("long");
  if (resolved.shortLeverageOptions.includes(leverage)) dirs.push("short");
  return dirs;
};

export const getAvailableLeverages = (
  asset: TargetAssetType,
  direction: "long" | "short",
): number[] => {
  const resolved = resolveAsset(asset);
  return direction === "long"
    ? resolved.longLeverageOptions
    : resolved.shortLeverageOptions;
};

export const getAllLeverageOptions = (asset: TargetAssetType): number[] => {
  const resolved = resolveAsset(asset);
  return [
    ...new Set([
      ...resolved.longLeverageOptions,
      ...resolved.shortLeverageOptions,
    ]),
  ].sort((a, b) => a - b);
};

const images: Record<AssetId, string> = {
  hyperliquid,
  bitcoin,
  ethereum,
  solana,
  paxg,
};

export const TARGET_ASSETS: TargetAssetType[] = TARGET_ASSETS_BASE.map(
  (asset) => ({
    ...asset,
    image: images[asset.id],
  }),
);
