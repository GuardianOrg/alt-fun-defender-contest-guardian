import aaveLogo from "../../../../assets/logos/aave.svg";
import bnbLogo from "../../../../assets/logos/bnb.svg";
import ethereumLogo from "../../../../assets/logos/ethereum.svg";
import hypeLogo from "../../../../assets/logos/hyperliquid.svg";
import xplLogo from "../../../../assets/logos/plasma.svg";
import xrpLogo from "../../../../assets/logos/xrp.svg";

export const ASSET_LOGO_OVERRIDES: Record<string, string> = {
  HYPE: hypeLogo,
  XRP: xrpLogo,
  ETH: ethereumLogo,
  AAVE: aaveLogo,
  BNB: bnbLogo,
  XPL: xplLogo,
};

// Local HL asset logos: filename (no .svg) -> resolved URL
const localAssetLogoUrls: Record<string, string> = (() => {
  const glob = import.meta.glob<string>(
    "../../../../assets/hyperliquid-assets/*.svg",
    { eager: true, query: "?url", import: "default" },
  );
  const map: Record<string, string> = {};
  for (const path of Object.keys(glob)) {
    const filename = path.split("/").pop() ?? "";
    const key = filename.replace(/\.svg$/, "");
    const url = (glob as Record<string, string>)[path];
    if (key && url) map[key] = url;
  }
  return map;
})();

export const getAssetLogoUrl = (asset: string): string => {
  if (ASSET_LOGO_OVERRIDES[asset]) {
    return ASSET_LOGO_OVERRIDES[asset];
  }

  const fileKey = asset.replace(/:/g, "_");
  return localAssetLogoUrls[fileKey] ?? "";
};

export const getHasLogo = (asset: string): boolean =>
  getAssetLogoUrl(asset) !== "";

export const useAssetLogos = () => ({
  getHasLogo: getHasLogo,
  getAssetLogoUrl: getAssetLogoUrl,
});
