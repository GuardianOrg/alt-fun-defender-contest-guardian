import {
  TARGET_ASSETS,
  getAllLeverageOptions,
  type Asset,
} from "../constants/targetAssets";

export type ParsedTokenParam = {
  asset: Asset;
  leverage: number | null;
  direction: "long" | "short" | null;
};

const VALID_ASSETS = TARGET_ASSETS.map((a) => a.symbol);

// Pre-sorted longest-first to avoid partial matches (e.g. PAXG vs PAX)
const SORTED_ASSETS = [...VALID_ASSETS].sort((a, b) => b.length - a.length);

/**
 * Parses a URL parameter into asset, leverage, and direction.
 *
 * Supports both specific leveraged token symbols (e.g. "ETH5L", "BTC3S")
 * and plain asset symbols (e.g. "ETH", "BTC").
 *
 * Returns null if the param doesn't match any valid asset symbol.
 * For params with a valid asset prefix but invalid/partial suffix (e.g. "ETH5"),
 * falls back to an asset-only match with null leverage/direction.
 */
export const parseLeveragedTokenParam = (
  param: string,
): ParsedTokenParam | null => {
  const upper = param.toUpperCase();

  for (const asset of SORTED_ASSETS) {
    if (!upper.startsWith(asset)) continue;

    const remainder = upper.slice(asset.length);

    // Plain asset match (no leverage/direction suffix)
    if (remainder === "") {
      return { asset: asset as Asset, leverage: null, direction: null };
    }

    // Try to parse leveraged token suffix: number + L/S
    const match = remainder.match(/^(\d+)(L|S)$/);
    if (match) {
      const leverage = parseInt(match[1], 10);
      const direction: "long" | "short" = match[2] === "L" ? "long" : "short";

      const targetAsset = TARGET_ASSETS.find((a) => a.symbol === asset);
      if (targetAsset && getAllLeverageOptions(targetAsset).includes(leverage)) {
        return { asset: asset as Asset, leverage, direction };
      }

      // Valid asset but unsupported leverage - return asset with unspecified leverage/direction (nulls)
      return { asset: asset as Asset, leverage: null, direction: null };
    }

    // Valid asset prefix but malformed suffix (e.g. "ETH5", "ETHLONG") - treat as asset-only
    return { asset: asset as Asset, leverage: null, direction: null };
  }

  return null;
};
